import mongoose from 'mongoose';

// How long an invite can be accepted for
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const teamInviteSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
  },
  invitedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // An expired invite keeps 'pending'; whether it has expired is worked out
  // from expiresAt (see inviteState)
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'withdrawn'],
    default: 'pending',
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + INVITE_LIFETIME_MS),
  },
  // When it was accepted, declined or withdrawn
  respondedAt: {
    type: Date,
  },
  // The leader or admin who withdrew it
  withdrawnBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// One pending invite per user per team at a time
teamInviteSchema.index({ team: 1, invitedUser: 1, status: 1 });
// A team's sent invites, and how many it sent in the last hour
teamInviteSchema.index({ team: 1, createdAt: -1 });
teamInviteSchema.index({ invitedUser: 1, status: 1 });

// What an invite looks like now: pending, expired, accepted, declined or withdrawn
export const inviteState = (invite, now = new Date()) =>
  (invite.status === 'pending' && invite.expiresAt <= now ? 'expired' : invite.status);

const TeamInvite = mongoose.model('TeamInvite', teamInviteSchema);

export default TeamInvite;
