import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import Team from '../models/Team.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendServerError } from '../utils/http.js';
import { directMessageProblem } from '../utils/messaging.js';
import { FROZEN_TEAM_MESSAGE, teamUserIds } from '../utils/teams.js';

const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_PAGE_SIZE = 50;

// Only expose what the chat UI needs about each participant
const participants = [
  { path: 'sender', select: 'name' },
  { path: 'receiver', select: 'name' },
];

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

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.user._id;

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`,
      });
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
    await newMessage.populate(participants);

    // Emit the populated message to receiver's room in real-time
    const io = req.app.get('io');
    if (io) {
      io.to(receiverId.toString()).emit('receive_message', newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    sendServerError(res, error);
  }
};

// Latest page of a conversation, oldest first. Pass ?before=<timestamp of the
// oldest message shown> to load the page before it.
export const getMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    if (!mongoose.isObjectIdOrHexString(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }

    const filter = {
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    };

    if (req.query.before) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid before date' });
      }
      filter.timestamp = { $lt: before };
    }

    // One extra tells us whether there is an older page
    const newestFirst = await Chat.find(filter)
      .populate(participants)
      .sort({ timestamp: -1 })
      .limit(MESSAGE_PAGE_SIZE + 1);

    const hasMore = newestFirst.length > MESSAGE_PAGE_SIZE;
    const messages = newestFirst.slice(0, MESSAGE_PAGE_SIZE).reverse();

    // Opening the conversation reads everything the other person sent
    if (!req.query.before) {
      await markConversationRead(req, userId, currentUserId);
      messages.forEach((m) => {
        if (m.sender?._id?.toString() === userId) m.isRead = true;
      });
    }

    res.json({ success: true, data: messages, hasMore });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Marks everything from :userId to the current user as read (a new message
// arrived while their conversation was open)
export const markAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isObjectIdOrHexString(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }

    await markConversationRead(req, userId, req.user.id);
    res.json({ success: true });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Unread message counts for the current user, keyed by sender id
export const getUnreadCounts = async (req, res) => {
  try {
    const rows = await Chat.aggregate([
      { $match: { receiver: new mongoose.Types.ObjectId(req.user.id), isRead: false } },
      { $group: { _id: '$sender', count: { $sum: 1 } } }
    ]);

    const counts = Object.fromEntries(rows.map(({ _id, count }) => [_id.toString(), count]));
    res.json({ success: true, data: counts });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Marks one message sent to the current user as read and tells the sender
export const markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.isObjectIdOrHexString(messageId)) {
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
      if (io) {
        io.to(message.sender._id.toString()).emit('message_read', message);
      }
    }

    return res.json(message);
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

export const sendTeamMessage = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { message } = req.body;

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`,
      });
    }

    const team = await Team.findById(teamId).select('name leaders members isActive');
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    if (!canAccessTeamChat(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    }

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

// Latest page of a team's chat, oldest first. Pass ?before=<createdAt of the
// oldest message shown> to load the page before it.
export const getTeamMessages = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId).select('name leaders members isActive');
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    if (!canAccessTeamChat(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    }

    const filter = { team: team._id };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid before date' });
      }
      filter.createdAt = { $lt: before };
    }

    // One extra tells us whether there is an older page
    const newestFirst = await populateTeamMessageDetails(
      TeamChatMessage.find(filter).sort({ createdAt: -1 }).limit(MESSAGE_PAGE_SIZE + 1)
    );

    const hasMore = newestFirst.length > MESSAGE_PAGE_SIZE;
    const messages = newestFirst.slice(0, MESSAGE_PAGE_SIZE).reverse();

    return res.json({ success: true, count: messages.length, data: messages, hasMore });
  } catch (error) {
    sendServerError(res, error);
  }
};

// Marks everything sent to the team so far as read by the current user, and
// tells the team once: every message up to `readAt` that someone else sent
// now lists this reader
export const markTeamMessagesAsRead = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId).select('name leaders members isActive');
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    if (!canAccessTeamChat(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    }

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
    const teamFilter = req.user.role === 'admin'
      ? {}
      : { $or: [{ leaders: req.user._id }, { members: req.user._id }] };

    const teams = await Team.find(teamFilter).select('name leaders members isActive');

    const teamIds = teams.map((team) => team._id);

    const latestMessages = await TeamChatMessage.aggregate([
      { $match: { team: { $in: teamIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$team',
          message: { $first: '$message' },
          sender: { $first: '$sender' },
          createdAt: { $first: '$createdAt' },
        },
      },
    ]);

    const latestMap = new Map(latestMessages.map((item) => [item._id.toString(), item]));

    const chats = teams.map((team) => {
      const latest = latestMap.get(team._id.toString()) || null;
      return {
        teamId: team._id,
        teamName: team.name,
        // false: frozen, the chat is read-only
        isActive: team.isActive,
        lastMessage: latest?.message || null,
        lastMessageSender: latest?.sender || null,
        lastMessageAt: latest?.createdAt || null,
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
