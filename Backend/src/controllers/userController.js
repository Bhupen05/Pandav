import User from '../models/User.js';
import { pick, sendServerError } from '../utils/http.js';

// Fields a user may change on their own profile
const SELF_EDITABLE_FIELDS = ['name', 'email', 'phone', 'department', 'profileImage'];
// Admins can additionally change role and active status
const ADMIN_EDITABLE_FIELDS = [...SELF_EDITABLE_FIELDS, 'role', 'isActive'];

// Ends any open chat connections for a user who was just deactivated
const disconnectUserSockets = (req, userId) => {
  const io = req.app.get('io');
  if (io) io.in(userId.toString()).disconnectSockets(true);
};

// @desc    Get all users for chat (any authenticated user)
// @route   GET /api/users/chat-list
// @access  Private
export const getChatUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id }, isActive: { $ne: false } })
      .select('_id name email profileImage');
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

    const users = await User.find(filter).select('-password');

    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Users can only view their own profile unless they're admin
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to access this profile' 
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
    const isSelf = req.user.id === req.params.id;

    // Users can only update their own profile unless they're admin
    if (!isAdmin && !isSelf) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    // Only whitelisted fields; password changes go through /api/auth/updatepassword
    const updates = pick(req.body, isAdmin ? ADMIN_EDITABLE_FIELDS : SELF_EDITABLE_FIELDS);

    // Stop admins from locking themselves out
    if (isAdmin && isSelf && ((updates.role && updates.role !== 'admin') || updates.isActive === false)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot remove your own admin access or deactivate yourself'
      });
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
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
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
    if (req.user.id === req.params.id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete your own account' 
      });
    }

    await user.deleteOne();

    res.json({
      success: true,
      message: 'User deleted successfully',
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

    if (req.user.id === req.params.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

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
