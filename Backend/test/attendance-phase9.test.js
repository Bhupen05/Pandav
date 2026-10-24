// End-to-end checks for Phase 9 attendance: reviews follow the record's team,
// review only from pending, open check-ins wait for check-out, review notes
// kept apart, check-in on a requested day, check-out across midnight,
// settings (late, half day), holidays, leave over several days with types and
// balances, missed check-outs and corrections, auto-absent, summaries and
// stats, CSV export, bulk review, admin-created records, the audit log and
// the notifications sent
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, SESSION_COOKIE, USER, checker, connectDatabase, istDay, startServer } from './helpers.js';

const { ObjectId } = mongoose.Types;
const OUTBOX = path.join(os.tmpdir(), `pandav-outbox-attendance-${process.pid}.jsonl`);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};
let server;
let db;
let adminToken;
let admin;
let demo;
let alpha;
let beta;

const today = () => istDay();
const dayFromNow = (offset) => istDay(new Date(Date.now() + offset * DAY));
const addDays = (day, count) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

// A Monday in 2030 for the leave tests, and a holiday on its Wednesday
let MONDAY = '2030-03-04';
while (weekday(MONDAY) !== 1) MONDAY = addDays(MONDAY, 1);
const HOLIDAY = addDays(MONDAY, 2);

const outbox = () => (fs.existsSync(OUTBOX)
  ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);

// A record written straight to the database, for days and times the API
// can't produce (yesterday's check-in, an old open one)
const insertRecord = async (fields) => {
  const now = new Date();
  const doc = {
    status: 'present', approvalStatus: 'pending', team: null, workHours: 0, missedCheckout: false, autoMarked: false,
    leaveType: null, leaveRequestId: null, correctionRequest: null, createdAt: now, updatedAt: now, ...fields,
  };
  doc.user = new ObjectId(String(doc.user));
  if (doc.team) doc.team = new ObjectId(String(doc.team));
  doc.date ??= new Date(`${doc.day}T00:00:00Z`);
  const { insertedId } = await db.collection('attendances').insertOne(doc);
  return String(insertedId);
};
const recordById = (id) => db.collection('attendances').findOne({ _id: new ObjectId(id) });

// A request that doesn't answer within `ms` resolves as { status: 'timeout' }
const withTimeout = (promise, ms = 5000) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'timeout' }), ms); }),
  ]).finally(() => clearTimeout(timer));
};
const audits = () => db.collection('auditeventv2');
const auditCount = (action, filter = {}) => audits().countDocuments({ action, ...filter });

const notificationsOf = async (token) =>
  (await server.api.call('GET', '/notifications?limit=50', { token })).data?.data || [];

const runJob = (name, now) =>
  server.api.call('POST', `/admin/jobs/${name}/run`, { token: adminToken, body: now ? { now } : {} });

// Fetches a download as text
const download = async (urlPath, token) => {
  const res = await fetch(`${server.base}/api/v2${urlPath}`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
  return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
};

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  server = await startServer('attendance-phase9', { MAIL_OUTBOX: OUTBOX });
  db = await connectDatabase('attendance-phase9');
  const { call, login, me, register } = server.api;

  adminToken = await login(ADMIN);
  admin = await me(adminToken);
  const demoToken = await login(USER);
  demo = { token: demoToken, ...(await me(demoToken)) };

  for (const [key, name] of [['lee', 'Lee Leader'], ['mia', 'Mia Member'], ['max', 'Max Mover'], ['kim', 'Kim Leader'], ['oz', 'Oz Outsider'], ['flo', 'Flo Flooder']]) {
    people[key] = await register(name, `${key}@attend.test`);
  }
  const { lee, mia, max, kim } = people;

  // Anyone outside a team can start one and leads it
  alpha = (await call('POST', '/teams', { token: lee.token, body: { name: 'Attend Alpha' } })).data.data;
  beta = (await call('POST', '/teams', { token: kim.token, body: { name: 'Attend Beta' } })).data.data;
  for (const person of [mia, max]) {
    const invite = (await call('POST', `/teams/${alpha._id}/invite`, { token: lee.token, body: { userId: person._id } })).data.data;
    await call('PUT', `/teams/invites/${invite._id}/accept`, { token: person.token });
  }
});

after(async () => {
  await db?.close();
  await server?.stop();
  fs.rmSync(OUTBOX, { force: true });
});

test('settings and holidays', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { mia } = people;

  const settings = await call('GET', '/attendance/settings', { token: mia.token });
  const data = settings.data?.data;
  await check('anyone signed in reads the settings', settings.status === 200, JSON.stringify(settings.data));
  await check('defaults: Monday to Friday, no shift start, 15 minutes grace, no half-day rule, no auto-absent',
    JSON.stringify(data?.workdays) === '[1,2,3,4,5]' && data.shiftStart === null && data.lateAfterMinutes === 15 &&
    data.halfDayHours === null && data.autoAbsent === false, JSON.stringify(data));
  await check('default leave types and allowances',
    JSON.stringify(data?.leaveTypes?.map((type) => [type.key, type.daysPerYear])) === '[["casual",12],["sick",6],["earned",15],["unpaid",null]]',
    JSON.stringify(data?.leaveTypes));
  await check('signed-out callers cannot read them', (await call('GET', '/attendance/settings')).status === 401);

  await check('only admins change settings',
    (await call('PUT', '/attendance/settings', { token: mia.token, body: { autoAbsent: true } })).status === 403);
  for (const [name, body] of [
    ['a weekday outside 1-7', { workdays: [0, 1] }],
    ['the same weekday twice', { workdays: [1, 1] }],
    ['no workdays', { workdays: [] }],
    ['a time that does not exist', { shiftStart: '24:00' }],
    ['negative grace minutes', { lateAfterMinutes: -1 }],
    ['zero half-day hours', { halfDayHours: 0 }],
    ['autoAbsent that is not true or false', { autoAbsent: 'yes' }],
    ['a leave type listed twice', { leaveTypes: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] }],
    ['a leave type without a label', { leaveTypes: [{ key: 'a' }] }],
    ['a fractional allowance', { leaveTypes: [{ key: 'a', label: 'A', daysPerYear: 1.5 }] }],
    ['nothing to change', {}],
  ]) {
    const res = await call('PUT', '/attendance/settings', { token: adminToken, body });
    await check(`settings refuse ${name}`, res.status === 400, `${res.status} ${JSON.stringify(res.data)}`);
  }

  const saved = await call('PUT', '/attendance/settings', {
    token: adminToken,
    body: { leaveTypes: [...data.leaveTypes, { key: 'wfh', label: 'Work from home', daysPerYear: null }], lateAfterMinutes: 10 },
  });
  await check('an admin adds a leave type and changes the grace minutes',
    saved.status === 200 && saved.data.data.leaveTypes.some((type) => type.key === 'wfh') && saved.data.data.lateAfterMinutes === 10 &&
    JSON.stringify(saved.data.data.workdays) === '[1,2,3,4,5]', JSON.stringify(saved.data));
  await check('the change is in the audit log', (await auditCount('attendance_settings_updated')) === 1);
  await call('PUT', '/attendance/settings', { token: adminToken, body: { lateAfterMinutes: 15 } });

  // Holidays
  const holiday = await call('POST', '/attendance/holidays', { token: adminToken, body: { day: HOLIDAY, name: 'Founders Day' } });
  await check('an admin adds a holiday', holiday.status === 201 && holiday.data.data.day === HOLIDAY && holiday.data.data.name === 'Founders Day', JSON.stringify(holiday.data));
  await check('a second holiday on the same day is a conflict',
    (await call('POST', '/attendance/holidays', { token: adminToken, body: { date: HOLIDAY, name: 'Again' } })).status === 409);
  await check('only admins add holidays',
    (await call('POST', '/attendance/holidays', { token: mia.token, body: { day: '2030-12-25', name: 'X' } })).status === 403);
  await check('a holiday needs a real date',
    (await call('POST', '/attendance/holidays', { token: adminToken, body: { day: '2030-02-31', name: 'X' } })).status === 400);
  await check('and a name',
    (await call('POST', '/attendance/holidays', { token: adminToken, body: { day: '2030-12-25' } })).status === 400);

  const list = await call('GET', '/attendance/holidays?year=2030', { token: mia.token });
  await check('anyone lists the holidays of a year', list.status === 200 && list.data.data.some((h) => h.day === HOLIDAY), JSON.stringify(list.data));
  await check('another year leaves it out',
    (await call('GET', '/attendance/holidays?year=2031', { token: mia.token })).data.data.length === 0);
  await check('a year that is not a year is refused', (await call('GET', '/attendance/holidays?year=20x0', { token: mia.token })).status === 400);

  const extra = (await call('POST', '/attendance/holidays', { token: adminToken, body: { day: '2030-12-25', name: 'Winter break' } })).data.data;
  await check('only admins remove holidays', (await call('DELETE', `/attendance/holidays/${extra._id}`, { token: mia.token })).status === 403);
  await check('an admin removes a holiday', (await call('DELETE', `/attendance/holidays/${extra._id}`, { token: adminToken })).status === 200);
  await check('removing it again is a 404', (await call('DELETE', `/attendance/holidays/${extra._id}`, { token: adminToken })).status === 404);
  await check('holiday changes are audited',
    (await auditCount('holiday_created')) === 2 && (await auditCount('holiday_deleted', { targetId: extra._id })) === 1);
});

