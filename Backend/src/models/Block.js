import mongoose from 'mongoose';

// One user blocking another. Either way round, the two can't message each
// other, see each other typing, or ask to connect (utils/blocks.js). Admins
// can't be blocked, and blocks don't stop an admin's messages.
const blockSchema = new mongoose.Schema({
  blocker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  blocked: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
blockSchema.index({ blocked: 1 });

export default mongoose.model('Block', blockSchema);
