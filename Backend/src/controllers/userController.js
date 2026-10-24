import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import User, { SECOND_FACTOR_FIELDS, TWO_FACTOR_OFF, acceptSecondFactor } from '../models/User.js';
import Task from '../models/Task.js';
import Attendance from '../models/Attendance.js';
import AuthToken from '../models/AuthToken.js';
import Block from '../models/Block.js';
import Chat from '../models/Chat.js';
import Notification from '../models/Notification.js';
import Team from '../models/Team.js';
import TeamInvite from '../models/TeamInvite.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import SocialPost from '../models/SocialPostV2.js';
import SocialIntegration from '../models/SocialIntegrationV2.js';
import SocialPublishJob from '../models/SocialPublishJobV2.js';
import PersonalTask from '../models/PersonalTaskV2.js';
import NetworkConnection from '../models/NetworkConnectionV2.js';
import {
  sendAdminResetNotice,
  sendEmailChangedNotice,
  sendTwoFactorResetNotice,
  sendVerificationEmail,
} from './authController.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { escapeRegex, listResponse, pick, sendServerError } from '../utils/http.js';
import { messageableUserIds } from '../utils/messaging.js';
import { notify } from '../utils/notify.js';
import { disconnectUserSockets } from '../utils/realtime.js';
import { clearSessionCookie } from '../utils/session.js';
import { isInAnyTeam } from '../utils/teams.js';

const TEAM_ROLES = ['team_leader', 'team_member'];

// Fields a user may change on their own profile
const SELF_EDITABLE_FIELDS = ['name', 'email', 'phone', 'department', 'profileImage', 'emailNotifications'];
// Admins can additionally change role and active status
const ADMIN_EDITABLE_FIELDS = [...SELF_EDITABLE_FIELDS, 'role', 'isActive'];
const BOOLEAN_FIELDS = ['isActive', 'emailNotifications'];

// GET /users ?sort= values
const SORTS = {
  name: { name: 1 },
  '-name': { name: -1 },
  email: { email: 1 },
  '-email': { email: -1 },
  createdAt: { createdAt: 1 },
  '-createdAt': { createdAt: -1 },
  lastLoginAt: { lastLoginAt: 1 },
  '-lastLoginAt': { lastLoginAt: -1 },
};

const ACCOUNT_DELETED = 'This account has been deleted';

// Whether the request is about the signed-in user's own account. Ids are hex,
// so compare them case-insensitively.
const isOwnAccount = (req) => String(req.params.id).toLowerCase() === req.user.id;

// A team the user is the only leader of, if any. A team always has a leader,
// so its only one can't be deleted or deactivated.
const soleLedTeam = (userId) => Team.findOne({ leaders: [userId] }).select('name');

const onlyLeaderMessage = (name, team) =>
  `${name} is the only leader of ${team.name}. Make someone else its leader or delete the team first.`;

