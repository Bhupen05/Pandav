import mongoose from 'mongoose';
import Chat, { MAX_REPORT_REASON_LENGTH } from '../models/Chat.js';
import Team from '../models/Team.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendServerError } from '../utils/http.js';
import { directMessageProblem, messageableUserIds } from '../utils/messaging.js';
import { adminIds, notify } from '../utils/notify.js';
import { FROZEN_TEAM_MESSAGE, isTeamLeader, teamUserIds } from '../utils/teams.js';

const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_PAGE_SIZE = 50;
// Senders can correct a message for this long after sending it
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LENGTH = 120;
const DELETED_USER_NAME = 'Deleted user';

const { ObjectId } = mongoose.Types;
const isId = (value) => mongoose.isObjectIdOrHexString(value);
const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);

// Only expose what the chat UI needs about each participant
const participants = [
  { path: 'sender', select: 'name' },
  { path: 'receiver', select: 'name' },
];

// Why a message text from a request can't be used, or null
const textProblem = (message, emptyMessage) => {
  if (typeof message !== 'string' || !message.trim()) return emptyMessage;
  if (message.length > MAX_MESSAGE_LENGTH) return `Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`;
  return null;
};

const tooOldToEdit = (sentAt) => Date.now() - new Date(sentAt).getTime() > EDIT_WINDOW_MS;
const TOO_OLD_TO_EDIT = 'Messages can only be edited for 24 hours after they are sent';
const ALREADY_DELETED = 'This message was deleted';

// ?before=<date>[&beforeId=<id>] as a filter on `field` for the page before
// that item. With beforeId (the _id of the oldest item shown), items at
// exactly `before` with a smaller _id count as older too, so two items from
// the same millisecond can't straddle a page boundary and be skipped.
// `idField` is where the item's id is (aggregations rename it).
// Returns { filter } (null when there is no cursor) or { error }.
const cursorFilter = (query, field, idField = '_id') => {
  const { before, beforeId } = query;
  if (!before) return beforeId ? { error: 'beforeId needs before' } : { filter: null };
  const date = new Date(before);
  if (typeof before !== 'string' || Number.isNaN(date.getTime())) return { error: 'Invalid before date' };
  if (!beforeId) return { filter: { [field]: { $lt: date } } };
  if (typeof beforeId !== 'string' || !isId(beforeId)) return { error: 'Invalid beforeId' };
  const id = new ObjectId(beforeId);
  return { filter: { $or: [{ [field]: { $lt: date } }, { [field]: date, [idField]: { $lt: id } }] } };
};

// Marks what senderId sent to readerId as read and tells the sender, so an
// open conversation on their side shows the messages as read
const markConversationRead = async (req, senderId, readerId) => {
  const { modifiedCount } = await Chat.updateMany(
    { sender: senderId, receiver: readerId, isRead: false },
    { isRead: true }
  );
  const io = req.app.get('io');
  if (modifiedCount > 0 && io) {
    io.to(senderId.toString()).emit('messages_read', { readerId: readerId.toString() });
  }
};

// Both people in a direct conversation, for events about one of its messages
// (`rooms` are their ids, taken before populating)
const emitToConversation = (req, rooms, event, message) => {
  req.app.get('io')?.to(rooms).emit(event, message);
};
const conversationRooms = (message) => [String(message.sender), String(message.receiver)];

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.user._id;

    const invalid = textProblem(message, 'Message cannot be empty');
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const problem = await directMessageProblem(req.user, receiverId);
    if (problem) {
      return res.status(problem.status).json({ success: false, message: problem.message });
    }

    const newMessage = new Chat({
      sender: senderId,
      receiver: receiverId,
      message: message.trim()
    });

    await newMessage.save();
    // The receiver's room, from the stored id (the request may spell it in capitals)
    const receiverRoom = String(newMessage.receiver);
    await newMessage.populate(participants);

    // Emit the populated message to receiver's room in real-time
    const io = req.app.get('io');
    if (io) {
      io.to(receiverRoom).emit('receive_message', newMessage);
    }

    res.status(201).json({ success: true, data: newMessage });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Latest page of a conversation, oldest first. Pass ?before=<timestamp> and
