// Brings existing data in line with the current models. Safe to run more than once.
//
//   npm run migrate                              migrate and report problems
//   npm run migrate -- --clean-orphans           also remove data of deleted users
//   npm run migrate -- --drop-oversized-images   also clear profile images over the size limit
//
// Uses MONGODB_URI from the environment or Backend/.env.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Attendance, { fromLegacyStatus } from '../src/models/Attendance.js';
import Task, { initialProgress } from '../src/models/Task.js';
import User, { MAX_PROFILE_IMAGE_LENGTH } from '../src/models/User.js';
import AuthToken from '../src/models/AuthToken.js';
import Chat from '../src/models/Chat.js';
import SocialIntegration from '../src/models/SocialIntegrationV2.js';
import SocialPost from '../src/models/SocialPostV2.js';
import { toDayKey } from '../src/utils/dates.js';
import { encryptSecret, isEncrypted } from '../src/utils/secrets.js';

dotenv.config();

const args = new Set(process.argv.slice(2));
const { ObjectId } = mongoose.Types;
const problems = [];

// Attendance used to keep approval in `status`, and had no `day`
async function migrateAttendance() {
  const records = Attendance.collection.find(
    { $or: [{ approvalStatus: { $exists: false } }, { day: { $exists: false } }] },
    { projection: { status: 1, approvalStatus: 1, day: 1, date: 1 } }
  );

  const ops = [];
  for await (const record of records) {
    const set = {};
    if (record.approvalStatus === undefined) Object.assign(set, fromLegacyStatus(record.status));
    if (record.day === undefined) set.day = toDayKey(record.date);
    ops.push({ updateOne: { filter: { _id: record._id }, update: { $set: set } } });
  }

  if (ops.length) await Attendance.collection.bulkWrite(ops);
  console.log(`Attendance: migrated ${ops.length} record(s)`);
}

