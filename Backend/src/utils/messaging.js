import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import NetworkConnection from '../models/NetworkConnectionV2.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { blockedUserIds, isBlockedBetween } from './blocks.js';
import { areTeammates, teamUserIds } from './teams.js';

// Whether two users have an accepted Social Hub connection
export const hasAcceptedConnection = async (userId, otherId) =>
  Boolean(await NetworkConnection.exists({
    status: 'accepted',
    $or: [
      { requester: userId, recipient: otherId },
      { requester: otherId, recipient: userId },
    ],
  }));

const CONNECT_FIRST = 'Connect with this person in the Social Hub before messaging them';
const BLOCKED = "You can't message this person";

// The one rule for direct messages, in the main chat and the Social Hub alike
// (they share one message store), and for typing indicators. A sender may
// message an active user when:
// - the sender is an admin,
// - they are in the same team and it isn't frozen,
// - they have an accepted connection, or
// - the recipient has messaged the sender before (a reply),
// and, unless the sender is an admin, neither has blocked the other.
// Returns null when the message may be sent, or { status, message } saying why not.
export const directMessageProblem = async (sender, recipientId) => {
  if (!mongoose.isObjectIdOrHexString(recipientId)) return { status: 400, message: 'Invalid receiver' };
  if (String(recipientId) === String(sender._id)) return { status: 400, message: 'You cannot message yourself' };
  if (!(await User.exists({ _id: recipientId, isActive: true }))) return { status: 404, message: 'Recipient not found' };

  if (sender.role === 'admin') return null;
  if (await isBlockedBetween(sender._id, recipientId)) return { status: 403, message: BLOCKED };
  if (await areTeammates(sender._id, recipientId)) return null;
  if (await hasAcceptedConnection(sender._id, recipientId)) return null;
  if (await Chat.exists({ sender: recipientId, receiver: sender._id })) return null;

  return { status: 403, message: CONNECT_FIRST };
};

// Ids of everyone the user may message under directMessageProblem, or null
// for an admin (everyone). People blocked either way round are left out.
export const messageableUserIds = async (user) => {
  if (user.role === 'admin') return null;

  const [teams, connections, senders, blocked] = await Promise.all([
    Team.find({ isActive: true, $or: [{ leaders: user._id }, { members: user._id }] }).select('leaders members'),
    NetworkConnection.find({
      status: 'accepted',
      $or: [{ requester: user._id }, { recipient: user._id }],
    }).select('requester recipient').lean(),
    Chat.distinct('sender', { receiver: user._id }),
    blockedUserIds(user._id),
  ]);

  const ids = new Set([
    ...teams.flatMap(teamUserIds),
    ...connections.flatMap((c) => [String(c.requester), String(c.recipient)]),
    ...senders.map(String),
  ]);
  ids.delete(String(user._id));
  blocked.forEach((id) => ids.delete(id));
  return [...ids];
};
