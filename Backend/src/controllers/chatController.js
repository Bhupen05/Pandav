import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import { sendServerError } from '../utils/http.js';

const MAX_MESSAGE_LENGTH = 2000;

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

export const getMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    if (!mongoose.isObjectIdOrHexString(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }

    const messages = await Chat.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId }
      ]
    })
      .populate(participants)
      .sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    sendServerError(res, error);
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
        // Aggregations ignore the schema's select: false, so project
        // explicitly to keep password hashes and other fields out
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, profileImage: 1 } }],
          as: 'user'
        }
      }
    ]);

    res.json(chats);
  } catch (error) {
    sendServerError(res, error);
  }
};