// Deletes an account. The record stays, anonymised and deactivated, so the
// tasks, approvals and messages it took part in still point at someone
// ("Deleted user"); what belongs only to the user is removed. The account is
// made unusable first, so it is signed out at once. Everything here can run
// again on an account already deleted, which finishes a cleanup that stopped
// part-way (there are no transactions on a standalone MongoDB).
const deleteAccount = async (user) => {
  const id = user._id;
  // A password nobody knows, hashed as the model would (updateOne skips its hook)
  const password = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10);
  await User.updateOne({ _id: id }, {
    $set: {
      name: 'Deleted user',
      email: `deleted-${id}@deleted.invalid`,
      role: 'user',
      teamId: null,
      isActive: false,
      deletedAt: user.deletedAt || new Date(),
      password,
      passwordChangedAt: new Date(),
      emailVerified: false,
      mustChangePassword: false,
      emailNotifications: false,
      ...TWO_FACTOR_OFF.$set,
    },
    $unset: { phone: '', department: '', profileImage: '', emailVerifiedAt: '', ...TWO_FACTOR_OFF.$unset },
    $inc: { tokenVersion: 1 },
  });
  await disconnectUserSockets(id);

  // Open tasks stop waiting on them; finished ones keep them as the record
  // of who did the work
  await Task.unassignUser(id);
  await Promise.all([
    Attendance.deleteMany({ user: id }),
    Chat.deleteMany({ $or: [{ sender: id }, { receiver: id }] }),
    Team.updateMany(
      { $or: [{ leaders: id }, { members: id }] },
      { $pull: { leaders: id, members: id } }
    ),
    TeamInvite.deleteMany({ $or: [{ invitedUser: id }, { invitedBy: id }] }),
    TeamChatMessage.deleteMany({ sender: id }),
    TeamChatMessage.updateMany({ 'readBy.user': id }, { $pull: { readBy: { user: id } } }),
    // Social Hub: their posts, linked accounts (and stored tokens), jobs,
    // personal tasks and connections go; their likes and comments too
    SocialPost.deleteMany({ author: id }),
    SocialPost.updateMany(
      { $or: [{ likes: id }, { 'comments.user': id }] },
      { $pull: { likes: id, comments: { user: id } } }
    ),
    SocialIntegration.deleteMany({ user: id }),
    SocialPublishJob.deleteMany({ owner: id }),
    PersonalTask.deleteMany({ user: id }),
    NetworkConnection.deleteMany({ $or: [{ requester: id }, { recipient: id }] }),
    Notification.deleteMany({ user: id }),
    Block.deleteMany({ $or: [{ blocker: id }, { blocked: id }] }),
    AuthToken.deleteMany({ user: id }),
  ]);
};

