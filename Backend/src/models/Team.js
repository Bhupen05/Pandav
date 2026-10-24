import mongoose from 'mongoose';

// Longest team name and description, in characters (after trimming)
export const TEAM_NAME_MAX = 80;
export const TEAM_DESCRIPTION_MAX = 500;

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Team name is required'],
    trim: true,
    unique: true,
    maxlength: [TEAM_NAME_MAX, `A team name can be at most ${TEAM_NAME_MAX} characters`],
  },
  description: {
    type: String,
    trim: true,
    maxlength: [TEAM_DESCRIPTION_MAX, `A team description can be at most ${TEAM_DESCRIPTION_MAX} characters`],
  },
  leaders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

teamSchema.index({ leaders: 1 });
teamSchema.index({ members: 1 });

const Team = mongoose.model('Team', teamSchema);

export default Team;