test('check-in and check-out', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, max, kim, oz } = people;
  // Every day a workday, so a day of leave today is allowed whatever weekday
  // the tests run on
  await call('PUT', '/attendance/settings', { token: adminToken, body: { workdays: [1, 2, 3, 4, 5, 6, 7] } });

  // A pending request for today without a check-in time
  const request = await call('POST', '/attendance', { token: mia.token, body: { date: today(), status: 'present', remarks: 'In after the dentist' } });
  await check('an employee asks for today as present', request.status === 201 && !request.data.data.checkInTime, JSON.stringify(request.data).slice(0, 200));
  const miaIn = await call('POST', '/attendance/checkin', { token: mia.token });
  await check('checking in fills in the check-in time instead of failing',
    miaIn.status === 200 && miaIn.data.data._id === request.data.data._id && miaIn.data.data.checkInTime &&
    miaIn.data.data.remarks === 'In after the dentist' && miaIn.data.data.status === 'present', JSON.stringify(miaIn.data).slice(0, 300));
  await check('a second check-in is refused', (await call('POST', '/attendance/checkin', { token: mia.token })).data?.message === 'Already checked in today');

  const miaDay = miaIn.data.data._id;
  const early = await call('PUT', `/attendance/${miaDay}/approve`, { token: lee.token });
  await check("today's open check-in can't be approved yet", early.status === 409 && early.data.message === "They haven't checked out yet", JSON.stringify(early.data));
  await check('or rejected', (await call('PUT', `/attendance/${miaDay}/disapprove`, { token: adminToken })).status === 409);
  await check('or approved by an admin edit', (await call('PUT', `/attendance/${miaDay}`, { token: adminToken, body: { approvalStatus: 'approved' } })).status === 409);
  await check('or through the team route', (await call('PUT', `/teams/${alpha._id}/attendance/${miaDay}/approve`, { token: lee.token })).status === 409);
  const miaOut = await call('POST', '/attendance/checkout', { token: mia.token });
  await check('check-out works', miaOut.status === 200 && miaOut.data.data.checkOutTime && miaOut.data.data._id === miaDay);
  await check('checking out twice is refused', (await call('POST', '/attendance/checkout', { token: mia.token })).data?.message === 'Already checked out today');

  // Leave for today: check-in names it
  const leave = await call('POST', '/attendance', { token: max.token, body: { date: today(), status: 'leave', leaveType: 'casual', remarks: 'Doctor' } });
  await check('a one-day leave keeps its type and becomes a leave request',
    leave.status === 201 && leave.data.data.leaveType === 'casual' && leave.data.data.leaveRequestId, JSON.stringify(leave.data).slice(0, 300));
  await check('an unknown leave type is refused',
    (await call('POST', '/attendance', { token: oz.token, body: { date: dayFromNow(30), status: 'leave', leaveType: 'nap' } })).status === 400);
  const blocked = await call('POST', '/attendance/checkin', { token: max.token });
  await check('check-in on a day of leave names the leave', blocked.status === 400 && blocked.data.message === 'You asked for leave today', JSON.stringify(blocked.data));
  const leeNotes = await notificationsOf(lee.token);
  await check("the leader hears about the member's leave",
    leeNotes.some((n) => n.type === 'leave_requested' && n.link === '/approvals' && n.data.leaveRequestId === leave.data.data.leaveRequestId), JSON.stringify(leeNotes.map((n) => n.type)));

  const rejected = await call('PUT', `/attendance/${leave.data.data._id}/disapprove`, { token: lee.token, body: { reviewRemarks: 'We need you in' } });
  await check('the reason goes into reviewRemarks and the employee\'s remarks stay',
    rejected.status === 200 && rejected.data.data.reviewRemarks === 'We need you in' && rejected.data.data.remarks === 'Doctor' &&
    rejected.data.data.approvedBy?.name === 'Lee Leader' && rejected.data.data.reviewedAt, JSON.stringify(rejected.data).slice(0, 400));
  const maxNotes = await notificationsOf(max.token);
  const reviewed = maxNotes.find((n) => n.type === 'attendance_reviewed');
  await check('the employee is told, with a link to their leave', reviewed?.link === '/attendance?tab=leave' && /rejected/.test(reviewed.title), JSON.stringify(reviewed));
  await check('and a leave decision is emailed', outbox().some((mail) => mail.to === 'max@attend.test' && /rejected/.test(mail.subject)), JSON.stringify(outbox()));

  const maxIn = await call('POST', '/attendance/checkin', { token: max.token });
  await check('after the leave was turned down, check-in works and starts a new pending day',
    maxIn.status === 200 && maxIn.data.data.checkInTime && maxIn.data.data.approvalStatus === 'pending' && maxIn.data.data.status === 'present' &&
    !maxIn.data.data.leaveType && !maxIn.data.data.reviewRemarks && !maxIn.data.data.approvedBy, JSON.stringify(maxIn.data).slice(0, 300));
  await check("the employee's own remarks stay", maxIn.data.data.remarks === 'Doctor', JSON.stringify(maxIn.data).slice(0, 300));
  const replaced = await audits().findOne({ action: 'attendance_record_edited', targetId: leave.data.data._id });
  const changes = replaced?.details?.changes || {};
  await check('the decision it replaces is kept in the audit log',
    /rejected/.test(replaced?.details?.reason) && changes.approvalStatus?.from === 'rejected' && changes.approvalStatus.to === 'pending' &&
    changes.reviewRemarks?.from === 'We need you in' && changes.approvedBy?.from === lee._id && changes.leaveType?.from === 'casual' &&
    changes.leaveRequestId?.from === leave.data.data.leaveRequestId && !changes.remarks, JSON.stringify(replaced));

  // Other requests for today
  const absent = (await call('POST', '/attendance', { token: oz.token, body: { date: today(), status: 'absent' } })).data.data;
  await check('check-in on a day marked absent says so',
    (await call('POST', '/attendance/checkin', { token: oz.token })).data?.message === 'You asked to be marked absent today');
  const half = (await call('POST', '/attendance', { token: demo.token, body: { date: today(), status: 'half-day' } })).data.data;
  await check('check-in on a half day says so',
    (await call('POST', '/attendance/checkin', { token: demo.token })).data?.message === 'You asked for a half day today');
  for (const record of [absent, half]) await call('DELETE', `/attendance/${record._id}`, { token: adminToken });

  // Late and half days, with every day a workday for the test
  await call('PUT', '/attendance/settings', { token: adminToken, body: { workdays: [1, 2, 3, 4, 5, 6, 7], shiftStart: '00:00', lateAfterMinutes: 0, halfDayHours: 4 } });
  const kimIn = await call('POST', '/attendance/checkin', { token: kim.token });
  const minutesIntoDay = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date()).split(':').reduce((h, m) => h * 60 + Number(m)));
  await check('a check-in after the shift start and grace minutes is late',
    kimIn.status === 201 && (kimIn.data.data.status === 'late' || minutesIntoDay < 2), JSON.stringify(kimIn.data).slice(0, 200));
  const kimOut = await call('POST', '/attendance/checkout', { token: kim.token });
  await check('a check-out after fewer hours than halfDayHours makes it a half day',
    kimOut.status === 200 && kimOut.data.data.status === 'half-day' && kimOut.data.data.workHours < 4, JSON.stringify(kimOut.data).slice(0, 200));
  await call('PUT', '/attendance/settings', { token: adminToken, body: { workdays: [1, 2, 3, 4, 5], shiftStart: null, halfDayHours: null, lateAfterMinutes: 15 } });
  await check('without a shift start a check-in is present', miaIn.data.data.status === 'present');

  // Across midnight
  const yesterday = dayFromNow(-1);
  const nightShift = await insertRecord({ user: oz._id, day: yesterday, checkInTime: new Date(Date.now() - 3 * HOUR) });
  const ozOut = await call('POST', '/attendance/checkout', { token: oz.token });
  await check("a shift that started yesterday is checked out today",
    ozOut.status === 200 && ozOut.data.data._id === nightShift && ozOut.data.data.day === yesterday && ozOut.data.data.workHours >= 2.9, JSON.stringify(ozOut.data).slice(0, 300));
  await check('then nothing is left to check out', (await call('POST', '/attendance/checkout', { token: oz.token })).status === 404);

  // Once today is checked in, an earlier day's forgotten check-in is not a shift still running
  const forgotten = await insertRecord({ user: lee._id, team: alpha._id, day: yesterday, checkInTime: new Date(Date.now() - 5 * HOUR) });
  await check('setup: a check-in today with yesterday still open', (await call('POST', '/attendance/checkin', { token: lee.token })).status === 201);
  const [leeOut, doubleClick] = await Promise.all([
    call('POST', '/attendance/checkout', { token: lee.token }),
    call('POST', '/attendance/checkout', { token: lee.token }),
  ]);
  await check("checking out closes today's day, once, even with a double click",
    [leeOut, doubleClick].filter((res) => res.status === 200 && res.data.data.day === today()).length === 1 &&
    [leeOut, doubleClick].some((res) => res.status === 400 && res.data.message === 'Already checked out today'),
    JSON.stringify([leeOut.status, leeOut.data?.message, doubleClick.status, doubleClick.data?.message]));
  const again = await call('POST', '/attendance/checkout', { token: lee.token });
  await check("a second check-out says so, and doesn't check out yesterday's forgotten check-in",
    again.status === 400 && again.data.message === 'Already checked out today' && !(await recordById(forgotten)).checkOutTime, JSON.stringify(again.data));

  await insertRecord({ user: demo._id, day: dayFromNow(-3), checkInTime: new Date(Date.now() - 3 * DAY) });
  await check('a check-in more than 20 hours ago is not checked out',
    (await call('POST', '/attendance/checkout', { token: demo.token })).status === 404);
  await insertRecord({ user: demo._id, day: yesterday, checkInTime: new Date(Date.now() - 2 * HOUR), approvalStatus: 'rejected' });
  const refused = await call('POST', '/attendance/checkout', { token: demo.token });
  await check('a rejected day cannot be checked out', refused.status === 400 && refused.data.message === 'This day was rejected', JSON.stringify(refused.data));
});

