import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import Team from '../models/Team.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.user._id;

    const newMessage = new Chat({
      sender: senderId,
      receiver: receiverId,
      message
    });

    await newMessage.save();
    await newMessage.populate('sender receiver');

    // Emit the fully populated message to receiver's room in real-time
    const io = req.app.get('io');
    if (io) {
      io.to(receiverId.toString()).emit('receive_message', newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    const messages = await Chat.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    })
      .populate(['sender', 'receiver'])
      .sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getChats = async (req, res) => {
  try {
    const userId = req.user.id;

    const chats = await Chat.aggregate([
      {
        $match: {
          $or: [{ sender: new mongoose.Types.ObjectId(userId) }, { receiver: new mongoose.Types.ObjectId(userId) }]
        }
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$sender', new mongoose.Types.ObjectId(userId)] },
              '$receiver',
              '$sender'
            ]
          },
          lastMessage: { $first: '$message' },
          timestamp: { $first: '$timestamp' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      }
    ]);

    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Chat.findOne({
      _id: messageId,
      receiver: req.user._id,
    }).populate(['sender', 'receiver']);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (!message.isRead) {
      message.isRead = true;
      await message.save();
      await message.populate(['sender', 'receiver']);

      const io = req.app.get('io');
      if (io) {
        io.to(message.sender._id.toString()).emit('message_read', message);
      }
    }

    return res.json(message);
  } catch (error) {
    return res.status(500).json({ message: error.message });
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

    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
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
    return res.status(500).json({ success: false, message: error.message });
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
    return res.status(500).json({ success: false, message: error.message });
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
    return res.status(500).json({ success: false, message: error.message });
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
    return res.status(500).json({ success: false, message: error.message });
  }
};
