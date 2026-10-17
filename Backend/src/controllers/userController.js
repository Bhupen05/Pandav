import User from '../models/User.js';
import Task from '../models/Task.js';
import Attendance from '../models/Attendance.js';
import Chat from '../models/Chat.js';
import Team from '../models/Team.js';
import TeamInvite from '../models/TeamInvite.js';
import TeamChatMessage from '../models/TeamChatMessage.js';
import SocialPost from '../models/SocialPostV2.js';
import SocialIntegration from '../models/SocialIntegrationV2.js';
import SocialPublishJob from '../models/SocialPublishJobV2.js';
import PersonalTask from '../models/PersonalTaskV2.js';
import NetworkConnection from '../models/NetworkConnectionV2.js';
import { escapeRegex, listResponse, pick, sendServerError } from '../utils/http.js';
import { messageableUserIds } from '../utils/messaging.js';
import { isInAnyTeam } from '../utils/teams.js';

const TEAM_ROLES = ['team_leader', 'team_member'];

// Fields a user may change on their own profile
const SELF_EDITABLE_FIELDS = ['name', 'email', 'phone', 'department', 'profileImage'];
// Admins can additionally change role and active status
const ADMIN_EDITABLE_FIELDS = [...SELF_EDITABLE_FIELDS, 'role', 'isActive'];

// Whether the request is about the signed-in user's own account. Ids are hex,
// so compare them case-insensitively.
const isOwnAccount = (req) => String(req.params.id).toLowerCase() === req.user.id;

// Ends any open chat connections for a user who was just deactivated
const disconnectUserSockets = (req, userId) => {
  const io = req.app.get('io');
  if (io) io.in(userId.toString()).disconnectSockets(true);
};

// @desc    Search users by name or email
// @route   GET /api/users/search?q=...
// @access  Private
export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;

    if (typeof q !== 'string' || q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    // Matched as plain text, not as a regular expression
    const query = escapeRegex(q.trim());
    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ],
      _id: { $ne: req.user._id }, // Don't show current user
      isActive: true,
    })
      .select('_id name email role department profileImage')
      .limit(10);

    res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    The people the current user may message: everyone for an admin;
//          otherwise teammates, Social Hub connections, and anyone who has
//          messaged them (see directMessageProblem)
// @route   GET /api/users/chat-list
// @access  Private
export const getChatUsers = async (req, res) => {
  try {
    const ids = await messageableUserIds(req.user);
    const users = await User.find({
      _id: ids ? { $in: ids } : { $ne: req.user._id },
      isActive: true,
    })
      .select('_id name email role')
      .sort({ name: 1 });
    res.json({ success: true, data: users });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin)
export const getUsers = async (req, res) => {
  try {
    const { role, department, isActive } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const query = User.find(filter).select('-password');

    res.json(await listResponse(User, filter, query, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
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
// @route   PUT /api/users/:id
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
    if (updates.isActive !== undefined) {
      if (updates.isActive === 'true' || updates.isActive === 'false') updates.isActive = updates.isActive === 'true';
      if (typeof updates.isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive must be true or false' });
      }
    }

    // Stop admins from locking themselves out
    if (isAdmin && isSelf && ((updates.role && updates.role !== 'admin') || updates.isActive === false)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot remove your own admin access or deactivate yourself'
      });
    }

    // Team roles follow team membership, so they change only through the
    // team screens; otherwise the user and the team would disagree
    if (updates.role !== undefined) {
      const current = await User.findById(req.params.id).select('role');
      if (current && updates.role !== current.role) {
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
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (updates.isActive === false) disconnectUserSockets(req, user._id);

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
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

    // A team always has a leader
    const ledAlone = await Team.findOne({ leaders: [user._id] }).select('name');
    if (ledAlone) {
      return res.status(400).json({
        success: false,
        message: `${user.name} is the only leader of ${ledAlone.name}. Make someone else its leader or delete the team first.`,
      });
    }

    // Remove what belongs to the user so nothing points at a missing account.
    // Tasks are kept (other assignees may share them); the user is just unassigned.
    await Promise.all([
      Task.updateMany(
        { assignedTo: user._id },
        { $pull: { assignedTo: user._id, assigneeProgress: { user: user._id } } }
      ),
      Attendance.deleteMany({ user: user._id }),
      Chat.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] }),
      Team.updateMany(
        { $or: [{ leaders: user._id }, { members: user._id }] },
        { $pull: { leaders: user._id, members: user._id } }
      ),
      TeamInvite.deleteMany({ $or: [{ invitedUser: user._id }, { invitedBy: user._id }] }),
      TeamChatMessage.deleteMany({ sender: user._id }),
      TeamChatMessage.updateMany({ 'readBy.user': user._id }, { $pull: { readBy: { user: user._id } } }),
      // Social Hub: their posts, linked accounts (and stored tokens), jobs,
      // personal tasks and connections go; their likes and comments too
      SocialPost.deleteMany({ author: user._id }),
      SocialPost.updateMany(
        { $or: [{ likes: user._id }, { 'comments.user': user._id }] },
        { $pull: { likes: user._id, comments: { user: user._id } } }
      ),
      SocialIntegration.deleteMany({ user: user._id }),
      SocialPublishJob.deleteMany({ owner: user._id }),
      PersonalTask.deleteMany({ user: user._id }),
      NetworkConnection.deleteMany({ $or: [{ requester: user._id }, { recipient: user._id }] }),
    ]);
    await user.deleteOne();
    disconnectUserSockets(req, user._id);

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Set a new password for a user who forgot theirs
// @route   PUT /api/users/:id/reset-password
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

    // Saving a new password also signs the user out of existing sessions
    user.password = newPassword;
    await user.save({ validateModifiedOnly: true });
    disconnectUserSockets(req, user._id);

    res.json({
      success: true,
      message: `Password reset for ${user.name}`,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Deactivate/Activate user
// @route   PUT /api/users/:id/toggle-active
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

    user.isActive = !user.isActive;
    await user.save({ validateModifiedOnly: true });

    if (!user.isActive) disconnectUserSockets(req, user._id);

    res.json({
      success: true,
      data: user,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};