test("reviews follow the record's team", async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, max, kim, oz } = people;

  const miaDay = (await call('GET', `/attendance?user=${mia._id}&startDate=${today()}&endDate=${today()}`, { token: adminToken })).data.data[0];
  const approved = await call('PUT', `/teams/${alpha._id}/attendance/${miaDay._id}/approve`, { token: lee.token });
  await check('the leader approves a member\'s checked-out day', approved.status === 200 && approved.data.data.approvalStatus === 'approved' && approved.data.data.approvedBy?.name === 'Lee Leader', JSON.stringify(approved.data).slice(0, 300));
  const again = await call('PUT', `/teams/${alpha._id}/attendance/${miaDay._id}/approve`, { token: lee.token });
  await check('approving again is a conflict', again.status === 409 && again.data.message === 'This record was already approved', JSON.stringify(again.data));
  await check('so is rejecting it now (attendance route)',
    (await call('PUT', `/attendance/${miaDay._id}/disapprove`, { token: lee.token })).data?.message === 'This record was already approved');
  await check('also for an admin', (await call('PUT', `/attendance/${miaDay._id}/reject`, { token: adminToken })).status === 409);
  await check('and through the team route', (await call('PUT', `/teams/${alpha._id}/attendance/${miaDay._id}/reject`, { token: lee.token })).status === 409);

  const reviewedAt = approved.data.data.reviewedAt;
  const note = await call('PUT', `/attendance/${miaDay._id}`, { token: adminToken, body: { remarks: 'Checked with HR', reviewRemarks: 'Fine' } });
  await check('a remarks-only edit keeps who reviewed it and when',
    note.status === 200 && note.data.data.approvedBy?.name === 'Lee Leader' && note.data.data.reviewedAt === reviewedAt && note.data.data.reviewRemarks === 'Fine', JSON.stringify(note.data).slice(0, 300));
  await check('the leader cannot change a reviewed record',
    (await call('PUT', `/attendance/${miaDay._id}`, { token: lee.token, body: { status: 'late' } })).data?.message === 'Only an admin can change a record that has already been reviewed');
  await check('nor its decision', (await call('PUT', `/attendance/${miaDay._id}`, { token: lee.token, body: { approvalStatus: 'rejected' } })).status === 403);
  const overturned = await call('PUT', `/attendance/${miaDay._id}`, { token: adminToken, body: { approvalStatus: 'rejected' } });
  await check('an admin changes the decision, and becomes the reviewer',
    overturned.status === 200 && overturned.data.data.approvalStatus === 'rejected' && overturned.data.data.approvedBy?._id === admin._id && overturned.data.data.reviewedAt !== reviewedAt, JSON.stringify(overturned.data).slice(0, 300));
  await check('the owner is told about the change',
    (await notificationsOf(mia.token)).some((n) => n.type === 'attendance_reviewed' && n.link === '/attendance' && n.data.approvalStatus === 'rejected'));

  const leeOwn = (await call('POST', '/attendance', { token: lee.token, body: { date: dayFromNow(-2), status: 'present' } })).data.data;
  const own = await call('PUT', `/attendance/${leeOwn._id}/approve`, { token: lee.token });
  await check('a leader cannot review their own day', own.status === 403 && own.data.message === 'You cannot review your own attendance');

  // History from before joining the team stays with admins
  const ozOld = await insertRecord({ user: oz._id, day: dayFromNow(-5), checkInTime: new Date(Date.now() - 5 * DAY), checkOutTime: new Date(Date.now() - 5 * DAY + 8 * HOUR), workHours: 8 });
  const invite = (await call('POST', `/teams/${alpha._id}/invite`, { token: lee.token, body: { userId: oz._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: oz.token });
  await check("a new leader cannot review a member's days from before they joined",
    (await call('PUT', `/attendance/${ozOld}/approve`, { token: lee.token })).status === 403);
  await check('or edit them', (await call('PUT', `/attendance/${ozOld}`, { token: lee.token, body: { status: 'late' } })).status === 403);
  await check('or see them', (await call('GET', `/attendance/${ozOld}`, { token: lee.token })).status === 403 &&
    !(await call('GET', '/attendance', { token: lee.token })).data.data.some((r) => r._id === ozOld));
  await check('they are in the admins\' queue', (await call('GET', '/attendance?approvalStatus=pending', { token: adminToken })).data.data.some((r) => r._id === ozOld));
  const ozNew = (await call('POST', '/attendance', { token: oz.token, body: { date: dayFromNow(-4), status: 'present' } })).data.data;
  await check('a day asked for after joining belongs to the team', ozNew.team?._id === alpha._id);
  const teamPending = (await call('GET', `/teams/${alpha._id}/attendance/pending`, { token: lee.token })).data.data.map((r) => r._id);
  await check('and is in the team queue, the old one is not', teamPending.includes(ozNew._id) && !teamPending.includes(ozOld), JSON.stringify(teamPending));

  // Reviews at the same moment, on every route: only the first counts
  const reviews = await Promise.all([
    call('PUT', `/attendance/${ozNew._id}/approve`, { token: lee.token }),
    call('PUT', `/attendance/${ozNew._id}/reject`, { token: adminToken, body: { reviewRemarks: 'No' } }),
    call('PUT', `/teams/${alpha._id}/attendance/${ozNew._id}/approve`, { token: lee.token }),
    call('POST', '/attendance/bulk-review', { token: adminToken, body: { ids: [ozNew._id], action: 'reject' } }),
  ]);
  const outcome = (res) => res.data?.data?.results?.[0] ?? res;
  const wins = reviews.filter((res) => outcome(res).status === 200);
  await check('of reviews sent together, exactly one is applied and the others are refused',
    wins.length === 1 && reviews.every((res) => outcome(res).status === 200 || [403, 409].includes(outcome(res).status)),
    JSON.stringify(reviews.map((res) => [outcome(res).status, outcome(res).message ?? outcome(res).data?.message])));
  const decided = await recordById(ozNew._id);
  await check('the stored decision is the one applied', ['approved', 'rejected'].includes(decided.approvalStatus) && decided.approvedBy);
  const ozTold = (await notificationsOf(oz.token)).filter((n) => n.type === 'attendance_reviewed' && n.data.attendanceIds?.includes(ozNew._id));
  await check('and the owner is told once', ozTold.length === 1 && ozTold[0].data.approvalStatus === decided.approvalStatus, JSON.stringify(ozTold));
  // A leader's edit of the decision at the same moment as a review
  const ozNext = (await call('POST', '/attendance', { token: oz.token, body: { date: dayFromNow(-3), status: 'present' } })).data.data;
  const [edit, approval] = await Promise.all([
    call('PUT', `/attendance/${ozNext._id}`, { token: lee.token, body: { approvalStatus: 'rejected' } }),
    call('PUT', `/attendance/${ozNext._id}/approve`, { token: adminToken }),
  ]);
  const settled = await recordById(ozNext._id);
  await check('an edit and a review sent together: one is applied, the other refused',
    [edit, approval].filter((res) => res.status === 200).length === 1 && [edit, approval].every((res) => [200, 403, 409].includes(res.status)) &&
    settled.approvalStatus === (edit.status === 200 ? 'rejected' : 'approved'),
    JSON.stringify([edit.status, edit.data?.message, approval.status, approval.data?.message, settled.approvalStatus]));

  // Someone who moves to another team leaves their history with the old one
  const maxOld = (await call('POST', '/attendance', { token: max.token, body: { date: dayFromNow(-2), status: 'present' } })).data.data;
  await call('DELETE', `/teams/${alpha._id}/members/${max._id}`, { token: lee.token });
  const betaInvite = (await call('POST', `/teams/${beta._id}/invite`, { token: kim.token, body: { userId: max._id } })).data.data;
  const joined = await call('PUT', `/teams/invites/${betaInvite._id}/accept`, { token: max.token });
  await check('setup: the member moved teams', joined.status === 200, JSON.stringify(joined.data).slice(0, 200));

  await check("the new team's leader cannot review the old team's day",
    (await call('PUT', `/attendance/${maxOld._id}/approve`, { token: kim.token })).status === 403);
  await check('nor through their team route', (await call('PUT', `/teams/${beta._id}/attendance/${maxOld._id}/approve`, { token: kim.token })).data?.message === 'This attendance does not belong to your team');
  await check("and doesn't see it", !(await call('GET', '/attendance', { token: kim.token })).data.data.some((r) => r._id === maxOld._id));
  await check('the old leader cannot review it either, now they have left',
    (await call('PUT', `/attendance/${maxOld._id}/approve`, { token: lee.token })).status === 403);
  await check('but still sees it in the team history',
    (await call('GET', '/attendance', { token: lee.token })).data.data.some((r) => r._id === maxOld._id) &&
    (await call('GET', `/teams/${alpha._id}/attendance`, { token: lee.token })).data.data.some((r) => r._id === maxOld._id));
  await check("and not in the team's queue", !(await call('GET', `/teams/${alpha._id}/attendance/pending`, { token: lee.token })).data.data.some((r) => r._id === maxOld._id));
  await check("leaders' reviewable queue leaves out their own and former members' days",
    !(await call('GET', '/attendance?approvalStatus=pending&reviewable=true', { token: lee.token })).data.data.some((r) => r._id === maxOld._id || r._id === leeOwn._id));
  await check('an admin reviews it', (await call('PUT', `/attendance/${maxOld._id}/approve`, { token: adminToken })).status === 200);

  const maxNew = (await call('POST', '/attendance', { token: max.token, body: { date: dayFromNow(-1), status: 'present' } })).data.data;
  await check("the new team's leader reviews days from the new team",
    maxNew.team?._id === beta._id && (await call('PUT', `/teams/${beta._id}/attendance/${maxNew._id}/approve`, { token: kim.token })).status === 200);
  await check('a team member cannot review anyone', (await call('PUT', `/attendance/${maxNew._id}/approve`, { token: mia.token })).status === 403);
});

