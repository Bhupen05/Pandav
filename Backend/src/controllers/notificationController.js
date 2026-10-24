import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import { sendServerError } from '../utils/http.js';

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const unreadCount = (userId) => Notification.countDocuments({ user: userId, readAt: null });

// @desc    The current user's notifications, newest first, a page at a time.
//          ?before=<id of the oldest one shown> loads the page before it;
//          ?unread=true only those not read yet.
// @route   GET /api/v2/notifications
// @access  Private
export const getNotifications = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.unread === 'true') filter.readAt = null;
    if (req.query.before) {
      if (!mongoose.isObjectIdOrHexString(req.query.before)) {
        return res.status(400).json({ success: false, message: 'Invalid before' });
      }
      filter._id = { $lt: req.query.before };
    }
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE));

    // One extra tells us whether there is an older page
    const rows = await Notification.find(filter)
      .populate('actor', 'name profileImage')
      .sort({ _id: -1 })
      .limit(limit + 1);
    const data = rows.slice(0, limit);

    res.json({
      success: true,
      count: data.length,
      data,
      hasMore: rows.length > limit,
      unreadCount: await unreadCount(req.user._id),
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    How many of the current user's notifications are unread
// @route   GET /api/v2/notifications/unread-count
// @access  Private
export const getUnreadNotificationCount = async (req, res) => {
  try {
    res.json({ success: true, data: { count: await unreadCount(req.user._id) } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Mark one notification as read
// @route   PATCH /api/v2/notifications/:id/read
// @access  Private (its recipient)
export const markNotificationRead = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification' });
    }
    const notification = await Notification.findOne({ _id: req.params.id, user: req.user._id });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
    }
    res.json({ success: true, data: notification, unreadCount: await unreadCount(req.user._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Mark all of the current user's notifications as read
// @route   PATCH /api/v2/notifications/read-all
// @access  Private
export const markAllNotificationsRead = async (req, res) => {
  try {
    const { modifiedCount } = await Notification.updateMany(
      { user: req.user._id, readAt: null },
      { readAt: new Date() }
    );
    res.json({ success: true, count: modifiedCount, unreadCount: 0 });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete one notification
// @route   DELETE /api/v2/notifications/:id
// @access  Private (its recipient)
export const deleteNotification = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification' });
    }
    const { deletedCount } = await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
    if (!deletedCount) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, unreadCount: await unreadCount(req.user._id) });
  } catch (error) {
    sendServerError(res, error);
  }
};
