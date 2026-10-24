// Runs scripts/migrate-data.js against a database shaped like data from
// before the attendance/task model changes, then checks what it did
import mongoose from 'mongoose';
import { after, before, test } from 'node:test';
import { checker, connectDatabase, resetDatabase, runScript } from './helpers.js';

const { ObjectId } = mongoose.Types;
const migrate = (...flags) => runScript('migration', 'scripts/migrate-data.js', flags);

let db;
before(async () => {
  await resetDatabase('migration');
  db = await connectDatabase('migration');
});
after(() => db?.close());

test('migration', async (t) => {
  const check = checker(t);

  // ---------- Legacy fixture ----------
  const admin = new ObjectId();
  const worker = new ObjectId();
  const bigAvatar = new ObjectId();
  const deletedUser = new ObjectId();
  // Registered after Phase 9: has every account field already
  const newcomer = new ObjectId();
  await db.collection('users').insertMany([
    { _id: admin, name: 'Admin', email: 'a@x.com', password: 'x', role: 'admin', isActive: true },
    { _id: worker, name: 'Worker', email: 'w@x.com', password: 'x', role: 'user', isActive: true, twoFactor: null },
    { _id: bigAvatar, name: 'Big', email: 'b@x.com', password: 'x', role: 'user', isActive: true, profileImage: `data:image/png;base64,${'A'.repeat(300000)}` },
    {
      _id: newcomer, name: 'New', email: 'n@x.com', password: 'x', role: 'user', isActive: true,
      emailVerified: false, tokenVersion: 2, deletedAt: null, twoFactor: { enabled: true },
    },
  ]);

  const at = (iso) => new Date(iso);
  await db.collection('attendances').insertMany([
    { user: worker, date: at('2026-09-01T05:00:00Z'), status: 'requested' },
    { user: worker, date: at('2026-09-02T05:00:00Z'), status: 'approved', approvedBy: admin },
    { user: worker, date: at('2026-09-03T05:00:00Z'), status: 'rejected' },
    { user: worker, date: at('2026-09-04T05:00:00Z'), status: 'late', approvedBy: admin },
    // 20:00Z is already the next day in India
    { user: worker, date: at('2026-09-06T20:00:00Z'), status: 'present' },
    { user: worker, date: at('2026-09-05T04:00:00Z'), status: 'requested' },
    { user: worker, date: at('2026-09-05T09:00:00Z'), status: 'requested' },
    { user: deletedUser, date: at('2026-09-01T05:00:00Z'), status: 'requested' },
  ]);
  await db.collection('attendances').createIndex({ user: 1, date: 1 }, { unique: true });

  await db.collection('tasks').insertOne({
    title: 'Legacy', description: 'd', assignedTo: [worker, deletedUser], createdBy: admin,
    status: 'in-progress', priority: 'medium', startDate: at('2026-09-01'), dueDate: at('2026-09-30'),
  });
  await db.collection('chats').insertOne({ sender: deletedUser, receiver: worker, message: 'old', isRead: false, timestamp: new Date() });

  // ---------- First run: migrate and report ----------
  const firstRun = migrate();

  const records = await db.collection('attendances').find({ user: worker }).sort({ date: 1 }).toArray();
  const byDay = Object.fromEntries(records.map((r) => [r.day, r]));
  await check('every record got a day', records.every((r) => typeof r.day === 'string'));
  await check('requested -> present / pending', byDay['2026-09-01']?.status === 'present' && byDay['2026-09-01']?.approvalStatus === 'pending');
  await check('approved -> present / approved', byDay['2026-09-02']?.status === 'present' && byDay['2026-09-02']?.approvalStatus === 'approved');
  await check('rejected -> present / rejected', byDay['2026-09-03']?.status === 'present' && byDay['2026-09-03']?.approvalStatus === 'rejected');
  await check('late (admin-set) -> late / approved', byDay['2026-09-04']?.status === 'late' && byDay['2026-09-04']?.approvalStatus === 'approved');
  await check('day computed in IST, not UTC', !!byDay['2026-09-07'] && !byDay['2026-09-06'], Object.keys(byDay).join(','));
  await check('duplicate same-day records reported', /2 attendance records on 2026-09-05/.test(firstRun));
  await check('old user+date index dropped', !(await db.collection('attendances').indexes()).some((i) => i.name === 'user_1_date_1'));
  await check('unique index postponed while duplicates exist (and says so)', /not created yet/.test(firstRun));
  const task = await db.collection('tasks').findOne({ title: 'Legacy' });
  await check('task gets progress entries matching its status', task.assigneeProgress?.length === 2 && task.assigneeProgress.every((p) => p.status === 'in-progress'));
  await check('orphans reported, not deleted, without the flag', /--clean-orphans/.test(firstRun) && (await db.collection('chats').countDocuments()) === 1);
  await check('oversized image reported, not deleted, without the flag', /--drop-oversized-images/.test(firstRun) && !!(await db.collection('users').findOne({ _id: bigAvatar })).profileImage);

  const accounts = Object.fromEntries((await db.collection('users').find().toArray()).map((u) => [String(u._id), u]));
  const older = [admin, worker, bigAvatar].map((id) => accounts[String(id)]);
  await check('existing addresses count as confirmed', older.every((u) => u.emailVerified === true));
  await check('existing accounts get session version 0, no deletedAt and two-step sign-in off',
    older.every((u) => u.tokenVersion === 0 && u.deletedAt === null && u.twoFactor?.enabled === false), JSON.stringify(older.map((u) => u.twoFactor)));
  const fresh = accounts[String(newcomer)];
  await check('an account that already has the fields keeps them',
    fresh.emailVerified === false && fresh.tokenVersion === 2 && fresh.twoFactor.enabled === true);
  await check('the account step reports its counts',
    /marked 3 email address\(es\) as confirmed, set the session version of 3, deletedAt of 3 and two-step sign-in of 3 account/.test(firstRun), firstRun);

  // ---------- Second run: after fixing duplicates, with cleanup flags ----------
  await db.collection('attendances').deleteOne({ user: worker, date: at('2026-09-05T09:00:00Z') });
  migrate('--clean-orphans', '--drop-oversized-images');

  const indexes = await db.collection('attendances').indexes();
  await check('one-record-per-day index now exists', indexes.some((i) => i.name === 'user_1_day_1' && i.unique));
  await check('orphaned attendance and chats removed', (await db.collection('attendances').countDocuments({ user: deletedUser })) === 0 && (await db.collection('chats').countDocuments()) === 0);
  const cleanedTask = await db.collection('tasks').findOne({ title: 'Legacy' });
  await check('deleted user unassigned from task with their progress', cleanedTask.assignedTo.length === 1 && cleanedTask.assigneeProgress.length === 1);
  await check('oversized image cleared', !(await db.collection('users').findOne({ _id: bigAvatar })).profileImage);

  // ---------- Third run: nothing left to do ----------
  const thirdRun = migrate();
  await check('re-running is a no-op', /migrated 0 record/.test(thirdRun) && /added assignee progress to 0 task/.test(thirdRun) && /Nothing else needs attention/.test(thirdRun), thirdRun);
  await check('including the account step', /marked 0 email address\(es\) as confirmed, set the session version of 0, deletedAt of 0 and two-step sign-in of 0 account/.test(thirdRun), thirdRun);

  const duplicateInsert = await db.collection('attendances').insertOne({ user: worker, day: '2026-09-01', date: new Date() }).then(() => 'inserted', (e) => e.code);
  await check('database now rejects a second record for the same day', duplicateInsert === 11000, String(duplicateInsert));
});