test('leave over several days', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, kim, oz } = people;
  const NEXT_MONDAY = addDays(MONDAY, 7);

  const sick = await call('POST', '/attendance/leave', { token: mia.token, body: { startDate: MONDAY, endDate: NEXT_MONDAY, leaveType: 'sick', remarks: 'Surgery' } });
  const request = sick.data?.data;
  const expectedDays = [MONDAY, addDays(MONDAY, 1), addDays(MONDAY, 3), addDays(MONDAY, 4), NEXT_MONDAY];
  await check('a request over eight days asks for the five workdays, skipping the weekend and the holiday',
    sick.status === 201 && request.days === 5 && JSON.stringify(request.records.map((r) => r.day)) === JSON.stringify(expectedDays) &&
    request.approvalStatus === 'pending' && request.leaveType === 'sick' && request.leaveTypeLabel === 'Sick leave' &&
    request.startDate === MONDAY && request.endDate === NEXT_MONDAY && request.remarks === 'Surgery', JSON.stringify(sick.data).slice(0, 500));
  const stored = await db.collection('attendances').find({ leaveRequestId: new ObjectId(request.leaveRequestId) }).toArray();
  await check('one pending leave record per day, all in the team',
    stored.length === 5 && stored.every((r) => r.status === 'leave' && r.approvalStatus === 'pending' && String(r.team) === alpha._id));
  const leeNotes = await notificationsOf(lee.token);
  await check('the leader is asked to review it',
    leeNotes.some((n) => n.type === 'leave_requested' && n.link === '/approvals' && n.data.leaveRequestId === request.leaveRequestId && /Sick leave/.test(n.body)), JSON.stringify(leeNotes.slice(0, 3)));

  const over = await call('POST', '/attendance/leave', { token: mia.token, body: { startDate: addDays(MONDAY, 14), endDate: addDays(MONDAY, 15), leaveType: 'sick' } });
  await check('a request over the yearly allowance says how much is left',
    over.status === 400 && /You have 1 day of Sick leave left for 2030/.test(over.data.message), JSON.stringify(over.data));

  const before = await db.collection('attendances').countDocuments({ user: new ObjectId(mia._id) });
  const clash = await call('POST', '/attendance/leave', { token: mia.token, body: { startDate: addDays(MONDAY, 2), endDate: addDays(MONDAY, 8), leaveType: 'casual' } });
  await check('days that already have attendance are a conflict, listed',
    clash.status === 409 && JSON.stringify(clash.data.data?.days) === JSON.stringify([addDays(MONDAY, 3), addDays(MONDAY, 4), NEXT_MONDAY]), JSON.stringify(clash.data));
  await check('and nothing is created', (await db.collection('attendances').countDocuments({ user: new ObjectId(mia._id) })) === before);

  for (const [name, body] of [
    ['more than 60 days', { startDate: '2030-05-01', endDate: '2030-07-15', leaveType: 'unpaid' }],
    ['a half day over several days', { startDate: '2030-05-06', endDate: '2030-05-07', leaveType: 'casual', halfDay: true }],
    ['a range with no workdays', { startDate: addDays(MONDAY, 5), endDate: addDays(MONDAY, 6), leaveType: 'casual' }],
    ['an unknown leave type', { startDate: '2030-05-06', leaveType: 'nap' }],
    ['no leave type', { startDate: '2030-05-06' }],
    ['an end before the start', { startDate: '2030-05-07', endDate: '2030-05-06', leaveType: 'casual' }],
    ['a date that does not exist', { startDate: '2030-02-30', leaveType: 'casual' }],
    ['a range of thousands of years', { startDate: '0001-01-01', endDate: '9999-12-31', leaveType: 'unpaid' }],
    ['an end after the year 9999', { startDate: '9999-12-31', endDate: '+010000-01-01T00:00:00Z', leaveType: 'unpaid' }],
  ]) {
    const res = await call('POST', '/attendance/leave', { token: mia.token, body });
    await check(`leave refuses ${name}`, res.status === 400, `${res.status} ${JSON.stringify(res.data)}`);
  }

  const halfDay = await call('POST', '/attendance/leave', { token: mia.token, body: { startDate: addDays(MONDAY, 21), leaveType: 'earned', halfDay: true } });
  await check('a half day of leave is one half-day record',
    halfDay.status === 201 && halfDay.data.data.days === 0.5 && halfDay.data.data.halfDay === true && halfDay.data.data.records[0].status === 'half-day', JSON.stringify(halfDay.data).slice(0, 300));

  const balance = await call('GET', '/attendance/leave/balance?year=2030', { token: mia.token });
  const byKey = Object.fromEntries((balance.data?.data?.types || []).map((type) => [type.key, type]));
  await check('the balance counts pending days',
    balance.status === 200 && byKey.sick?.allowance === 6 && byKey.sick.pending === 5 && byKey.sick.approved === 0 && byKey.sick.remaining === 1 &&
    byKey.earned?.pending === 0.5 && byKey.earned.remaining === 14.5 && byKey.unpaid?.allowance === null && byKey.unpaid.remaining === null, JSON.stringify(balance.data));
  await check("the member's leader sees it", (await call('GET', `/attendance/leave/balance?user=${mia._id}&year=2030`, { token: lee.token })).status === 200);
  await check('an admin sees it', (await call('GET', `/attendance/leave/balance?user=${mia._id}&year=2030`, { token: adminToken })).status === 200);
  await check("another team's leader does not", (await call('GET', `/attendance/leave/balance?user=${mia._id}`, { token: kim.token })).status === 403);
  await check('nor a teammate', (await call('GET', `/attendance/leave/balance?user=${mia._id}`, { token: oz.token })).status === 403);
  await check('a member cannot see their leader\'s', (await call('GET', `/attendance/leave/balance?user=${lee._id}`, { token: mia.token })).status === 403);
  await check('the year must be a year', (await call('GET', '/attendance/leave/balance?year=last', { token: mia.token })).status === 400);

  const mine = await call('GET', '/attendance/leave', { token: mia.token });
  await check('the employee lists their requests',
    mine.status === 200 && mine.data.data.length === 2 && mine.data.data.every((r) => r.user._id === mia._id), JSON.stringify(mine.data).slice(0, 300));
  await check('the leader lists their team\'s', (await call('GET', '/attendance/leave?status=pending', { token: lee.token })).data.data.some((r) => r.leaveRequestId === request.leaveRequestId));
  await check("another team's leader doesn't", !(await call('GET', '/attendance/leave', { token: kim.token })).data.data.some((r) => r.leaveRequestId === request.leaveRequestId));
  await check('an admin lists everyone\'s', (await call('GET', '/attendance/leave', { token: adminToken })).data.data.some((r) => r.leaveRequestId === request.leaveRequestId));
  const paged = await call('GET', '/attendance/leave?page=1&limit=1', { token: mia.token });
  await check('requests can be paged', paged.data.count === 1 && paged.data.pagination?.total === 2, JSON.stringify(paged.data.pagination));

  await check("another team's leader can't approve it", (await call('PUT', `/attendance/leave/${request.leaveRequestId}/approve`, { token: kim.token })).status === 404);
  await check('the employee cannot approve their own', (await call('PUT', `/attendance/leave/${request.leaveRequestId}/approve`, { token: mia.token })).status === 403);
  await check('a malformed id is a 400', (await call('PUT', '/attendance/leave/nope/approve', { token: lee.token })).status === 400);
  const mailsBefore = outbox().length;
  const approved = await call('PUT', `/attendance/leave/${request.leaveRequestId}/approve`, { token: lee.token, body: { reviewRemarks: 'Get well soon' } });
  await check('the leader approves every day of it',
    approved.status === 200 && approved.data.data.approvalStatus === 'approved' && approved.data.data.counts.approved === 5 &&
    approved.data.data.approvedBy?.name === 'Lee Leader' && approved.data.data.reviewRemarks === 'Get well soon' && approved.data.data.remarks === 'Surgery', JSON.stringify(approved.data).slice(0, 400));
  const miaNote = (await notificationsOf(mia.token)).find((n) => n.type === 'attendance_reviewed' && n.data.leaveRequestId === request.leaveRequestId);
  await check('the employee is told once, with a link to their leave', miaNote?.link === '/attendance?tab=leave' && /approved/.test(miaNote.title), JSON.stringify(miaNote));
  await check('and emailed', outbox().slice(mailsBefore).filter((mail) => mail.to === 'mia@attend.test' && /approved/.test(mail.subject)).length === 1, JSON.stringify(outbox().slice(mailsBefore)));
  const twice = await call('PUT', `/attendance/leave/${request.leaveRequestId}/reject`, { token: adminToken });
  await check('a reviewed request is a conflict', twice.status === 409 && twice.data.message === 'This leave request was already approved', JSON.stringify(twice.data));

  const after = Object.fromEntries((await call('GET', '/attendance/leave/balance?year=2030', { token: mia.token })).data.data.types.map((type) => [type.key, type]));
  await check('approved days move from pending to approved', after.sick.approved === 5 && after.sick.pending === 0 && after.sick.remaining === 1);

  // The last day before the year 10000 used to loop forever, blocking the server
  const lastDay = await withTimeout(call('POST', '/attendance/leave', { token: oz.token, body: { startDate: '9999-12-31', leaveType: 'unpaid' } }));
  await check('leave on 9999-12-31 is answered at once', lastDay.status === 201 && lastDay.data.data.days === 1, JSON.stringify(lastDay.data ?? lastDay).slice(0, 300));
  if (lastDay.status === 201) await call('DELETE', `/attendance/leave/${lastDay.data.data.leaveRequestId}`, { token: oz.token });

  // One day of leave through POST /attendance follows the same rules
  const ozCount = () => db.collection('attendances').countDocuments({ user: new ObjectId(oz._id) });
  const ozBefore = await ozCount();
  const noType = await call('POST', '/attendance', { token: oz.token, body: { date: '2030-05-06', status: 'leave' } });
  await check('a day of leave needs a leave type, so it counts against a balance',
    noType.status === 400 && noType.data.message === 'Please choose a leave type', JSON.stringify(noType.data));
  for (const [name, date] of [['a non-workday', addDays(MONDAY, 5)], ['a holiday', HOLIDAY]]) {
    const res = await call('POST', '/attendance', { token: oz.token, body: { date, status: 'leave', leaveType: 'casual' } });
    await check(`a day of leave is refused on ${name}`, res.status === 400 && /isn't a workday/.test(res.data.message), JSON.stringify(res.data));
  }
  await check('and none of them is created', (await ozCount()) === ozBefore);

  // Two requests sent together can't both use the same allowance
  const MONDAY_2031 = '2031-03-03';
  const together = await Promise.all([MONDAY_2031, addDays(MONDAY_2031, 7)].map((startDate) =>
    call('POST', '/attendance/leave', { token: oz.token, body: { startDate, endDate: addDays(startDate, 3), leaveType: 'sick' } })));
  const sick2031 = Object.fromEntries((await call('GET', '/attendance/leave/balance?year=2031', { token: oz.token })).data.data.types.map((type) => [type.key, type])).sick;
  await check('two requests sent at once that together go over the allowance are not both kept',
    together.filter((res) => res.status === 201).length <= 1 &&
    together.every((res) => res.status === 201 || (res.status === 400 && /of Sick leave left for 2031/.test(res.data.message))) &&
    sick2031.pending <= 6 && sick2031.pending === together.filter((res) => res.status === 201).length * 4,
    JSON.stringify({ together: together.map((res) => [res.status, res.data?.message]), sick2031 }));
  for (const res of together.filter((r) => r.status === 201)) {
    await call('DELETE', `/attendance/leave/${res.data.data.leaveRequestId}`, { token: oz.token });
  }

  const single = await call('POST', '/attendance', { token: mia.token, body: { date: '2030-05-06', status: 'leave', leaveType: 'sick' } });
  await check('a single day of leave counts against the balance too', single.status === 201 && single.data.data.leaveRequestId);
  const tooMany = await call('POST', '/attendance', { token: mia.token, body: { date: '2030-05-07', status: 'leave', leaveType: 'sick' } });
  await check('and is refused once it is used up', tooMany.status === 400 && /You have 0 days of Sick leave left/.test(tooMany.data.message), JSON.stringify(tooMany.data));

  const rejected = await call('PUT', `/attendance/leave/${halfDay.data.data.leaveRequestId}/reject`, { token: lee.token, body: { reviewRemarks: 'Busy week' } });
  await check('the leader rejects a request with a reason', rejected.status === 200 && rejected.data.data.approvalStatus === 'rejected' && rejected.data.data.reviewRemarks === 'Busy week');

  const casual = (await call('POST', '/attendance/leave', { token: mia.token, body: { startDate: addDays(MONDAY, 14), endDate: addDays(MONDAY, 15), leaveType: 'casual' } })).data.data;
  await check('only the employee withdraws their request', (await call('DELETE', `/attendance/leave/${casual.leaveRequestId}`, { token: lee.token })).status === 403);
  const withdrawn = await call('DELETE', `/attendance/leave/${casual.leaveRequestId}`, { token: mia.token });
  await check('the employee withdraws the pending days', withdrawn.status === 200 && withdrawn.data.data.withdrawn === 2, JSON.stringify(withdrawn.data));
  await check('and it is gone', (await call('DELETE', `/attendance/leave/${casual.leaveRequestId}`, { token: mia.token })).status === 404);
  await check('a reviewed request cannot be withdrawn', (await call('DELETE', `/attendance/leave/${request.leaveRequestId}`, { token: mia.token })).status === 409);

  const leeLeave = await call('POST', '/attendance/leave', { token: lee.token, body: { startDate: '2030-06-03', leaveType: 'casual' } });
  await check("a leader's own leave goes to the admins (no co-leader)",
    leeLeave.status === 201 && (await notificationsOf(adminToken)).some((n) => n.type === 'leave_requested' && n.data.leaveRequestId === leeLeave.data.data.leaveRequestId));
  await check('and they cannot approve it themselves',
    (await call('PUT', `/attendance/leave/${leeLeave.data.data.leaveRequestId}/approve`, { token: lee.token })).data?.message === 'You cannot review your own leave request');
});

