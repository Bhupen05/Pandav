import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Team from '../models/Team.js';
import { sendServerError } from '../utils/http.js';
import { SESSION_AUDIENCE, SESSION_COOKIE } from '../utils/session.js';

// Whether a token's claims still hold for this user (loaded with
// +tokenVersion +passwordChangedAt): issued under the account's current token
// version (claim `tv`; a token without one counts as 0), and not before the
// last password change. The version goes up on "sign out everywhere",
// deactivation, deletion and a password reset by email.
export const claimsStillValid = (user, claims) => {
  if ((claims.tv ?? 0) !== (user.tokenVersion ?? 0)) return false;
  if (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) return false;
  return true;
};

// Resolves a JWT to { user, claims } for an active user. Returns null if the
// token is invalid, expired or meant for another audience, the account is
// deactivated or deleted, or the token no longer holds (see
// claimsStillValid). Shared by HTTP routes (session cookie) and socket
// connections (socket ticket).
export const getUserFromToken = async (token, audience) => {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { audience });
  } catch {
    return null;
  }

  const user = await User.findById(decoded.id).select('+passwordChangedAt +tokenVersion');
  if (!user || !user.isActive || user.deletedAt) return null;
  if (!claimsStillValid(user, decoded)) return null;

  // Only needed for the checks above. Unmarked, so saving req.user can't erase them.
  for (const path of ['passwordChangedAt', 'tokenVersion']) {
    user[path] = undefined;
    user.unmarkModified(path);
  }
  return { user, claims: decoded };
};

// What every route except a few answers while an admin-set password is
// waiting to be replaced (see protectAllowingPasswordChange)
const PASSWORD_CHANGE_REQUIRED = {
  success: false,
  code: 'PASSWORD_CHANGE_REQUIRED',
  message: 'Please choose a new password before you continue',
};

const authenticate = (allowPendingPasswordChange) => async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    const session = await getUserFromToken(token, SESSION_AUDIENCE);
    req.user = session?.user;
    req.session = session?.claims;

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token failed'
      });
    }

    if (req.user.mustChangePassword && !allowPendingPasswordChange) {
      return res.status(403).json(PASSWORD_CHANGE_REQUIRED);
    }

    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

// Needs a session. After an admin reset the password (mustChangePassword),
// it answers 403 PASSWORD_CHANGE_REQUIRED until the user picks a new one.
export const protect = authenticate(false);

// Needs a session, and also lets through a user who still has to replace an
// admin-set password: for the routes they need to do that (who am I, change
// password, sign out, socket ticket)
export const protectAllowingPasswordChange = authenticate(true);

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
