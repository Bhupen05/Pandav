import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import { sendServerError } from '../utils/http.js';

const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_PAGE_SIZE = 50;

// Only expose what the chat UI needs about each participant
const participants = [
  { path: 'sender', select: 'name' },
  { path: 'receiver', select: 'name' },
];

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
      await Chat.updateMany({ sender: userId, receiver: currentUserId, isRead: false }, { isRead: true });
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

    await Chat.updateMany({ sender: userId, receiver: req.user.id, isRead: false }, { isRead: true });
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