test('missed check-outs and corrections', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, kim } = people;

  const checkInTime = new Date(Date.now() - 4 * DAY);
  const missed = await insertRecord({ user: mia._id, team: alpha._id, day: dayFromNow(-4), checkInTime, approvalStatus: 'approved', approvedBy: new ObjectId(lee._id) });
  const run = await runJob('attendance-missed-checkout');
  await check('the job marks open check-ins from earlier days', run.status === 200 && run.data.data.marked >= 2, JSON.stringify(run.data));
  await check('the record is marked', (await recordById(missed)).missedCheckout === true);
  const notes = (await notificationsOf(mia.token)).filter((n) => n.type === 'attendance_missed_checkout');
  await check('the owner is told', notes.length === 1 && notes[0].link === '/attendance' && notes[0].data.attendanceId === missed && notes[0].actor === null, JSON.stringify(notes));
  const second = await runJob('attendance-missed-checkout');
  await check('a second pass changes nothing', second.data.data.marked === 0);
  await check('and tells nobody again', (await notificationsOf(mia.token)).filter((n) => n.type === 'attendance_missed_checkout').length === 1);
  const recentOpen = await db.collection('attendances').findOne({ user: new ObjectId(demo._id), day: dayFromNow(-1) });
  await check('a check-in from the last 20 hours is left alone', recentOpen && !recentOpen.missedCheckout);

  const correct = (body, token = mia.token) => call('POST', `/attendance/${missed}/correction`, { token, body });
  await check('only the owner asks for a correction', (await correct({ checkOutTime: new Date(checkInTime.getTime() + 8 * HOUR) }, kim.token)).status === 403);
  await check('the time is required', (await correct({})).status === 400);
  await check('not before the check-in', (await correct({ checkOutTime: new Date(checkInTime.getTime() - HOUR) })).status === 400);
  await check('not more than a day after it', (await correct({ checkOutTime: new Date(checkInTime.getTime() + 25 * HOUR) })).status === 400);
  await check('not in the future', (await call('POST', `/attendance/${await insertRecord({ user: mia._id, team: alpha._id, day: dayFromNow(-9), checkInTime: new Date(Date.now() - 2 * HOUR) })}/correction`, { token: mia.token, body: { checkOutTime: new Date(Date.now() + 2 * HOUR) } })).status === 400);
  const fixTime = new Date(checkInTime.getTime() + 8 * HOUR);
  const asked = await correct({ checkOutTime: fixTime.toISOString(), remarks: 'Forgot to check out' });
  await check('the owner asks for the time they left, even though the day was approved',
    asked.status === 200 && asked.data.data.correctionRequest?.checkOutTime === fixTime.toISOString() && asked.data.data.correctionRequest.remarks === 'Forgot to check out', JSON.stringify(asked.data).slice(0, 300));
  await check('the leader is asked to apply it',
    (await notificationsOf(lee.token)).some((n) => n.type === 'attendance_correction_requested' && n.link === '/approvals' && n.data.attendanceId === missed));
  const askedAgain = await correct({ checkOutTime: fixTime.toISOString(), remarks: 'Forgot to check out, left at six' });
  await check('asking again replaces the request', askedAgain.status === 200 && askedAgain.data.data.correctionRequest.remarks === 'Forgot to check out, left at six');
  await check('without telling the reviewers again',
    (await notificationsOf(lee.token)).filter((n) => n.type === 'attendance_correction_requested' && n.data.attendanceId === missed).length === 1);
  await check('reviewers can list corrections and missed check-outs',
    (await call('GET', '/attendance?hasCorrection=true', { token: lee.token })).data.data.some((r) => r._id === missed) &&
    (await call('GET', '/attendance?missedCheckout=true', { token: lee.token })).data.data.some((r) => r._id === missed));

  await check('the leader cannot change other fields of the reviewed day',
    (await call('PUT', `/attendance/${missed}`, { token: lee.token, body: { status: 'late' } })).status === 403);
  const applied = await call('PUT', `/attendance/${missed}`, { token: lee.token, body: { checkOutTime: fixTime.toISOString() } });
  await check('the leader applies the check-out time, which settles the request',
    applied.status === 200 && applied.data.data.workHours === 8 && applied.data.data.correctionRequest === null && applied.data.data.missedCheckout === false &&
    applied.data.data.approvalStatus === 'approved', JSON.stringify(applied.data).slice(0, 300));
  await check('and leaves who approved it alone', applied.data.data.approvedBy?._id === lee._id);
  const rewrite = await call('PUT', `/attendance/${missed}`, { token: lee.token, body: { checkOutTime: new Date(checkInTime.getTime() + 10 * HOUR).toISOString() } });
  await check('once settled, the leader cannot move the check-out time of the reviewed day again',
    rewrite.status === 403 && rewrite.data.message === 'Only an admin can change a record that has already been reviewed' &&
    (await recordById(missed)).workHours === 8, JSON.stringify(rewrite.data));
  const reviewedDay = await insertRecord({
    user: mia._id, team: alpha._id, day: dayFromNow(-10), approvalStatus: 'approved', approvedBy: new ObjectId(lee._id),
    checkInTime: new Date(Date.now() - 10 * DAY), checkOutTime: new Date(Date.now() - 10 * DAY + 8 * HOUR), workHours: 8,
  });
  await check("nor the check-out time of a reviewed day nobody asked to correct",
    (await call('PUT', `/attendance/${reviewedDay}`, { token: lee.token, body: { checkOutTime: new Date(Date.now() - 10 * DAY + 2 * HOUR).toISOString() } })).status === 403 &&
    (await recordById(reviewedDay)).workHours === 8);
  const adminFix = await call('PUT', `/attendance/${reviewedDay}`, { token: adminToken, body: { checkOutTime: new Date(Date.now() - 10 * DAY + 7 * HOUR).toISOString() } });
  await check('an admin still can', adminFix.status === 200 && adminFix.data.data.workHours === 7, JSON.stringify(adminFix.data).slice(0, 200));

  const miaToday = (await call('GET', `/attendance?user=${mia._id}&startDate=${today()}&endDate=${today()}`, { token: mia.token })).data.data[0];
  await check('a reviewed day without a missed check-out cannot be corrected',
    (await call('POST', `/attendance/${miaToday._id}/correction`, { token: mia.token, body: { checkOutTime: new Date().toISOString() } })).status === 409);

  // Someone outside a team: the admins handle it
  const demoOld = (await db.collection('attendances').findOne({ user: new ObjectId(demo._id), day: dayFromNow(-3) }));
  await check('the old open check-in was marked too', demoOld?.missedCheckout === true);
  const demoAsk = await call('POST', `/attendance/${demoOld._id}/correction`, { token: demo.token, body: { checkOutTime: new Date(demoOld.checkInTime.getTime() + 6 * HOUR).toISOString() } });
  await check('without a team the admins are asked',
    demoAsk.status === 200 && (await notificationsOf(adminToken)).some((n) => n.type === 'attendance_correction_requested' && n.data.attendanceId === String(demoOld._id)));
  const declined = await call('PUT', `/attendance/${demoOld._id}`, { token: adminToken, body: { correctionRequest: null } });
  await check('an admin can turn a correction down', declined.status === 200 && declined.data.data.correctionRequest === null && declined.data.data.missedCheckout === true, JSON.stringify(declined.data).slice(0, 300));
});