// ?beforeId=<_id> of the oldest message shown to load the page before it.
export const getMessages = async (req, res) => {
  try {
    const currentUserId = req.user.id;

    if (!isId(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }
    // Compared with stored ids and used as a room name below
    const userId = req.params.userId.toLowerCase();

    const cursor = cursorFilter(req.query, 'timestamp');
    if (cursor.error) {
      return res.status(400).json({ success: false, message: cursor.error });
    }

    const conversation = {
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    };
    const filter = cursor.filter ? { $and: [conversation, cursor.filter] } : conversation;

    // One extra tells us whether there is an older page
    const newestFirst = await Chat.find(filter)
      .populate(participants)
      .sort({ timestamp: -1, _id: -1 })
      .limit(MESSAGE_PAGE_SIZE + 1);

    const hasMore = newestFirst.length > MESSAGE_PAGE_SIZE;
    const messages = newestFirst.slice(0, MESSAGE_PAGE_SIZE).reverse();

    // Opening the conversation reads everything the other person sent
    if (!cursor.filter) {
      await markConversationRead(req, userId, currentUserId);
      messages.forEach((m) => {
        if (m.sender?._id?.toString() === userId) m.isRead = true;
      });
    }

    res.json({ success: true, count: messages.length, data: messages, hasMore });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Marks everything from :userId to the current user as read (a new message
// arrived while their conversation was open)
export const markAsRead = async (req, res) => {
  try {
    if (!isId(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }

    await markConversationRead(req, req.params.userId.toLowerCase(), req.user.id);
    res.json({ success: true });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Unread team messages for a team member, by team id: messages from others
// they haven't read. Deleted messages don't count.
const teamUnreadCounts = async (userId, teamIds) => {
  if (teamIds.length === 0) return {};
  const me = new ObjectId(String(userId));
  const rows = await TeamChatMessage.aggregate([
    {
      $match: {
        team: { $in: teamIds.map((id) => new ObjectId(String(id))) },
        sender: { $ne: me },
        'readBy.user': { $ne: me },
        deletedAt: null,
      },
    },
    { $group: { _id: '$team', count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map(({ _id, count }) => [_id.toString(), count]));
};

// The teams the user leads or belongs to (admins are in none)
const myTeams = (user, select = 'name leaders members isActive') =>
  Team.find({ $or: [{ leaders: user._id }, { members: user._id }] }).select(select);

// Unread counts for the current user: direct messages by sender (`data`,
// `total`) and team messages by team (`teams`, `teamTotal`)
export const getUnreadCounts = async (req, res) => {
  try {
    const [rows, teams] = await Promise.all([
      Chat.aggregate([
        { $match: { receiver: new ObjectId(req.user.id), isRead: false, deletedAt: null } },
        { $group: { _id: '$sender', count: { $sum: 1 } } }
      ]),
      req.user.role === 'admin' ? [] : myTeams(req.user, '_id'),
    ]);

    const counts = Object.fromEntries(rows.map(({ _id, count }) => [_id.toString(), count]));
    const teamCounts = await teamUnreadCounts(req.user._id, teams.map((team) => team._id));
    const sum = (values) => Object.values(values).reduce((total, n) => total + n, 0);

    res.json({
      success: true,
      data: counts,
      total: sum(counts),
      teams: teamCounts,
      teamTotal: sum(teamCounts),
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Marks one message sent to the current user as read and tells the sender
export const markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!isId(messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message' });
    }

    const message = await Chat.findOne({
      _id: messageId,
      receiver: req.user._id,
    }).populate(participants);

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    if (!message.isRead) {
      message.isRead = true;
      await message.save();

      const io = req.app.get('io');
      if (io && message.sender) {
        io.to(message.sender._id.toString()).emit('message_read', message);
      }
    }

    return res.json({ success: true, data: message });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Everyone the current user has exchanged direct messages with, newest
// conversation first, with the latest message, the unread count and whether
// the user may still write to them. ?before=<lastMessage.at> and
// ?beforeId=<lastMessage._id> of the last row shown load the next page.
export const getConversations = async (req, res) => {
  try {
    // Each row's latest message is `at` and `lastId` below
    const cursor = cursorFilter(req.query, 'at', 'lastId');
    if (cursor.error) {
      return res.status(400).json({ success: false, message: cursor.error });
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || MESSAGE_PAGE_SIZE));
    const me = new ObjectId(req.user.id);

    const rows = await Chat.aggregate([
      { $match: { $or: [{ sender: me }, { receiver: me }] } },
      { $sort: { timestamp: -1, _id: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ['$sender', me] }, '$receiver', '$sender'] },
          lastId: { $first: '$_id' },
          text: { $first: '$message' },
          at: { $first: '$timestamp' },
          lastSender: { $first: '$sender' },
          isRead: { $first: '$isRead' },
          deletedAt: { $first: '$deletedAt' },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$receiver', me] }, { $eq: ['$isRead', false] }, { $not: ['$deletedAt'] }] }, 1, 0],
            },
          },
        },
      },
      ...(cursor.filter ? [{ $match: cursor.filter }] : []),
      { $sort: { at: -1, lastId: -1 } },
      { $limit: limit + 1 },
    ]);

    const page = rows.slice(0, limit);
    const [people, messageable] = await Promise.all([
      User.find({ _id: { $in: page.map((row) => row._id) } })
        .select('name role department profileImage isActive deletedAt')
        .lean(),
      messageableUserIds(req.user),
    ]);
    const peopleById = new Map(people.map((person) => [String(person._id), person]));
    const allowed = messageable && new Set(messageable);

    const data = page.map((row) => {
      const id = String(row._id);
      const person = peopleById.get(id);
      // Deleted accounts are kept anonymised; one missing altogether reads the same
      const deleted = !person || Boolean(person.deletedAt);
      const isActive = !deleted && person.isActive !== false;
      return {
        user: {
          _id: id,
          name: deleted ? DELETED_USER_NAME : person.name,
          role: deleted ? null : person.role,
          department: deleted ? null : person.department || null,
          profileImage: deleted ? null : person.profileImage || null,
          isActive,
          deleted,
        },
        lastMessage: {
          _id: row.lastId,
          text: row.deletedAt ? '' : (row.text || '').slice(0, PREVIEW_LENGTH),
          at: row.at,
          fromMe: sameId(row.lastSender, me),
          isRead: row.isRead,
          deleted: Boolean(row.deletedAt),
        },
        unreadCount: row.unreadCount,
        // The same rule as sending (directMessageProblem), for every row at once
        canMessage: isActive && (allowed === null || allowed.has(id)),
      };
    });

    res.json({ success: true, count: data.length, data, hasMore: rows.length > limit });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Loads a direct message the current user sent or received, or sends why not
// and returns null
const findOwnDirectMessage = async (req, res, select = '') => {
  const { messageId } = req.params;
  if (!isId(messageId)) {
    res.status(400).json({ success: false, message: 'Invalid message' });
    return null;
  }
  const message = await Chat.findOne({
    _id: messageId,
    $or: [{ sender: req.user._id }, { receiver: req.user._id }],
  }).select(select);
  if (!message) {
    res.status(404).json({ success: false, message: 'Message not found' });
    return null;
  }
  return message;
};

// Deletes a message (Chat or TeamChatMessage) the way the chat shows it:
// its text is emptied and deletedAt set. In one conditional update, so an
// edit or another delete at the same moment can't undo it or do it twice.
// Returns the message as it is now (null if it no longer exists), and
// whether this call deleted it.
const softDelete = async (Model, message) => {
  if (message.deletedAt) return { current: message, deleted: false };
  const deleted = await Model.findOneAndUpdate(
    { _id: message._id, deletedAt: null },
    { $set: { message: '', deletedAt: new Date() } },
    { new: true },
  );
  if (deleted) return { current: deleted, deleted: true };
  // Deleted by another request since it was loaded
  return { current: await Model.findById(message._id), deleted: false };
};

// The sender corrects a direct message, within 24 hours of sending it, while
// they may still message the receiver
export const editMessage = async (req, res) => {
  try {
    const { message: text } = req.body;
    const invalid = textProblem(text, 'Message cannot be empty');
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const message = await findOwnDirectMessage(req, res);
    if (!message) return;

    if (!sameId(message.sender, req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only edit your own messages' });
    }
    if (message.deletedAt) {
      return res.status(409).json({ success: false, message: ALREADY_DELETED });
    }
    if (tooOldToEdit(message.timestamp)) {
      return res.status(409).json({ success: false, message: TOO_OLD_TO_EDIT });
    }

    // An edit is new text for the receiver, so the messaging rule (and any
    // block since) applies as it does to sending
    const problem = await directMessageProblem(req.user, message.receiver);
    if (problem) {
      return res.status(problem.status).json({ success: false, message: problem.message });
    }

    const rooms = conversationRooms(message);
    const changed = message.message !== text.trim();
    let result = message;
    if (changed) {
      // Only if it is still not deleted: a delete from another tab since it
      // was loaded must not get its text back
      result = await Chat.findOneAndUpdate(
        { _id: message._id, sender: req.user._id, deletedAt: null },
        { $set: { message: text.trim(), isEdited: true, editedAt: new Date() } },
        { new: true },
      );
      if (!result) {
        return res.status(409).json({ success: false, message: ALREADY_DELETED });
      }
    }
    await result.populate(participants);
    if (changed) emitToConversation(req, rooms, 'message_updated', result);

    return res.json({ success: true, data: result });
  } catch (error) {
    sendServerError(res, error);
  }
};

// The sender deletes a direct message: it stays in the conversation, shown as
// deleted, without its text
export const deleteMessage = async (req, res) => {
  try {
    const message = await findOwnDirectMessage(req, res);
    if (!message) return;

    if (!sameId(message.sender, req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only delete your own messages' });
    }

    const rooms = conversationRooms(message);
    const { current, deleted } = await softDelete(Chat, message);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    await current.populate(participants);
    if (deleted) emitToConversation(req, rooms, 'message_deleted', current);

    return res.json({ success: true, data: current });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Why a report reason from a request can't be used, or null. It is optional.
const reasonProblem = (reason) => {
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== 'string') return 'Invalid reason';
  if (reason.length > MAX_REPORT_REASON_LENGTH) {
    return `Reason cannot be longer than ${MAX_REPORT_REASON_LENGTH} characters`;
  }
  return null;
};

// Adds one report by the current user to a message (Chat or
// TeamChatMessage), at most one per person. Returns false if they had
// already reported it.
const addReport = async (Model, message, req) => {
  const at = new Date();
  const { modifiedCount } = await Model.updateOne(
    { _id: message._id, 'reports.by': { $ne: req.user._id } },
    {
      $push: { reports: { by: req.user._id, reason: (req.body.reason || '').trim(), text: message.message, at } },
      $set: { lastReportedAt: at },
    },
  );
  return modifiedCount > 0;
};

const REPORTED_LINK = '/admin/moderation?tab=messages';
const REPORT_THANKS = 'Thanks for telling us. An admin will look at this message.';

const tellAdminsAboutReport = async (req, { where, messageId, kind, teamId }) => {
  const reason = (req.body.reason || '').trim();
  await notify(req, await adminIds(), {
    type: 'message_reported',
    title: `${req.user.name} reported a message`,
    body: `A ${where} was reported${reason ? `: "${reason}"` : '.'}`,
    link: REPORTED_LINK,
    data: { messageId: String(messageId), kind, ...(teamId ? { teamId: String(teamId) } : {}) },
  });
};

// The receiver of a direct message reports it to the admins
export const reportMessage = async (req, res) => {
  try {
    const invalid = reasonProblem(req.body.reason);
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const message = await findOwnDirectMessage(req, res);
    if (!message) return;

    if (!sameId(message.receiver, req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only report messages sent to you' });
    }
    if (message.deletedAt) {
      return res.status(409).json({ success: false, message: ALREADY_DELETED });
    }
    if (!(await addReport(Chat, message, req))) {
      return res.status(409).json({ success: false, message: 'You have already reported this message' });
    }

    await tellAdminsAboutReport(req, { where: 'direct message', messageId: message._id, kind: 'direct' });
    await logAuditEventV2(req, {
      action: 'chat_message_reported',
      targetType: 'Chat',
      targetId: message._id,
      details: { senderId: String(message.sender) },
    });

    return res.status(201).json({ success: true, message: REPORT_THANKS });
  } catch (error) {
    sendServerError(res, error);
  }
};

const isInTeam = (team, user) => teamUserIds(team).includes(user._id.toString());

// Admins can read and write every team's chat; everyone else only their own
const canAccessTeamChat = (team, user) => user.role === 'admin' || isInTeam(team, user);

// Sends a socket event to everyone in the team. Never with an empty list:
// io.to([]) would send it to every connected user.
const emitToTeam = (req, team, event, payload) => {
  const userIds = teamUserIds(team);
  if (userIds.length > 0) req.app.get('io')?.to(userIds).emit(event, payload);
};

// The chat shows only names
const populateTeamMessageDetails = (query) => query.populate([
  { path: 'sender', select: 'name' },
  { path: 'team', select: 'name' },
  { path: 'readBy.user', select: 'name' },
]);

// Loads the team in :teamId when the current user may use its chat, or
// sends why not and returns null
const findTeamChat = async (req, res) => {
  const team = await Team.findById(req.params.teamId).select('name leaders members isActive');
  if (!team) {
    res.status(404).json({ success: false, message: 'Team not found' });
    return null;
  }
  if (!canAccessTeamChat(team, req.user)) {
    res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    return null;
  }
  return team;
};

// Loads :messageId in that team's chat, or sends why not and returns null
const findTeamMessage = async (req, res, team) => {
  const { messageId } = req.params;
  if (!isId(messageId)) {
    res.status(400).json({ success: false, message: 'Invalid message' });
    return null;
  }
  const message = await TeamChatMessage.findOne({ _id: messageId, team: team._id });
  if (!message) {
    res.status(404).json({ success: false, message: 'Message not found' });
    return null;
  }
  return message;
};

export const sendTeamMessage = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { message } = req.body;

    const invalid = textProblem(message, 'Message is required');
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const team = await findTeamChat(req, res);
    if (!team) return;

    // A frozen team's chat can be read but takes no new messages
    if (!team.isActive) {
      return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
    }

    const teamMessage = await TeamChatMessage.create({
      team: teamId,
      sender: req.user._id,
      message: String(message).trim(),
    });

    await populateTeamMessageDetails(teamMessage);

    emitToTeam(req, team, 'receive_team_message', teamMessage);

    await logAuditEventV2(req, {
      action: 'team_message_sent',
      targetType: 'TeamChatMessage',
      targetId: teamMessage._id,
      details: { teamId },
    });

    return res.status(201).json({ success: true, data: teamMessage });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Latest page of a team's chat, oldest first. Pass ?before=<createdAt> and
// ?beforeId=<_id> of the oldest message shown to load the page before it.
export const getTeamMessages = async (req, res) => {
  try {
    const team = await findTeamChat(req, res);
    if (!team) return;

    const cursor = cursorFilter(req.query, 'createdAt');
    if (cursor.error) {
      return res.status(400).json({ success: false, message: cursor.error });
    }
    const filter = { team: team._id, ...cursor.filter };

    // One extra tells us whether there is an older page
    const newestFirst = await populateTeamMessageDetails(
      TeamChatMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(MESSAGE_PAGE_SIZE + 1)
    );

    const hasMore = newestFirst.length > MESSAGE_PAGE_SIZE;
    const messages = newestFirst.slice(0, MESSAGE_PAGE_SIZE).reverse();

    return res.json({ success: true, count: messages.length, data: messages, hasMore });
  } catch (error) {
    sendServerError(res, error);
  }
};

// The sender corrects a team message within 24 hours of sending it. Nothing
// changes in a frozen team, except by an admin.
export const editTeamMessage = async (req, res) => {
  try {
    const { message: text } = req.body;
    const invalid = textProblem(text, 'Message is required');
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const team = await findTeamChat(req, res);
    if (!team) return;
    const message = await findTeamMessage(req, res, team);
    if (!message) return;

    if (!sameId(message.sender, req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only edit your own messages' });
    }
    if (!team.isActive && req.user.role !== 'admin') {
      return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
    }
    if (message.deletedAt) {
      return res.status(409).json({ success: false, message: ALREADY_DELETED });
    }
    if (tooOldToEdit(message.createdAt)) {
      return res.status(409).json({ success: false, message: TOO_OLD_TO_EDIT });
    }

    const changed = message.message !== text.trim();
    let result = message;
    if (changed) {
      // Only if it is still not deleted: a leader's or an admin's delete
      // since it was loaded must not get its text back
      result = await TeamChatMessage.findOneAndUpdate(
        { _id: message._id, team: team._id, sender: req.user._id, deletedAt: null },
        { $set: { message: text.trim(), isEdited: true, editedAt: new Date() } },
        { new: true },
      );
      if (!result) {
        return res.status(409).json({ success: false, message: ALREADY_DELETED });
      }
    }
    await populateTeamMessageDetails(result);
    if (changed) emitToTeam(req, team, 'team_message_updated', result);

    return res.json({ success: true, data: result });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Deletes a team message: it stays in the chat, shown as deleted, without its
// text. The sender may delete their own; the team's leaders and admins any.
// Nothing changes in a frozen team, except by an admin.
export const deleteTeamMessage = async (req, res) => {
  try {
    const team = await findTeamChat(req, res);
    if (!team) return;
    const message = await findTeamMessage(req, res, team);
    if (!message) return;

    const isAdmin = req.user.role === 'admin';
    const isSender = sameId(message.sender, req.user._id);
    if (!isSender && !isAdmin && !isTeamLeader(team, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the sender, the team's leaders or an admin can delete this message",
      });
    }
    if (!team.isActive && !isAdmin) {
      return res.status(400).json({ success: false, message: FROZEN_TEAM_MESSAGE });
    }

    const senderId = String(message.sender);
    const { current, deleted } = await softDelete(TeamChatMessage, message);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    await populateTeamMessageDetails(current);

    if (deleted) {
      emitToTeam(req, team, 'team_message_deleted', current);
      // Someone else removing a message is a moderation action
      if (!isSender) {
        await logAuditEventV2(req, {
          action: 'chat_message_deleted',
          targetType: 'TeamChatMessage',
          targetId: current._id,
          details: { teamId: String(team._id), senderId },
        });
      }
    }

    return res.json({ success: true, data: current });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Someone in the team, other than the sender, reports a team message to the
// admins. Works while the team is frozen: reports go to admins, and the team
// itself doesn't change.
export const reportTeamMessage = async (req, res) => {
  try {
    const invalid = reasonProblem(req.body.reason);
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const team = await findTeamChat(req, res);
    if (!team) return;
    if (!isInTeam(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Only people in this team can report its messages' });
    }
    const message = await findTeamMessage(req, res, team);
    if (!message) return;

    if (sameId(message.sender, req.user._id)) {
      return res.status(403).json({ success: false, message: 'You cannot report your own message' });
    }
    if (message.deletedAt) {
      return res.status(409).json({ success: false, message: ALREADY_DELETED });
    }
    if (!(await addReport(TeamChatMessage, message, req))) {
      return res.status(409).json({ success: false, message: 'You have already reported this message' });
    }

    await tellAdminsAboutReport(req, {
      where: `message in the ${team.name} team chat`, messageId: message._id, kind: 'team', teamId: team._id,
    });
    await logAuditEventV2(req, {
      action: 'chat_message_reported',
      targetType: 'TeamChatMessage',
      targetId: message._id,
      details: { teamId: String(team._id), senderId: String(message.sender) },
    });

    return res.status(201).json({ success: true, message: REPORT_THANKS });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Marks everything sent to the team so far as read by the current user, and
// tells the team once: every message up to `readAt` that someone else sent
// now lists this reader
export const markTeamMessagesAsRead = async (req, res) => {
  try {
    const team = await findTeamChat(req, res);
    if (!team) return;

    // Read receipts are for the team; an admin looking in leaves none
    if (!isInTeam(team, req.user)) {
      return res.json({ success: true, count: 0 });
    }

    const readAt = new Date();
    const { modifiedCount } = await TeamChatMessage.updateMany(
      {
        team: team._id,
        sender: { $ne: req.user._id },
        'readBy.user': { $ne: req.user._id },
        createdAt: { $lte: readAt },
      },
      { $push: { readBy: { user: req.user._id, readAt } } }
    );

    if (modifiedCount > 0) {
      emitToTeam(req, team, 'team_messages_read', {
        teamId: team._id.toString(),
        reader: { _id: req.user._id.toString(), name: req.user.name },
        readAt,
      });
    }

    return res.json({ success: true, count: modifiedCount });
  } catch (error) {
    sendServerError(res, error);
  }
};

export const getMyTeamChats = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const teams = isAdmin
      ? await Team.find({}).select('name leaders members isActive')
      : await myTeams(req.user);

    const teamIds = teams.map((team) => team._id);

    const [latestMessages, unread] = await Promise.all([
      TeamChatMessage.aggregate([
        { $match: { team: { $in: teamIds } } },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: '$team',
            message: { $first: '$message' },
            sender: { $first: '$sender' },
            createdAt: { $first: '$createdAt' },
            deletedAt: { $first: '$deletedAt' },
          },
        },
      ]),
      // Admins looking in leave no read receipts, so nothing is unread for them
      isAdmin ? {} : teamUnreadCounts(req.user._id, teamIds),
    ]);

    const latestMap = new Map(latestMessages.map((item) => [item._id.toString(), item]));

    const chats = teams.map((team) => {
      const latest = latestMap.get(team._id.toString()) || null;
      return {
        teamId: team._id,
        teamName: team.name,
        // false: frozen, the chat is read-only
        isActive: team.isActive,
        lastMessage: latest ? (latest.deletedAt ? '' : latest.message) : null,
        lastMessageDeleted: Boolean(latest?.deletedAt),
        lastMessageSender: latest?.sender || null,
        lastMessageAt: latest?.createdAt || null,
        unreadCount: unread[team._id.toString()] || 0,
      };
    });

    // Most recent conversation first; teams without messages last, by name
    chats.sort((a, b) =>
      (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0) || a.teamName.localeCompare(b.teamName));

    return res.json({ success: true, count: chats.length, data: chats });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Reported direct and team messages for admins, the most recently reported
// first, with who sent them, where, their text now and every report.
// ?before=<lastReportedAt> and ?beforeId=<_id> of the last row shown load the
// next page.
export const getReportedMessages = async (req, res) => {
  try {
    const cursor = cursorFilter(req.query, 'lastReportedAt');
    if (cursor.error) {
      return res.status(400).json({ success: false, message: cursor.error });
    }
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || MESSAGE_PAGE_SIZE));
    const reported = { lastReportedAt: { $exists: true } };
    const filter = cursor.filter ? { $and: [reported, cursor.filter] } : reported;
    const reporters = { path: 'reports.by', select: 'name' };
    const newest = { lastReportedAt: -1, _id: -1 };

    const [direct, team] = await Promise.all([
      Chat.find(filter).select('+reports +lastReportedAt').sort(newest).limit(limit + 1)
        .populate([...participants, reporters]).lean(),
      TeamChatMessage.find(filter).select('+reports +lastReportedAt').sort(newest).limit(limit + 1)
        .populate([{ path: 'sender', select: 'name' }, { path: 'team', select: 'name' }, reporters]).lean(),
    ]);

    const rows = [
      ...direct.map((m) => ({ ...m, kind: 'direct', sentAt: m.timestamp, team: null })),
      ...team.map((m) => ({ ...m, kind: 'team', sentAt: m.createdAt, receiver: null })),
    ].sort((a, b) => b.lastReportedAt - a.lastReportedAt || String(b._id).localeCompare(String(a._id)));

    const data = rows.slice(0, limit).map((m) => ({
      _id: m._id,
      kind: m.kind,
      sender: m.sender || null,
      receiver: m.receiver || null,
      team: m.team || null,
      text: m.message,
      sentAt: m.sentAt,
      isEdited: Boolean(m.isEdited),
      deletedAt: m.deletedAt || null,
      reportCount: m.reports.length,
      lastReportedAt: m.lastReportedAt,
      reports: [...m.reports].sort((a, b) => b.at - a.at),
    }));

    return res.json({ success: true, count: data.length, data, hasMore: rows.length > limit });
  } catch (error) {
    sendServerError(res, error);
  }
};
