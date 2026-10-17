import User from '../models/User.js';
import { sendServerError } from '../utils/http.js';
import { clearSessionCookie, setSessionCookie, signSocketTicket } from '../utils/session.js';

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, email, password, phone, department, profileImage } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Role is never taken from the request: self-registered accounts are always
    // regular users. Admins promote users through PUT /api/users/:id.
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      phone,
      department,
      profileImage,
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          department: user.department,
          profileImage: user.profileImage,
          createdAt: user.createdAt,
        },
      });
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check for user
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check if password matches
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is deactivated. Please contact admin.' 
      });
    }

    // The token goes only into the HttpOnly cookie, never into the response body
    setSessionCookie(req, res, user._id, req.body.rememberMe === true);
    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        department: user.department,
        profileImage: user.profileImage,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/updatepassword
// @access  Private
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ 
        success: false, 
        message: 'Password is incorrect' 
      });
    }

    // Saving a new password also invalidates every token issued before now,
    // so this browser gets a fresh session, kept as long as the old one was
    user.password = newPassword;
    await user.save();
    setSessionCookie(req, res, user._id, req.session.remember === true);

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Sign out of this browser
// @route   POST /api/auth/logout
// @access  Public (works even when the session has already expired)
export const logout = (req, res) => {
  clearSessionCookie(req, res);
  res.json({ success: true });
};

// @desc    One-minute ticket for opening the chat socket
// @route   POST /api/auth/socket-token
// @access  Private
export const getSocketToken = (req, res) => {
  res.json({ success: true, data: { token: signSocketTicket(req.user._id) } });
};