test('auto-absent', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia } = people;

  // A workday at least a week ahead, so everyone was signed up before it
  let workday = dayFromNow(7);
  while ([0, 6].includes(weekday(workday))) workday = addDays(workday, 1);
  const nowAfter = (day) => `${addDays(day, 1)}T06:00:00Z`;

  const off = await runJob('attendance-auto-absent', nowAfter(workday));
  await check('nothing happens while autoAbsent is off', off.status === 200 && off.data.data.skipped, JSON.stringify(off.data));
  await call('PUT', '/attendance/settings', { token: adminToken, body: { autoAbsent: true } });

  let saturday = workday;
  while (weekday(saturday) !== 6) saturday = addDays(saturday, 1);
  await check('a weekend day is skipped', (await runJob('attendance-auto-absent', nowAfter(saturday))).data.data.skipped === 'not a workday');
  const holiday = (await call('POST', '/attendance/holidays', { token: adminToken, body: { day: workday, name: 'Test holiday' } })).data.data;
  await check('so is a holiday', (await runJob('attendance-auto-absent', nowAfter(workday))).data.data.skipped === 'not a workday');
  await call('DELETE', `/attendance/holidays/${holiday._id}`, { token: adminToken });

  await insertRecord({ user: lee._id, team: alpha._id, day: workday, approvalStatus: 'approved' });
  const expected = (await db.collection('users').find({ role: { $in: ['team_member', 'team_leader'] }, isActive: true, deletedAt: null }).toArray())
    .filter((user) => String(user._id) !== lee._id).length;
  const settingsSaved = (await call('GET', '/attendance/settings', { token: adminToken })).data.data.updatedAt;
  const run = await runJob('attendance-auto-absent', nowAfter(workday));
  await check('everyone in a team without a record that day is marked absent', run.data.data.day === workday && run.data.data.marked === expected && expected >= 4, JSON.stringify({ run: run.data, expected }));
  const miaAbsent = await db.collection('attendances').findOne({ user: new ObjectId(mia._id), day: workday });
  await check('as approved, automatic absences in their team',
    miaAbsent?.status === 'absent' && miaAbsent.approvalStatus === 'approved' && miaAbsent.autoMarked === true &&
    miaAbsent.remarks === 'Marked absent: no check-in' && String(miaAbsent.team) === alpha._id, JSON.stringify(miaAbsent));
  await check('someone with a record keeps it', (await db.collection('attendances').findOne({ user: new ObjectId(lee._id), day: workday })).status === 'present');
  await check('people outside a team and admins are not marked',
    !(await db.collection('attendances').findOne({ day: workday, user: { $in: [new ObjectId(demo._id), new ObjectId(admin._id)] } })));
  const second = await runJob('attendance-auto-absent', nowAfter(workday));
  await check('a second pass knows the day is done', second.data.data.skipped === 'already done' && second.data.data.day === workday, JSON.stringify(second.data));
  await check("the job's bookkeeping isn't a settings change",
    (await call('GET', '/attendance/settings', { token: adminToken })).data.data.updatedAt === settingsSaved &&
    !('autoAbsentDays' in (await call('GET', '/attendance/settings', { token: adminToken })).data.data));

  // An admin deletes an absence (the person wasn't expected that day): it stays deleted
  await check('an admin deletes an automatic absence', (await call('DELETE', `/attendance/${miaAbsent._id}`, { token: adminToken })).status === 200);
  await runJob('attendance-auto-absent', nowAfter(workday));
  await check('and a later pass of the same day does not bring it back',
    !(await db.collection('attendances').findOne({ user: new ObjectId(mia._id), day: workday })));
  await call('PUT', '/attendance/settings', { token: adminToken, body: { autoAbsent: false } });
});

