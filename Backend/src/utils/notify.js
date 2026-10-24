import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { appUrl, sendMail } from './mailer.js';
import { getIo } from './realtime.js';

const idOf = (ref) => String(ref?._id ?? ref);

// Tells users about something that happened. Each recipient gets a stored
// notification and, if they are online, a 'notification' socket event with it.
// With `email: true` it is also emailed to recipients who haven't turned
// email notifications off (when email is set up; see utils/mailer.js).
//
//   notify(req, [userId, ...], { type, title, body?, link?, data?, email? })
//
// `req` is the request that caused it (its user is the actor, who is never
// notified about their own action), or null in background jobs. Recipients
// who are deactivated or deleted are skipped, and so are duplicates. Never
// throws: a failed notification must not fail the action that caused it.
// Returns the notifications created.
export const notify = async (req, recipients, { type, title, body, link, data = {}, email = false }) => {
  try {
    const actorId = req?.user?._id ? String(req.user._id) : null;
    const ids = [...new Set([].concat(recipients || []).filter(Boolean).map(idOf))]
      .filter((id) => id !== actorId);
    if (ids.length === 0) return [];

    const users = await User.find({ _id: { $in: ids }, isActive: true, deletedAt: null })
      .select('name email emailNotifications');
    if (users.length === 0) return [];

    const notifications = await Notification.insertMany(users.map((user) => ({
      user: user._id,
      type,
      title,
      body,
      link,
      actor: actorId,
      data,
    })));

    const io = getIo();
    if (io) {
      for (const notification of notifications) {
        io.to(String(notification.user)).emit('notification', notification);
      }
    }

    if (email) {
      const text = [body, link ? `Open it in Pandav: ${appUrl(link)}` : null].filter(Boolean).join('\n\n');
      for (const user of users) {
        if (user.emailNotifications === false) continue;
        await sendMail({ to: user.email, name: user.name, subject: title, text: text || title });
      }
    }

    return notifications;
  } catch (error) {
    console.error('Notification failed:', error.message);
    return [];
  }
};

// Ids of every active admin, for things only an admin can act on
export const adminIds = async () =>
  (await User.find({ role: 'admin', isActive: true, deletedAt: null }).distinct('_id')).map(String);
