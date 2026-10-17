import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Team from '../models/Team.js';
import { sendServerError } from '../utils/http.js';

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

// Allows admin OR team_leader to proceed
export const adminOrLeader = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'team_leader') {
    return res.status(403).json({
      success: false,
      message: 'Only admins or team leaders can access this route',
    });
  }
  next();
};

// Verifies the requesting user is a leader of the team specified by req.params.teamId or req.body.team
export const isLeaderOfTeam = async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return next();

    const teamId = req.params.teamId || req.params.id || req.body.team;
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Team ID is required' });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const isLeader = team.leaders.some(l => l.toString() === req.user.id.toString());
    if (!isLeader) {
      return res.status(403).json({ success: false, message: 'Only the team leader can perform this action' });
    }

    req.team = team;
    next();
  } catch (error) {
    sendServerError(res, error);
  }
};