test('summaries, stats and export', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, kim, oz } = people;

  const at = (day, time) => new Date(`${day}T${time}:00+05:30`);
  for (const [day, status, approvalStatus, hours, remarks] of [
    ['2030-04-01', 'present', 'approved', 8, '=HYPERLINK("http://x")'],
    ['2030-04-02', 'late', 'approved', 7.5],
    ['2030-04-03', 'present', 'pending', 6],
    ['2030-04-04', 'absent', 'rejected', 0],
  ]) {
    await insertRecord({
      user: mia._id, team: alpha._id, day, status, approvalStatus, remarks,
      ...(hours ? { checkInTime: at(day, '09:00'), checkOutTime: new Date(at(day, '09:00').getTime() + hours * HOUR), workHours: hours } : {}),
    });
  }

  const april = await call('GET', '/attendance/summary?month=2030-04', { token: mia.token });
  const s = april.data?.data;
  await check('the month summary counts approved days by type and hours',
    april.status === 200 && s.days.present === 1 && s.days.late === 1 && s.days.absent === 0 && s.approvedHours === 15.5 &&
    s.pendingHours === 6 && s.pendingCount === 1 && s.rejectedCount === 1, JSON.stringify(april.data));
  const march = (await call('GET', '/attendance/summary?month=2030-03', { token: mia.token })).data.data;
  await check('approved leave counts as leave days, rejected half days not at all', march.days.leave === 5 && march.days.halfDay === 0, JSON.stringify(march));
  await check("the member's leader sees it", (await call('GET', `/attendance/summary?user=${mia._id}&month=2030-04`, { token: lee.token })).data?.data?.approvedHours === 15.5);
  await check('an admin sees it', (await call('GET', `/attendance/summary?user=${mia._id}&month=2030-04`, { token: adminToken })).status === 200);
  await check("another team's leader does not", (await call('GET', `/attendance/summary?user=${mia._id}&month=2030-04`, { token: kim.token })).status === 403);
  await check('nor a teammate', (await call('GET', `/attendance/summary?user=${mia._id}&month=2030-04`, { token: oz.token })).status === 403);
  await check('the month must be a month', (await call('GET', '/attendance/summary?month=2030-13', { token: mia.token })).status === 400);

  // A deleted account's days stay out of the people list
  const ghost = new ObjectId();
  await db.collection('users').insertOne({ _id: ghost, name: 'Deleted user', email: `deleted-${ghost}@attend.test`, password: 'x', role: 'user', isActive: false, deletedAt: new Date() });
  await insertRecord({ user: ghost, day: '2030-04-01', approvalStatus: 'approved', workHours: 4 });

  const stats = await call('GET', '/attendance/stats?startDate=2030-04-01&endDate=2030-04-30', { token: adminToken });
  const miaRow = stats.data?.data?.people?.find((row) => row.user._id === mia._id);
  await check('stats count each person\'s approved days and hours',
    stats.status === 200 && miaRow?.present === 1 && miaRow.late === 1 && miaRow.absent === 0 && miaRow.hours === 15.5 &&
    stats.data.data.pendingCount >= 1 && typeof stats.data.data.checkedInToday === 'number', JSON.stringify(stats.data).slice(0, 500));
  await check('deleted accounts are left out', !stats.data.data.people.some((row) => row.user._id === String(ghost)));
  const leeStats = await call('GET', '/attendance/stats?startDate=2030-04-01&endDate=2030-04-30', { token: lee.token });
  await check('a leader gets their teams', leeStats.status === 200 && leeStats.data.data.people.some((row) => row.user._id === mia._id));
  await check('not a team they do not lead', (await call('GET', `/attendance/stats?team=${beta._id}`, { token: lee.token })).status === 403);
  await check('an admin can pick a team', (await call('GET', `/attendance/stats?team=${beta._id}&startDate=2030-04-01&endDate=2030-04-30`, { token: adminToken })).data.data.people.length === 0);
  await check('members cannot see stats', (await call('GET', '/attendance/stats', { token: mia.token })).status === 403);
  await check('today\'s check-ins are counted', (await call('GET', '/attendance/stats', { token: adminToken })).data.data.checkedInToday >= 3);

  const csv = await download('/attendance/export?startDate=2030-04-01&endDate=2030-04-30', adminToken);
  const lines = csv.text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '').trim().split('\r\n');
  await check('an admin downloads the records as CSV',
    csv.status === 200 && /text\/csv/.test(csv.type) && lines[0].startsWith('Date,Employee,Email,Department,Team,Day type') &&
    lines.filter((line) => line.includes('mia@attend.test')).length === 4, csv.text.slice(0, 400));
  await check('times are local', lines.some((line) => line.includes('2030-04-01 09:00')));
  await check('a remark that looks like a formula is defused', csv.text.includes("'=HYPERLINK") && !/,=HYPERLINK/.test(csv.text));
  await check('the export is audited', (await auditCount('attendance_exported')) === 1);
  const leeCsv = await download('/attendance/export?startDate=2030-04-01&endDate=2030-04-30', lee.token);
  await check('a leader exports their teams\' records', leeCsv.status === 200 && leeCsv.text.includes('mia@attend.test'));
  const kimCsv = await download('/attendance/export?startDate=2030-04-01&endDate=2030-04-30', kim.token);
  await check("but not another team's", kimCsv.status === 200 && !kimCsv.text.includes('mia@attend.test'));
  await check('a bad filter is a 400', (await download('/attendance/export?startDate=2030-02-30', adminToken)).status === 400);
});

