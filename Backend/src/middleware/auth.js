import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Resolves a JWT to an active user. Returns null if the token is invalid or
// expired, the account is deactivated, or the password changed after the
// token was issued. Shared by HTTP routes and socket connections.
export const getUserFromToken = async (token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  const user = await User.findById(decoded.id).select('+passwordChangedAt');
  if (!user || !user.isActive) return null;

  if (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    return null;
  }

  user.passwordChangedAt = undefined;
  return user;
};

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    req.user = await getUserFromToken(token);

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token failed'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};
