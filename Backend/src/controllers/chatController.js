import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import Team from '../models/Team.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendServerError } from '../utils/http.js';

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

    if (!mongoose.isObjectIdOrHexString(receiverId)) {
      return res.status(400).json({ success: false, message: 'Invalid receiver' });
    }

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message cannot be longer than ${MAX_MESSAGE_LENGTH} characters`,
      });
    }

    const receiver = await User.exists({ _id: receiverId, isActive: true });
    if (!receiver) {
      return res.status(404).json({ success: false, message: 'Recipient not found' });
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

const canAccessTeamChat = (team, user) => {
  if (user.role === 'admin') return true;

  const userId = user._id.toString();
  const isLeader = team.leaders.some((leaderId) => leaderId.toString() === userId);
  const isMember = team.members.some((memberId) => memberId.toString() === userId);

  return isLeader || isMember;
};

const populateTeamMessageDetails = (query) => query.populate([
  { path: 'sender', select: 'name email role profileImage' },
  { path: 'team', select: 'name leaders members' },
  { path: 'readBy.user', select: 'name email role profileImage' },
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
    if (!team || !team.isActive) {
      return res.status(404).json({ success: false, message: 'Team not found or inactive' });
    }

    if (!canAccessTeamChat(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    }

    const teamMessage = await TeamChatMessage.create({
      team: teamId,
      sender: req.user._id,
      message: String(message).trim(),
    });

    await populateTeamMessageDetails(teamMessage);

    const io = req.app.get('io');
    if (io) {
      const targetUserIds = [
        ...new Set([
          ...team.leaders.map((id) => id.toString()),
          ...team.members.map((id) => id.toString()),
        ]),
      ];

      targetUserIds.forEach((userId) => {
        io.to(userId).emit('receive_team_message', teamMessage);
      });
    }

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

export const getTeamMessages = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId).select('name leaders members isActive');
    if (!team || !team.isActive) {
      return res.status(404).json({ success: false, message: 'Team not found or inactive' });
    }

    if (!canAccessTeamChat(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    }

    const messages = await TeamChatMessage.find({ team: teamId })
      .populate('sender', 'name email role profileImage')
      .populate('readBy.user', 'name email role profileImage')
      .sort({ createdAt: 1 });

    return res.json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    sendServerError(res, error);
  }
};

export const markTeamMessagesAsRead = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId).select('name leaders members isActive');
    if (!team || !team.isActive) {
      return res.status(404).json({ success: false, message: 'Team not found or inactive' });
    }

    if (!canAccessTeamChat(team, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized for this team chat' });
    }

    const unreadMessages = await TeamChatMessage.find({
      team: teamId,
      sender: { $ne: req.user._id },
      'readBy.user': { $ne: req.user._id },
    });

    if (unreadMessages.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const readAt = new Date();

    for (const message of unreadMessages) {
      message.readBy.push({ user: req.user._id, readAt });
      await message.save();
    }

    const updatedMessages = await populateTeamMessageDetails(
      TeamChatMessage.find({ _id: { $in: unreadMessages.map((message) => message._id) } }).sort({ createdAt: 1 })
    );

    const io = req.app.get('io');
    if (io) {
      const targetUserIds = [
        ...new Set([
          ...team.leaders.map((id) => id.toString()),
          ...team.members.map((id) => id.toString()),
        ]),
      ];

      updatedMessages.forEach((message) => {
        targetUserIds.forEach((userId) => {
          io.to(userId).emit('team_message_read', message);
        });
      });
    }

    return res.json({ success: true, count: updatedMessages.length, data: updatedMessages });
  } catch (error) {
    sendServerError(res, error);
  }
};

export const getMyTeamChats = async (req, res) => {
  try {
    const teamFilter = req.user.role === 'admin'
      ? {}
      : { $or: [{ leaders: req.user._id }, { members: req.user._id }] };

    const teams = await Team.find(teamFilter)
      .select('name leaders members')
      .sort({ updatedAt: -1 });

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
        lastMessage: latest?.message || null,
        lastMessageSender: latest?.sender || null,
        lastMessageAt: latest?.createdAt || null,
      };
    });

    return res.json({ success: true, count: chats.length, data: chats });
  } catch (error) {
    sendServerError(res, error);
  }
};