test('bulk review', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia, max, kim, oz } = people;

  const miaDay = (await call('POST', '/attendance', { token: mia.token, body: { date: dayFromNow(-6), status: 'present' } })).data.data;
  const ozDay = (await call('POST', '/attendance', { token: oz.token, body: { date: dayFromNow(-6), status: 'present' } })).data.data;
  const kimDay = (await call('POST', '/attendance', { token: kim.token, body: { date: dayFromNow(-6), status: 'present' } })).data.data;
  const leeDay = (await call('POST', '/attendance', { token: lee.token, body: { date: dayFromNow(-6), status: 'present' } })).data.data;
  const done = (await call('GET', `/attendance?user=${mia._id}&approvalStatus=approved`, { token: lee.token })).data.data[0];

  const ids = [miaDay._id, ozDay._id, done._id, 'nope', kimDay._id, leeDay._id, miaDay._id];
  const bulk = await call('POST', '/attendance/bulk-review', { token: lee.token, body: { ids, action: 'approve', reviewRemarks: 'All good' } });
  const results = Object.fromEntries((bulk.data?.data?.results || []).map((result) => [result.id, result]));
  await check('each record gets its own result, duplicates once',
    bulk.status === 200 && bulk.data.data.results.length === 6 && bulk.data.data.succeeded === 2 && bulk.data.data.failed === 4, JSON.stringify(bulk.data));
  await check('records the leader may review are approved', results[miaDay._id]?.ok && results[ozDay._id]?.ok);
  await check('an already reviewed one is a conflict', results[done._id]?.status === 409);
  await check('a malformed id is a 400', results.nope?.status === 400);
  await check("another team's record is not found", results[kimDay._id]?.status === 404);
  await check('their own is refused', results[leeDay._id]?.status === 403);
  const stored = await recordById(miaDay._id);
  await check('the note and reviewer are stored', stored.approvalStatus === 'approved' && stored.reviewRemarks === 'All good' && String(stored.approvedBy) === lee._id);
  await check('the owner is told', (await notificationsOf(mia.token)).some((n) => n.type === 'attendance_reviewed' && n.data.attendanceIds?.includes(miaDay._id)));

  await check('members cannot bulk review', (await call('POST', '/attendance/bulk-review', { token: max.token, body: { ids: [kimDay._id], action: 'approve' } })).status === 403);
  await check('at most 100 ids', (await call('POST', '/attendance/bulk-review', { token: adminToken, body: { ids: Array.from({ length: 101 }, () => miaDay._id), action: 'approve' } })).status === 400);
  await check('at least one', (await call('POST', '/attendance/bulk-review', { token: adminToken, body: { ids: [], action: 'approve' } })).status === 400);
  await check('approve or reject only', (await call('POST', '/attendance/bulk-review', { token: adminToken, body: { ids: [kimDay._id], action: 'maybe' } })).status === 400);
  const adminBulk = await call('POST', '/attendance/bulk-review', { token: adminToken, body: { ids: [kimDay._id, leeDay._id], action: 'reject' } });
  await check('an admin rejects records of any team', adminBulk.data?.data?.succeeded === 2);
});

test('admin-created records and the audit log', async (t) => {
  const check = checker(t);
  const { call } = server.api;

  const inactive = new ObjectId();
  const deleted = new ObjectId();
  await db.collection('users').insertMany([
    { _id: inactive, name: 'Away', email: 'away@attend.test', password: 'x', role: 'user', isActive: false, deletedAt: null },
    { _id: deleted, name: 'Deleted user', email: 'gone@attend.test', password: 'x', role: 'user', isActive: false, deletedAt: new Date() },
  ]);
  const create = (user, extra = {}) => call('POST', '/attendance', { token: adminToken, body: { user, date: dayFromNow(-8), status: 'present', ...extra } });
  await check('a deactivated user is refused', (await create(String(inactive))).status === 400);
  await check('a deleted account is refused', (await create(String(deleted))).data?.message === "That user doesn't exist or is no longer active");
  await check('a user who does not exist is refused', (await create(String(new ObjectId()))).status === 400);
  await check('a malformed id is refused', (await create('nope')).data?.message === 'Invalid user');
  await check('an unknown leave type is refused', (await create(demo._id, { status: 'leave', leaveType: 'nap' })).status === 400);

  const made = await create(demo._id, { remarks: 'Added by admin' });
  await check('an admin adds a day for someone, approved by them',
    made.status === 201 && made.data.data.approvalStatus === 'approved' && made.data.data.approvedBy?.name === 'Admin User' && made.data.data.reviewedAt, JSON.stringify(made.data).slice(0, 300));
  await check('it is audited', (await auditCount('attendance_record_created', { targetId: made.data.data._id })) === 1);

  const edited = await call('PUT', `/attendance/${made.data.data._id}`, { token: adminToken, body: { status: 'late', remarks: 'Added by admin' } });
  const event = await audits().findOne({ action: 'attendance_record_edited', targetId: made.data.data._id });
  await check('an edit is audited with what changed',
    edited.status === 200 && event?.details?.changes?.status?.from === 'present' && event.details.changes.status.to === 'late' && !event.details.changes.remarks, JSON.stringify(event));
  await check('and leaves the reviewer as it was', edited.data.data.approvedBy?.name === 'Admin User' && edited.data.data.reviewedAt === made.data.data.reviewedAt);
  await check('an owner\'s remarks edit is audited too', await (async () => {
    const pending = (await call('POST', '/attendance', { token: demo.token, body: { date: dayFromNow(-11), status: 'present' } })).data.data;
    await call('PUT', `/attendance/${pending._id}`, { token: demo.token, body: { remarks: 'WFH' } });
    return (await auditCount('attendance_record_edited', { targetId: pending._id })) === 1;
  })());

  await check('a delete is audited', (await call('DELETE', `/attendance/${made.data.data._id}`, { token: adminToken })).status === 200 &&
    (await auditCount('attendance_record_deleted', { targetId: made.data.data._id })) === 1);
});

test('a frozen team', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { max, kim } = people;

  const maxDay = (await call('POST', '/attendance', { token: max.token, body: { date: dayFromNow(-7), status: 'present' } })).data.data;
  const frozen = await call('PUT', `/teams/${beta._id}`, { token: adminToken, body: { isActive: false } });
  await check('setup: an admin freezes the team', frozen.status === 200 && frozen.data.data.isActive === false);

  await check('its leader cannot review (attendance route)', (await call('PUT', `/attendance/${maxDay._id}/approve`, { token: kim.token })).status === 403);
  await check('or through the team route', /frozen/.test((await call('PUT', `/teams/${beta._id}/attendance/${maxDay._id}/approve`, { token: kim.token })).data?.message));
  await check('or edit', (await call('PUT', `/attendance/${maxDay._id}`, { token: kim.token, body: { status: 'late' } })).status === 403);
  await check('or bulk review', (await call('POST', '/attendance/bulk-review', { token: kim.token, body: { ids: [maxDay._id], action: 'approve' } })).data?.data?.results?.[0]?.status === 403);
  await check('but still reads the records',
    (await call('GET', `/attendance/${maxDay._id}`, { token: kim.token })).status === 200 &&
    (await call('GET', `/teams/${beta._id}/attendance`, { token: kim.token })).data.data.some((r) => r._id === maxDay._id) &&
    (await call('GET', '/attendance', { token: kim.token })).data.data.some((r) => r._id === maxDay._id));
  await check('an admin reviews it through the team route', (await call('PUT', `/teams/${beta._id}/attendance/${maxDay._id}/approve`, { token: adminToken })).status === 200);

  const leave = await call('POST', '/attendance/leave', { token: max.token, body: { startDate: '2030-07-01', leaveType: 'casual' } });
  await check("a frozen team's leave requests go to the admins",
    leave.status === 201 && (await notificationsOf(adminToken)).some((n) => n.type === 'leave_requested' && n.data.leaveRequestId === leave.data.data.leaveRequestId) &&
    !(await notificationsOf(kim.token)).some((n) => n.type === 'leave_requested' && n.data.leaveRequestId === leave.data.data.leaveRequestId));
});

test('requests that notify reviewers are limited per person', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { flo, mia } = people;

  // Leave and correction requests share one limit of 30 an hour
  const nowhere = String(new ObjectId());
  const statuses = [];
  for (let i = 0; i < 30; i += 1) {
    statuses.push((await call('POST', `/attendance/${nowhere}/correction`, { token: flo.token, body: {} })).status);
  }
  await check('up to 30 an hour are answered as usual', statuses.every((status) => status === 404), JSON.stringify(statuses));
  const limited = await call('POST', '/attendance/leave', { token: flo.token, body: { startDate: '2032-01-05', leaveType: 'casual' } });
  await check('after that, leave requests are refused for a while',
    limited.status === 429 && limited.data.message === 'Too many leave or correction requests. Please try again later.', JSON.stringify(limited.data));
  await check('so are corrections', (await call('POST', `/attendance/${nowhere}/correction`, { token: flo.token, body: {} })).status === 429);
  await check('and a day of leave through POST /attendance',
    (await call('POST', '/attendance', { token: flo.token, body: { date: '2032-01-05', status: 'leave', leaveType: 'casual' } })).status === 429);
  await check('other requests still work',
    (await call('POST', '/attendance', { token: flo.token, body: { date: '2032-01-06', status: 'present' } })).status === 201);
  await check('and other people are not affected',
    (await call('POST', `/attendance/${nowhere}/correction`, { token: mia.token, body: {} })).status === 404);
});