// The one-record-per-day index can't be built while a user has two records for a day
async function reportDuplicateDays() {
  const duplicates = await Attendance.collection.aggregate([
    { $match: { day: { $type: 'string' } } },
    { $group: { _id: { user: '$user', day: '$day' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  for (const { _id, ids } of duplicates) {
    problems.push(`User ${_id.user} has ${ids.length} attendance records on ${_id.day}: ${ids.join(', ')}. Delete all but one.`);
  }
  return duplicates.length;
}

// Tasks created before per-assignee progress existed
async function migrateTasks() {
  const tasks = Task.collection.find({}, { projection: { assignedTo: 1, assigneeProgress: 1, status: 1 } });

  const ops = [];
  for await (const task of tasks) {
    const tracked = new Set((task.assigneeProgress || []).map((p) => String(p.user)));
    const missing = (task.assignedTo || []).map(String).filter((id) => !tracked.has(id));
    if (missing.length === 0) continue;

    const entries = missing.map((id) => ({ _id: new ObjectId(), user: new ObjectId(id), status: initialProgress(task.status) }));
    ops.push({ updateOne: { filter: { _id: task._id }, update: { $push: { assigneeProgress: { $each: entries } } } } });
  }

  if (ops.length) await Task.collection.bulkWrite(ops);
  console.log(`Tasks: added assignee progress to ${ops.length} task(s)`);
}

// Accounts from before email verification, session versions, deletion by
// anonymising and two-step sign-in. Their addresses count as confirmed: they
// were in use before confirming existed, and EMAIL_VERIFICATION_REQUIRED
// would otherwise lock everyone out.
async function migrateAccounts() {
  const set = async (filter, values) => (await User.collection.updateMany(filter, { $set: values })).modifiedCount;
  const verified = await set({ emailVerified: { $exists: false } }, { emailVerified: true });
  const versions = await set({ tokenVersion: { $exists: false } }, { tokenVersion: 0 });
  const deletedAt = await set({ deletedAt: { $exists: false } }, { deletedAt: null });
  // No twoFactor at all (or not an object), then an object without `enabled`
  const twoFactor = await set({ twoFactor: { $not: { $type: 'object' } } }, { twoFactor: { enabled: false } }) +
    await set({ 'twoFactor.enabled': { $exists: false } }, { 'twoFactor.enabled': false });
  console.log(
    `Users: marked ${verified} email address(es) as confirmed, set the session version of ${versions}, ` +
    `deletedAt of ${deletedAt} and two-step sign-in of ${twoFactor} account(s)`
  );
}

async function updateIndexes(duplicateCount) {
  // Replaced by the user+day index; it included the time of day, so it never blocked anything
  const existing = await Attendance.collection.indexes();
  if (existing.some((index) => index.name === 'user_1_date_1')) {
    await Attendance.collection.dropIndex('user_1_date_1');
    console.log('Attendance: dropped old user+date index');
  }

  let allCreated = true;
  for (const model of [Attendance, Task, Chat, User, AuthToken]) {
    try {
      await model.createIndexes();
    } catch (error) {
      if (error.code === 11000 && model === Attendance && duplicateCount > 0) {
        allCreated = false;
        problems.push('Attendance one-record-per-day index not created yet: resolve the duplicates above, then run this again.');
      } else {
        throw error;
      }
    }
  }
  if (allCreated) console.log('Indexes: up to date');
}

// Data left behind by users deleted before deletes cleaned up after themselves
async function handleOrphans() {
  const userIds = await User.collection.distinct('_id');
  const orphanAttendance = { user: { $nin: userIds } };
  const orphanChats = { $or: [{ sender: { $nin: userIds } }, { receiver: { $nin: userIds } }] };
  const orphanAssignments = { assignedTo: { $elemMatch: { $nin: userIds } } };

  const [attendance, chats, tasks] = await Promise.all([
    Attendance.collection.countDocuments(orphanAttendance),
    Chat.collection.countDocuments(orphanChats),
    Task.collection.countDocuments(orphanAssignments),
  ]);

  if (attendance + chats + tasks === 0) return;

  if (args.has('--clean-orphans')) {
    await Promise.all([
      Attendance.collection.deleteMany(orphanAttendance),
      Chat.collection.deleteMany(orphanChats),
      Task.collection.updateMany(orphanAssignments, {
        $pull: { assignedTo: { $nin: userIds }, assigneeProgress: { user: { $nin: userIds } } },
      }),
    ]);
    console.log(`Orphans: removed ${attendance} attendance record(s), ${chats} message(s); unassigned deleted users from ${tasks} task(s)`);
  } else {
    problems.push(
      `Found data of deleted users: ${attendance} attendance record(s), ${chats} message(s), ${tasks} task(s). ` +
      'Run with --clean-orphans to remove it.'
    );
  }
}

// Social Hub data of deleted users: linked accounts (with their LinkedIn/GitHub
// tokens) and posts that no longer have an author
async function handleSocialOrphans() {
  const userIds = await User.collection.distinct('_id');
  const orphanIntegrations = { user: { $nin: userIds } };
  const orphanPosts = { author: { $nin: userIds } };

  const [integrations, posts] = await Promise.all([
    SocialIntegration.collection.countDocuments(orphanIntegrations),
    SocialPost.collection.countDocuments(orphanPosts),
  ]);
  if (integrations + posts === 0) return;

  if (args.has('--clean-orphans')) {
    await Promise.all([
      SocialIntegration.collection.deleteMany(orphanIntegrations),
      SocialPost.collection.deleteMany(orphanPosts),
    ]);
    console.log(`Orphans: removed ${integrations} linked account(s) and ${posts} post(s) of deleted users`);
  } else {
    problems.push(
      `Found Social Hub data of deleted users: ${integrations} linked account(s) with stored tokens, ${posts} post(s). ` +
      'Run with --clean-orphans to remove it.'
    );
  }
}

// LinkedIn/GitHub tokens linked before they were encrypted at rest
async function encryptProviderTokens() {
  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set, so stored LinkedIn/GitHub tokens were not encrypted. Run again with it set.');
    return;
  }

  let count = 0;
  const linked = SocialIntegration.collection.find(
    { $or: [{ accessToken: { $type: 'string' } }, { refreshToken: { $type: 'string' } }] },
    { projection: { accessToken: 1, refreshToken: 1 } }
  );
  for await (const integration of linked) {
    const update = {};
    for (const field of ['accessToken', 'refreshToken']) {
      if (integration[field] && !isEncrypted(integration[field])) update[field] = encryptSecret(integration[field]);
    }
    if (Object.keys(update).length > 0) {
      await SocialIntegration.collection.updateOne({ _id: integration._id }, { $set: update });
      count += 1;
    }
  }
  if (count > 0) console.log(`Social: encrypted the stored tokens of ${count} linked account(s)`);
}

// Images uploaded before the app started resizing them are sent with every list that shows avatars
async function handleOversizedImages() {
  const oversized = { $expr: { $gt: [{ $strLenBytes: { $ifNull: ['$profileImage', ''] } }, MAX_PROFILE_IMAGE_LENGTH] } };
  const count = await User.collection.countDocuments(oversized);
  if (count === 0) return;

  if (args.has('--drop-oversized-images')) {
    await User.collection.updateMany(oversized, { $unset: { profileImage: '' } });
    console.log(`Users: cleared ${count} oversized profile image(s); those users can upload a new one`);
  } else {
    problems.push(`${count} user(s) have profile images over the size limit. Run with --drop-oversized-images to clear them.`);
  }
}

async function main() {
  const connection = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pandav_db', { autoIndex: false });
  console.log(`Connected to ${connection.connection.host}/${connection.connection.name}\n`);

  await migrateAttendance();
  const duplicateCount = await reportDuplicateDays();
  await migrateTasks();
  await migrateAccounts();
  await updateIndexes(duplicateCount);
  await handleOrphans();
  await handleSocialOrphans();
  await encryptProviderTokens();
  await handleOversizedImages();

  if (problems.length) {
    console.log('\nNeeds attention:');
    problems.forEach((problem) => console.log(`- ${problem}`));
  } else {
    console.log('\nNothing else needs attention.');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