// @desc    Search users by name (admins: name or email; only they see emails)
// @route   GET /api/v2/users/search?q=...
// @access  Private
export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;

    if (typeof q !== 'string' || q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    // Matched as plain text, not as a regular expression. Only admins see
    // or search addresses. Others search names only: matching even a whole
    // address would tell anyone who signs up whose address it is.
    const pattern = { $regex: escapeRegex(q.trim()), $options: 'i' };
    const isAdmin = req.user.role === 'admin';
    const users = await User.find({
      ...(isAdmin ? { $or: [{ name: pattern }, { email: pattern }] } : { name: pattern }),
      _id: { $ne: req.user._id }, // Don't show current user
      isActive: true,
      deletedAt: null,
    })
      .select(isAdmin ? '_id name email role department profileImage' : '_id name role department profileImage')
      .sort({ name: 1 })
      .limit(10);

    res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The people the current user may message: everyone for an admin;
//          otherwise teammates, Social Hub connections, and anyone who has
//          messaged them (see directMessageProblem)
// @route   GET /api/v2/users/chat-list
// @access  Private
export const getChatUsers = async (req, res) => {
  try {
    const ids = await messageableUserIds(req.user);
    const users = await User.find({
      _id: ids ? { $in: ids } : { $ne: req.user._id },
      isActive: true,
      deletedAt: null,
    })
      .select('_id name email role department profileImage')
      .sort({ name: 1 });
    res.json({ success: true, data: users });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get all users
// @route   GET /api/v2/users
// @access  Private (Admin)
export const getUsers = async (req, res) => {
  try {
    const { role, department, isActive, q, sort, includeDeleted } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    // Deleted accounts are kept anonymised; they are listed only on request
    if (includeDeleted !== 'true') filter.deletedAt = null;
    if (typeof q === 'string' && q.trim()) {
      const pattern = { $regex: escapeRegex(q.trim()), $options: 'i' };
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    if (sort !== undefined && !Object.hasOwn(SORTS, sort)) {
      return res.status(400).json({ success: false, message: `sort must be one of ${Object.keys(SORTS).join(', ')}` });
    }
    // _id last, so pages don't overlap when the sorted values are equal
    const order = { ...(SORTS[sort] || SORTS.createdAt), _id: 1 };

    const query = User.find(filter).select('-password').sort(order);

    res.json(await listResponse(User, filter, query, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single user
// @route   GET /api/v2/users/:id
// @access  Private
export const getUser = async (req, res) => {
  try {
    // Users can only view their own profile unless they're admin (checked
    // first, so others can't learn which ids exist)
    if (req.user.role !== 'admin' && !isOwnAccount(req)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this profile'
      });
    }

    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Update user
// @route   PUT /api/v2/users/:id
// @access  Private
export const updateUser = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const isSelf = isOwnAccount(req);

    // Users can only update their own profile unless they're admin
    if (!isAdmin && !isSelf) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    // Only whitelisted fields; password changes go through /api/auth/updatepassword
    const updates = pick(req.body, isAdmin ? ADMIN_EDITABLE_FIELDS : SELF_EDITABLE_FIELDS);

    // Form posts send "true"/"false"; the checks below need a real boolean
    for (const field of BOOLEAN_FIELDS) {
      if (updates[field] === undefined) continue;
      if (updates[field] === 'true' || updates[field] === 'false') updates[field] = updates[field] === 'true';
      if (typeof updates[field] !== 'boolean') {
        return res.status(400).json({ success: false, message: `${field} must be true or false` });
      }
    }

    // Stop admins from locking themselves out
    if (isAdmin && isSelf && ((updates.role && updates.role !== 'admin') || updates.isActive === false)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot remove your own admin access or deactivate yourself'
      });
    }

    const current = await User.findById(req.params.id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    if (current.deletedAt) {
      return res.status(409).json({ success: false, message: ACCOUNT_DELETED });
    }

    // Team roles follow team membership, so they change only through the
    // team screens; otherwise the user and the team would disagree
    const roleChanged = updates.role !== undefined && updates.role !== current.role;
    if (roleChanged) {
      if (TEAM_ROLES.includes(updates.role)) {
        return res.status(400).json({
          success: false,
          message: 'Team roles are given by adding the user to a team',
        });
      }
      if (await isInAnyTeam(current._id)) {
        return res.status(400).json({
          success: false,
          message: 'Remove this user from their team before changing their role',
        });
      }
    }

    // A new address has to be confirmed again. Changing your own needs your
    // password, so someone at an unlocked computer can't take the account
    // over through "forgot password".
    if (updates.email !== undefined) {
      if (typeof updates.email !== 'string') {
        return res.status(400).json({ success: false, message: 'Please provide a valid email' });
      }
      updates.email = updates.email.trim().toLowerCase();
      if (updates.email === current.email) delete updates.email;
    }
    const emailChanged = updates.email !== undefined;
    if (emailChanged && isSelf) {
      const { currentPassword } = req.body;
      if (typeof currentPassword !== 'string' || !currentPassword) {
        return res.status(400).json({ success: false, message: 'Please enter your current password to change your email' });
      }
      const withPassword = await User.findById(current._id).select('+password');
      if (!(await withPassword.comparePassword(currentPassword))) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }
    }

    const deactivating = updates.isActive === false && current.isActive;
    const activating = updates.isActive === true && !current.isActive;
    if (deactivating) {
      const team = await soleLedTeam(current._id);
      if (team) return res.status(400).json({ success: false, message: onlyLeaderMessage(current.name, team) });
    }

    const update = { $set: { ...updates } };
    if (emailChanged) {
      update.$set.emailVerified = false;
      update.$unset = { emailVerifiedAt: '' };
    }
    // Sessions from before a deactivation stay dead after reactivating
    if (deactivating) update.$inc = { tokenVersion: 1 };

    const user = await User.findByIdAndUpdate(current._id, update, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (deactivating) await disconnectUserSockets(user._id);
    if (emailChanged) {
      await sendVerificationEmail(user);
      sendEmailChangedNotice(current);
    }

    // ---------- Audit and notifications ----------
    if (isSelf && emailChanged) {
      await logAuditEventV2(req, { action: 'account_email_changed', targetType: 'User', targetId: user._id });
    }
    if (isAdmin && !isSelf) {
      // Field names only, not the values
      const fields = Object.keys(updates).filter((field) => String(current[field] ?? '') !== String(updates[field] ?? ''));
      if (fields.length > 0) {
        await logAuditEventV2(req, { action: 'admin_user_updated', targetType: 'User', targetId: user._id, details: { fields } });
      }
    }
    if (deactivating || activating) {
      await logAuditEventV2(req, {
        action: deactivating ? 'admin_user_deactivated' : 'admin_user_activated',
        targetType: 'User',
        targetId: user._id,
      });
    }
    if (roleChanged) {
      await logAuditEventV2(req, {
        action: 'admin_role_changed',
        targetType: 'User',
        targetId: user._id,
        details: { from: current.role, to: user.role },
      });
      const madeAdmin = user.role === 'admin';
      await notify(req, [user._id], {
        type: 'account_role_changed',
        title: madeAdmin ? 'You are now an admin' : current.role === 'admin' ? 'You are no longer an admin' : `Your role is now ${user.role}`,
        body: madeAdmin
          ? `${req.user.name} made you an admin. Reload Pandav to see the admin pages.`
          : `${req.user.name} changed your role to ${user.role}. Reload Pandav to see your pages.`,
        link: '/profile?tab=security',
        data: { role: user.role, previousRole: current.role },
        email: true,
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete user. Deleting an account that is already deleted finishes
//          its cleanup.
// @route   DELETE /api/v2/users/:id
// @access  Private (Admin)
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting yourself
    if (isOwnAccount(req)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    // A team always has a leader. A deleted account was checked when it was
    // deleted; running the cleanup again takes it off any team it is still on.
    if (!user.deletedAt) {
      const team = await soleLedTeam(user._id);
      if (team) return res.status(400).json({ success: false, message: onlyLeaderMessage(user.name, team) });
    }

    const again = Boolean(user.deletedAt);
    await deleteAccount(user);

    await logAuditEventV2(req, {
      action: 'admin_user_deleted',
      targetType: 'User',
      targetId: user._id,
      details: again ? { cleanupRerun: true } : {},
    });
    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

const ONLY_ADMIN = 'You are the only admin. Make someone else an admin before deleting your account.';

// How many active admins there are besides `userId`
const otherActiveAdmins = (userId) =>
  User.countDocuments({ _id: { $ne: userId }, role: 'admin', isActive: true, deletedAt: null });

// For an admin deleting their own account: whether another active admin
// stays. Without transactions, "count the other admins, then delete" isn't one
// step, so the admin is deactivated first and the others are counted after.
// Of two admins doing this at the same moment, at least one sees the other
// already deactivated and stops (and is reactivated), so the last admin can't
// go.
const anotherAdminStays = async (userId) => {
  const claimed = await User.updateOne({ _id: userId, isActive: true, deletedAt: null }, { $set: { isActive: false } });
  if ((await otherActiveAdmins(userId)) > 0) return true;
  if (claimed.modifiedCount === 1) {
    await User.updateOne({ _id: userId, deletedAt: null }, { $set: { isActive: true } });
  }
  return false;
};

// @desc    Delete your own account, confirmed with your password (and a code
//          when two-step sign-in is on). Signs this browser out.
// @route   DELETE /api/v2/users/me
// @access  Private
export const deleteOwnAccount = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    // Checked before the password and code, so a refused attempt doesn't use
    // up a backup code (and checked again just before deleting, see
    // anotherAdminStays)
    if (isAdmin && (await otherActiveAdmins(req.user._id)) === 0) {
      return res.status(400).json({ success: false, message: ONLY_ADMIN });
    }
    const team = await soleLedTeam(req.user._id);
    if (team) {
      return res.status(400).json({
        success: false,
        message: `You are the only leader of ${team.name}. Make someone else its leader or delete the team first.`,
      });
    }

    const { password, code } = req.body;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, message: 'Please enter your password to delete your account' });
    }
    const user = await User.findById(req.user._id).select(`+password ${SECOND_FACTOR_FIELDS}`);
    if (!(await user.comparePassword(password))) {
      return res.status(400).json({ success: false, message: 'Password is incorrect' });
    }
    if (user.twoFactor?.enabled) {
      if (code === undefined || code === null || String(code).trim() === '') {
        return res.status(400).json({ success: false, message: 'Enter the 6-digit code from your authenticator app, or a backup code' });
      }
      if (!(await acceptSecondFactor(user, code))) {
        return res.status(400).json({ success: false, message: 'That code is not right. Check that the time on your phone is correct, or use a backup code.' });
      }
    }

    if (isAdmin && !(await anotherAdminStays(user._id))) {
      return res.status(400).json({ success: false, message: ONLY_ADMIN });
    }

    await deleteAccount(user);
    clearSessionCookie(req, res);
    await logAuditEventV2(req, { action: 'account_deleted', targetType: 'User', targetId: user._id });
    res.json({ success: true, message: 'Your account has been deleted' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Set a new password for a user who forgot theirs. They have to
//          choose their own when they next sign in.
// @route   PUT /api/v2/users/:id/reset-password
// @access  Private (Admin)
export const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    if (user.deletedAt) {
      return res.status(409).json({ success: false, message: ACCOUNT_DELETED });
    }

    // Saving a new password also signs the user out of existing sessions
    user.password = newPassword;
    user.mustChangePassword = true;
    await user.save({ validateModifiedOnly: true });
    await disconnectUserSockets(user._id);
    sendAdminResetNotice(user);

    await logAuditEventV2(req, { action: 'admin_password_reset', targetType: 'User', targetId: user._id });
    res.json({
      success: true,
      message: `Password reset for ${user.name}`,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Turn off two-step sign-in for someone who lost their phone
// @route   POST /api/v2/users/:id/2fa/reset
// @access  Private (Admin)
export const resetUserTwoFactor = async (req, res) => {
  try {
    if (isOwnAccount(req)) {
      return res.status(400).json({ success: false, message: 'Turn off your own two-step sign-in from your profile' });
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.deletedAt) {
      return res.status(409).json({ success: false, message: ACCOUNT_DELETED });
    }
    if (!user.twoFactor?.enabled) {
      return res.status(409).json({ success: false, message: `Two-step sign-in is not on for ${user.name}` });
    }

    await User.updateOne({ _id: user._id }, TWO_FACTOR_OFF);
    sendTwoFactorResetNotice(user);
    await logAuditEventV2(req, { action: 'admin_2fa_reset', targetType: 'User', targetId: user._id });
    res.json({ success: true, message: `Two-step sign-in turned off for ${user.name}` });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Deactivate/Activate user
// @route   PUT /api/v2/users/:id/toggle-active
// @access  Private (Admin)
export const toggleUserActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (isOwnAccount(req)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }
    if (user.deletedAt) {
      return res.status(409).json({ success: false, message: ACCOUNT_DELETED });
    }

    const deactivating = user.isActive;
    if (deactivating) {
      const team = await soleLedTeam(user._id);
      if (team) return res.status(400).json({ success: false, message: onlyLeaderMessage(user.name, team) });
    }

    // Sessions from before a deactivation stay dead after reactivating
    const updated = await User.findByIdAndUpdate(
      user._id,
      deactivating ? { $set: { isActive: false }, $inc: { tokenVersion: 1 } } : { $set: { isActive: true } },
      { new: true },
    );
    if (deactivating) await disconnectUserSockets(user._id);

    await logAuditEventV2(req, {
      action: deactivating ? 'admin_user_deactivated' : 'admin_user_activated',
      targetType: 'User',
      targetId: user._id,
    });
    res.json({
      success: true,
      data: updated,
      message: `User ${updated.isActive ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};
