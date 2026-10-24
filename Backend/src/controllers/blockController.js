import mongoose from 'mongoose';
import Block from '../models/Block.js';
import NetworkConnection from '../models/NetworkConnectionV2.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { sendServerError } from '../utils/http.js';
import { contactsChanged } from '../utils/messaging.js';

// A block works both ways: neither person can message the other, see the
// other typing or online, or ask to connect (utils/blocks.js). The person
// blocked isn't told.

const blockedPerson = (user, blockedAt) => ({
  _id: user._id,
  name: user.name,
  profileImage: user.profileImage || null,
  blockedAt,
});

// @desc    Block someone. Blocking them again changes nothing.
// @route   POST /api/v2/chat/blocks   { userId }
// @access  Private
export const blockUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (typeof userId !== 'string' || !mongoose.isObjectIdOrHexString(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }
    // Ids can come spelt in capitals; the caller's own id is lower case
    const otherId = userId.toLowerCase();
    if (otherId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself' });
    }

    const target = await User.findOne({ _id: otherId, deletedAt: null }).select('name role profileImage');
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Admins can always reach people, and people can always reach the admins
    if (target.role === 'admin') {
      return res.status(400).json({ success: false, message: "Admins can't be blocked" });
    }

    let block = await Block.findOne({ blocker: req.user._id, blocked: target._id });
    const created = !block;
    if (created) {
      try {
        block = await Block.create({ blocker: req.user._id, blocked: target._id });
      } catch (error) {
        // The same block made by a request at the same moment
        if (error.code !== 11000) throw error;
        block = await Block.findOne({ blocker: req.user._id, blocked: target._id });
      }
    }

    // Otherwise a connection would let messages through again after
    // unblocking, and a waiting request could be accepted meanwhile
    const { deletedCount } = await NetworkConnection.deleteMany({
      status: { $in: ['accepted', 'pending'] },
      $or: [
        { requester: req.user._id, recipient: target._id },
        { requester: target._id, recipient: req.user._id },
      ],
    });

    if (created) {
      await logAuditEventV2(req, {
        action: 'chat_user_blocked',
        targetType: 'User',
        targetId: target._id,
        details: { connectionsRemoved: deletedCount },
      });
    }

    // Each stops seeing the other online, and typing stops at once
    contactsChanged([req.user._id, target._id]);

    return res.status(created ? 201 : 200).json({
      success: true,
      message: `You blocked ${target.name}`,
      data: blockedPerson(target, block.createdAt),
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Unblock someone the current user blocked. If they blocked the
//          current user too, that block stays.
// @route   DELETE /api/v2/chat/blocks/:userId
// @access  Private
export const unblockUser = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }
    // Sockets' rooms and the audit log use lower-case ids
    const userId = req.params.userId.toLowerCase();

    const { deletedCount } = await Block.deleteOne({ blocker: req.user._id, blocked: userId });
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'You have not blocked this person' });
    }

    await logAuditEventV2(req, {
      action: 'chat_user_unblocked',
      targetType: 'User',
      targetId: userId,
    });

    contactsChanged([req.user._id, userId]);

    return res.json({ success: true, message: 'Unblocked' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The people the current user has blocked, most recent first.
//          Deactivated accounts are listed (the block stays if the account
//          comes back, so it can be lifted here); deleted ones are not.
// @route   GET /api/v2/chat/blocks
// @access  Private
export const getBlockedUsers = async (req, res) => {
  try {
    const blocks = await Block.find({ blocker: req.user._id })
      .sort({ createdAt: -1 })
      .populate({ path: 'blocked', select: 'name profileImage', match: { deletedAt: null } });

    const data = blocks
      .filter((block) => block.blocked)
      .map((block) => blockedPerson(block.blocked, block.createdAt));

    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    sendServerError(res, error);
  }
};
