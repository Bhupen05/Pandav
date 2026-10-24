import Block from '../models/Block.js';

// Whether either user has blocked the other
export const isBlockedBetween = async (userId, otherId) =>
  Boolean(await Block.exists({
    $or: [
      { blocker: userId, blocked: otherId },
      { blocker: otherId, blocked: userId },
    ],
  }));

// Ids of everyone this user has blocked or been blocked by
export const blockedUserIds = async (userId) => {
  const blocks = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] })
    .select('blocker blocked')
    .lean();
  return [...new Set(blocks.map((block) =>
    String(String(block.blocker) === String(userId) ? block.blocked : block.blocker)))];
};
