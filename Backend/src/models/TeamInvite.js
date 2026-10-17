import mongoose from 'mongoose';

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
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  },
}, {
  timestamps: true,
});

// One pending invite per user per team at a time
teamInviteSchema.index({ team: 1, invitedUser: 1, status: 1 });

const TeamInvite = mongoose.model('TeamInvite', teamInviteSchema);

export default TeamInvite;
