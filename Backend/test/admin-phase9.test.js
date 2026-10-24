// End-to-end checks for the admin area: reading the audit log, the dashboard
// figures, the per-team report, the CSV exports, and the contact inbox (field
// limits, the honeypot, telling admins, replying by email, search, sort and
// counts). Fixtures go straight into the database, so these checks don't
// depend on how other modules create tasks, teams or attendance.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, SESSION_COOKIE, USER, checker, connectDatabase, istDay, sleep, startServer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * DAY);
// Calendar day n days ago (negative: ahead), and that day as a stored due date
const dayAgo = (n) => istDay(daysAgo(n));
const dueDay = (n) => new Date(`${dayAgo(n)}T00:00:00.000Z`);
const TODAY = dayAgo(0);

const OUTBOX = path.join(os.tmpdir(), `pandav-admin-outbox-${process.pid}.jsonl`);
const MAIL_OUTBOX = path.join(os.tmpdir(), `pandav-admin-mail-outbox-${process.pid}.jsonl`);
const outbox = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);

const oid = (id) => new mongoose.Types.ObjectId(String(id));
// An id that sorts as if it had been made at `date`, as real ones do
const idAt = (date) => oid(`${Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0')}${crypto.randomBytes(8).toString('hex')}`);
const stamp = (date = new Date()) => ({ createdAt: date, updatedAt: date });

// A minimal SMTP server, so replies are really sent. A recipient containing
// "bounce" is refused, to see a failed send.
const startSmtp = () => new Promise((resolve) => {
  const received = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    let inData = false;
    let current = { to: [], data: '' };
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(current);
            current = { to: [], data: '' };
            socket.write('250 OK\r\n');
          } else {
            current.data += `${line}\n`;
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'RCPT' && /bounce/i.test(line)) socket.write('550 No such user\r\n');
        else if (command === 'RCPT') { current.to.push(line); socket.write('250 OK\r\n'); }
        else if (command === 'DATA') { inData = true; socket.write('354 Go ahead\r\n'); }
        else if (command === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
        else if (command === 'RSET') { current = { to: [], data: '' }; socket.write('250 OK\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    received,
    close: () => new Promise((done) => {
      for (const socket of sockets) socket.destroy();
      server.close(done);
    }),
  }));
});

// Minimal CSV reader for the exports: rows of cells, quotes undone, without
// the byte order mark
const BOM = String.fromCharCode(0xfeff);
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && body[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...records] = rows;
  return { header, records: records.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]]))) };
};

let server;
let mailServer;
let smtp;
let db;
let mailDb;
const people = {};
const ids = {};
let adminToken;

before(async () => {
  fs.rmSync(OUTBOX, { force: true });
  fs.rmSync(MAIL_OUTBOX, { force: true });
  smtp = await startSmtp();
  server = await startServer('admin-phase9', { MAIL_OUTBOX: OUTBOX });
  mailServer = await startServer('admin-phase9-mail', {
    MAIL_OUTBOX,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.port),
    MAIL_FROM: 'pandav@test.local',
  });
  db = await connectDatabase('admin-phase9');
  mailDb = await connectDatabase('admin-phase9-mail');

  const { register, login, me } = server.api;
  adminToken = await login(ADMIN);
  people.admin = { token: adminToken, ...(await me(adminToken)) };
  const userToken = await login(USER);
  people.user = { token: userToken, ...(await me(userToken)) };
  for (const [key, name] of [['lee', 'Lee Leader'], ['mia', 'Mia Member'], ['ola', 'Ola Frozen'], ['nat', 'Nat Solo'], ['ina', 'Ina Inactive']]) {
    people[key] = await register(name, `${key}@admin9.test`);
  }
  const { admin, lee, mia, ola, nat, ina } = people;

  // Two teams: Alpha (Lee leads, Mia), and Beta (Ola), which is frozen
  const users = db.collection('users');
  ids.alpha = new mongoose.Types.ObjectId();
  ids.beta = new mongoose.Types.ObjectId();
  await db.collection('teams').insertMany([
    { _id: ids.alpha, name: 'Admin Alpha', leaders: [oid(lee._id)], members: [oid(mia._id)], createdBy: oid(admin._id), isActive: true, ...stamp() },
    { _id: ids.beta, name: 'Admin Beta', leaders: [oid(ola._id)], members: [], createdBy: oid(admin._id), isActive: false, ...stamp() },
  ]);
  await users.updateOne({ _id: oid(lee._id) }, { $set: { role: 'team_leader', teamId: ids.alpha } });
  await users.updateOne({ _id: oid(mia._id) }, { $set: { role: 'team_member', teamId: ids.alpha } });
  await users.updateOne({ _id: oid(ola._id) }, { $set: { role: 'team_leader', teamId: ids.beta } });
  await users.updateOne({ _id: oid(ina._id) }, { $set: { isActive: false } });
  ids.natLogin = new Date('2026-10-20T09:05:00.000Z'); // 14:35 in India
  await users.updateOne({ _id: oid(nat._id) }, { $set: { department: '=SUM(A1)', lastLoginAt: ids.natLogin } });
  // A deleted account: kept, anonymised and deactivated
  ids.deleted = new mongoose.Types.ObjectId();
  await users.insertOne({
    _id: ids.deleted, name: 'Deleted user', email: 'deleted-1@deleted.invalid', password: 'x', role: 'user',
    isActive: false, deletedAt: new Date(), ...stamp(),
  });

  // Tasks, dated around today
  const task = (fields) => ({
    description: 'd', priority: 'medium', estimatedDays: 1, tags: [], assigneeProgress: [],
    createdBy: oid(admin._id), startDate: dueDay(10), team: null, ...fields,
  });
  ids.tasks = {
    a1: idAt(daysAgo(5)), a2: idAt(daysAgo(5)), a3: idAt(daysAgo(4)), a4: idAt(daysAgo(1)),
    n1: idAt(daysAgo(3)), x1: idAt(daysAgo(2)), b1: idAt(daysAgo(40)),
  };
  const t = ids.tasks;
  await db.collection('tasks').insertMany([
    // Alpha: finished in two days
    task({
      _id: t.a1, title: 'Alpha, shipped', status: 'completed', team: ids.alpha, assignedTo: [oid(lee._id), oid(mia._id)],
      dueDate: dueDay(2), completedDate: daysAgo(3), approvedBy: oid(admin._id), approvedAt: daysAgo(3), ...stamp(daysAgo(5)),
    }),
    // Alpha: open and past its due day
    task({ _id: t.a2, title: 'Alpha, late', status: 'in-progress', team: ids.alpha, assignedTo: [oid(mia._id)], dueDate: dueDay(2), ...stamp(daysAgo(5)) }),
    // Alpha: one of two assignees has asked for review
    task({
      _id: t.a3, title: 'Alpha, half done', status: 'in-progress', team: ids.alpha, assignedTo: [oid(lee._id), oid(mia._id)],
      assigneeProgress: [{ user: oid(lee._id), status: 'in-progress' }, { user: oid(mia._id), status: 'completion-requested' }],
      dueDate: dueDay(-5), ...stamp(daysAgo(4)),
    }),
    // Alpha: due today, so not overdue yet
    task({ _id: t.a4, title: 'Alpha, due today', status: 'pending', team: ids.alpha, assignedTo: [oid(mia._id)], dueDate: dueDay(0), ...stamp(daysAgo(1)) }),
    // No team: waiting for review
    task({ _id: t.n1, title: 'Solo, for review', status: 'completion-requested', assignedTo: [oid(nat._id)], dueDate: dueDay(-3), ...stamp(daysAgo(3)) }),
    // No team: cancelled, so never overdue
    task({ _id: t.x1, title: 'Solo, cancelled', status: 'cancelled', assignedTo: [oid(nat._id)], dueDate: dueDay(3), ...stamp(daysAgo(2)) }),
    // Beta (frozen): old and overdue, outside the report's period
    task({ _id: t.b1, title: 'Beta, forgotten', status: 'pending', team: ids.beta, assignedTo: [oid(ola._id)], dueDate: dueDay(30), startDate: dueDay(40), ...stamp(daysAgo(40)) }),
  ]);

  // Attendance: approved records count in reports; pending ones wait for review
  const record = (user, n, fields) => ({
    user: oid(user._id), team: null, date: daysAgo(n), day: dayAgo(n), status: 'present', approvalStatus: 'approved',
    workHours: 0, ...stamp(daysAgo(n)), ...fields,
  });
  await db.collection('attendances').insertMany([
    record(mia, 3, { team: ids.alpha, workHours: 8 }),
    record(mia, 2, { team: ids.alpha, status: 'late', workHours: 7.5 }),
    record(mia, 1, { team: ids.alpha, status: 'half-day', workHours: 4 }),
    record(lee, 3, { team: ids.alpha, status: 'leave' }),
    record(lee, 1, { team: ids.alpha, approvalStatus: 'pending', workHours: 8 }),
    record(lee, 0, { team: ids.alpha, approvalStatus: 'pending', checkInTime: new Date() }),
    record(nat, 2, { status: 'absent' }),
    record(nat, 0, { checkInTime: new Date() }),
    record(ola, 20, { team: ids.beta, workHours: 9 }),
  ]);

  // Social Hub posts: one flagged, one waiting for approval, one fine
  const post = (fields) => ({ author: oid(nat._id), content: 'Hello', visibility: 'public', likes: [], comments: [], ...stamp(), ...fields });
  await db.collection('socialpostv2').insertMany([
    post({ moderationStatus: 'flagged', approvalStatus: 'none' }),
    post({ moderationStatus: 'clean', approvalStatus: 'pending' }),
    post({ moderationStatus: 'clean', approvalStatus: 'none' }),
  ]);
});

after(async () => {
  await db?.close();
  await mailDb?.close();
  await server?.stop();
  await mailServer?.stop();
  await smtp?.close();
  fs.rmSync(OUTBOX, { force: true });
  fs.rmSync(MAIL_OUTBOX, { force: true });
});

// A CSV download: { status, type, disposition, csv }
const download = async (urlPath, token) => {
  const res = await fetch(`${server.base}/api/v2${urlPath}`, { headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {} });
  const body = await res.text();
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
    body,
    csv: res.ok ? parseCsv(body) : null,
  };
};

test('only admins reach the admin endpoints', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { user, lee } = people;
  const paths = ['/admin/stats', '/admin/audit', '/admin/audit/actions', `/admin/reports/overview?from=${dayAgo(3)}&to=${TODAY}`,
    '/admin/export/users', '/admin/export/tasks', '/contact/stats'];
  for (const urlPath of paths) {
    await check(`a user gets 403 from ${urlPath}`, (await call('GET', urlPath, { token: user.token })).status === 403);
    await check(`a team leader gets 403 from ${urlPath}`, (await call('GET', urlPath, { token: lee.token })).status === 403);
    await check(`signed out gets 401 from ${urlPath}`, (await call('GET', urlPath)).status === 401);
  }
  const fakeId = new mongoose.Types.ObjectId();
  await check('a user cannot reply to a contact message',
    (await call('POST', `/contact/${fakeId}/reply`, { token: user.token, body: { message: 'hi' } })).status === 403);
  await check('nor can a team leader',
    (await call('POST', `/contact/${fakeId}/reply`, { token: lee.token, body: { message: 'hi' } })).status === 403);
});

test('dashboard figures', async (t) => {
  const check = checker(t);
  const { call } = server.api;

  const res = await call('GET', '/admin/stats', { token: adminToken });
  const stats = res.data?.data;
  await check('admin gets the figures', res.status === 200 && Boolean(stats), JSON.stringify(res.data).slice(0, 300));
  // admin, user, lee, mia, ola, nat, ina; the deleted account is left out
  await check('users: deleted accounts are left out of the total', stats.users.total === 7, JSON.stringify(stats.users));
  await check('users: the deactivated one is not active', stats.users.active === 6);
  await check('users by role', stats.users.byRole.admin === 1 && stats.users.byRole.team_leader === 2 &&
    stats.users.byRole.team_member === 1 && stats.users.byRole.user === 3, JSON.stringify(stats.users.byRole));
  await check('teams and frozen teams', stats.teams.total === 2 && stats.teams.frozen === 1, JSON.stringify(stats.teams));
  const byStatus = stats.tasks.byStatus;
  await check('tasks by status, every status present', byStatus.completed === 1 && byStatus['in-progress'] === 2 &&
    byStatus.pending === 2 && byStatus['completion-requested'] === 1 && byStatus.cancelled === 1, JSON.stringify(byStatus));
  await check('overdue: open tasks whose due day has passed (not cancelled, not due today)', stats.tasks.overdue === 2, String(stats.tasks.overdue));
  await check('awaiting review: once anyone has asked', stats.tasks.awaitingReview === 2, String(stats.tasks.awaitingReview));
  await check('checked in today', stats.attendance.checkedInToday === 2, JSON.stringify(stats.attendance));
  await check('attendance waiting for review', stats.attendance.pendingReviews === 2);
  await check('contact messages by status', ['new', 'in-progress', 'resolved', 'closed'].every((s) => typeof stats.contact.byStatus[s] === 'number'),
    JSON.stringify(stats.contact));
  await check('Social Hub: flagged and waiting for approval', stats.social.flagged === 1 && stats.social.pendingApproval === 1, JSON.stringify(stats.social));
});

test('report per team over a period', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const from = dayAgo(10);

  const res = await call('GET', `/admin/reports/overview?from=${from}&to=${TODAY}`, { token: adminToken });
  const report = res.data?.data;
  await check('admin gets the report', res.status === 200 && report?.from === from && report?.to === TODAY, JSON.stringify(res.data).slice(0, 300));
  const rowOf = (name) => report.rows.find((row) => (name ? row.team?.name === name : row.team === null));
  const alpha = rowOf('Admin Alpha');
  const beta = rowOf('Admin Beta');
  const none = rowOf(null);
  await check('one row per team and one for no team', report.rows.length === 3 && alpha && beta && none, JSON.stringify(report.rows.map((r) => r.team)));
  await check('a frozen team says so', beta.team.isActive === false && alpha.team.isActive === true);
  await check('members: active people in the team now', alpha.members === 2 && beta.members === 1, `${alpha.members} ${beta.members}`);
  await check('no-team members: active accounts outside teams (admins included)', none.members === 3, String(none.members));
  await check('alpha tasks created and completed', alpha.tasks.created === 4 && alpha.tasks.completed === 1, JSON.stringify(alpha.tasks));
  await check('average days from creation to completion', alpha.tasks.avgDaysToComplete === 2, String(alpha.tasks.avgDaysToComplete));
  await check('open and overdue in the period (not due today)', alpha.tasks.openOverdue === 1, String(alpha.tasks.openOverdue));
  await check('an old task outside the period counts nowhere', beta.tasks.created === 0 && beta.tasks.openOverdue === 0, JSON.stringify(beta.tasks));
  await check('no team: created, nothing completed, no average', none.tasks.created === 2 && none.tasks.completed === 0 &&
    none.tasks.avgDaysToComplete === null, JSON.stringify(none.tasks));
  const att = alpha.attendance;
  await check('attendance by day type, approved records only', att.present === 1 && att.late === 1 && att.halfDay === 1 &&
    att.leave === 1 && att.absent === 0, JSON.stringify(att));
  await check('hours of approved records', att.hours === 19.5, String(att.hours));
  await check('no-team attendance', none.attendance.present === 1 && none.attendance.absent === 1, JSON.stringify(none.attendance));
  await check('records outside the period are left out', beta.attendance.present === 0 && beta.attendance.hours === 0);
  const totals = report.totals;
  await check('totals add up the rows', totals.members === 6 && totals.tasks.created === 6 && totals.tasks.completed === 1 &&
    totals.tasks.openOverdue === 1 && totals.tasks.avgDaysToComplete === 2 && totals.attendance.present === 2 &&
    totals.attendance.hours === 19.5, JSON.stringify(totals));

  const onlyAlpha = await call('GET', `/admin/reports/overview?from=${from}&to=${TODAY}&team=${ids.alpha}`, { token: adminToken });
  await check('?team=<id> gives that team only', onlyAlpha.status === 200 && onlyAlpha.data.data.rows.length === 1 &&
    onlyAlpha.data.data.rows[0].team.name === 'Admin Alpha' && onlyAlpha.data.data.totals.tasks.created === 4, JSON.stringify(onlyAlpha.data).slice(0, 300));
  const onlyNone = await call('GET', `/admin/reports/overview?from=${from}&to=${TODAY}&team=none`, { token: adminToken });
  await check('?team=none gives the no-team row only', onlyNone.status === 200 && onlyNone.data.data.rows.length === 1 &&
    onlyNone.data.data.rows[0].team === null && onlyNone.data.data.totals.tasks.created === 2);

  const byDefault = await call('GET', '/admin/reports/overview', { token: adminToken });
  await check('without dates: the 30 days up to today', byDefault.status === 200 && byDefault.data.data.to === TODAY &&
    byDefault.data.data.from === dayAgo(29), JSON.stringify(byDefault.data).slice(0, 200));
  const fullYear = await call('GET', `/admin/reports/overview?from=2025-01-01&to=2025-12-31`, { token: adminToken });
  await check('365 days are allowed', fullYear.status === 200);
  const leapYear = await call('GET', `/admin/reports/overview?from=2024-01-01&to=2024-12-31`, { token: adminToken });
  await check('366 days are allowed', leapYear.status === 200);
  const tooLong = await call('GET', `/admin/reports/overview?from=2024-01-01&to=2025-01-01`, { token: adminToken });
  await check('more than 366 days are refused', tooLong.status === 400 && /366/.test(tooLong.data.message), JSON.stringify(tooLong.data));
  const badDay = await call('GET', `/admin/reports/overview?from=2026-02-31&to=${TODAY}`, { token: adminToken });
  await check('a day that does not exist is refused', badDay.status === 400 && badDay.data.message === 'Invalid from', JSON.stringify(badDay.data));
  const backwards = await call('GET', `/admin/reports/overview?from=${TODAY}&to=${from}`, { token: adminToken });
  await check('a period that ends before it starts is refused', backwards.status === 400);
  await check('a malformed team is a 400', (await call('GET', '/admin/reports/overview?team=nope', { token: adminToken })).status === 400);
  await check('an unknown team is a 404',
    (await call('GET', `/admin/reports/overview?team=${new mongoose.Types.ObjectId()}`, { token: adminToken })).status === 404);
});

test('CSV exports', async (t) => {
  const check = checker(t);

  const users = await download('/admin/export/users', adminToken);
  await check('admin downloads the users', users.status === 200 && users.type.startsWith('text/csv'), `${users.status} ${users.type}`);
  await check('as a file named for today', users.disposition.includes(`attachment; filename="pandav-users-${TODAY}.csv"`), users.disposition);
  await check('with the documented columns', JSON.stringify(users.csv.header) ===
    JSON.stringify(['Name', 'Email', 'Role', 'Department', 'Team', 'Active', 'Created', 'Last login']), JSON.stringify(users.csv.header));
  const row = (email) => users.csv.records.find((r) => r.Email === email);
  await check('every live account, deleted ones left out', users.csv.records.length === 7 && !row('deleted-1@deleted.invalid'),
    users.body.slice(0, 500));
  await check('team names come from the teams', row('lee@admin9.test')?.Team === 'Admin Alpha' && row('ola@admin9.test')?.Team === 'Admin Beta' &&
    row('nat@admin9.test')?.Team === '');
  await check('deactivated accounts say so', row('ina@admin9.test')?.Active === 'No' && row('lee@admin9.test')?.Active === 'Yes');
  await check('created day and last login in the app timezone', row('nat@admin9.test')?.Created === TODAY &&
    row('nat@admin9.test')?.['Last login'] === '2026-10-20 14:35', JSON.stringify(row('nat@admin9.test')));
  await check('a cell that would run as a formula is escaped', row('nat@admin9.test')?.Department === "'=SUM(A1)");

  const tasks = await download('/admin/export/tasks', adminToken);
  await check('admin downloads the tasks', tasks.status === 200 && tasks.disposition.includes(`pandav-tasks-${TODAY}.csv`), tasks.disposition);
  await check('with the documented columns', JSON.stringify(tasks.csv.header) === JSON.stringify(
    ['Title', 'Status', 'Priority', 'Team', 'Assignees', 'Created by', 'Created', 'Start', 'Due', 'Completed', 'Approved by']),
  JSON.stringify(tasks.csv.header));
  await check('every task, newest first', tasks.csv.records.length === 7 && tasks.csv.records[0].Title === 'Alpha, due today' &&
    tasks.csv.records.at(-1).Title === 'Beta, forgotten', tasks.csv.records.map((r) => r.Title).join(' | '));
  const shipped = tasks.csv.records.find((r) => r.Title === 'Alpha, shipped');
  const completedAt = daysAgo(3);
  const expectedTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(completedAt);
  await check('a finished task: team, assignees, who approved and when', shipped?.Team === 'Admin Alpha' &&
    shipped.Assignees === 'Lee Leader; Mia Member' && shipped['Created by'] === 'Admin User' && shipped['Approved by'] === 'Admin User' &&
    shipped.Completed === `${dayAgo(3)} ${expectedTime}` && shipped.Due === dayAgo(2) && shipped.Created === dayAgo(5), JSON.stringify(shipped));
  const late = tasks.csv.records.find((r) => r.Title === 'Alpha, late');
  await check('an open task has no completion', late?.Completed === '' && late['Approved by'] === '');

  const completed = await download('/admin/export/tasks?status=completed', adminToken);
  await check('?status filters', completed.csv?.records.length === 1 && completed.csv.records[0].Title === 'Alpha, shipped');
  const alphaOnly = await download(`/admin/export/tasks?team=${ids.alpha}`, adminToken);
  await check('?team=<id> filters', alphaOnly.csv?.records.length === 4 && alphaOnly.csv.records.every((r) => r.Team === 'Admin Alpha'));
  const noTeam = await download('/admin/export/tasks?team=none', adminToken);
  await check('?team=none gives tasks in no team', noTeam.csv?.records.length === 2 && noTeam.csv.records.every((r) => r.Team === ''));
  const period = await download(`/admin/export/tasks?from=${dayAgo(4)}&to=${dayAgo(2)}`, adminToken);
  await check('?from&to filter by the day each task was created', period.csv?.records.length === 3,
    period.csv?.records.map((r) => r.Title).join(' | '));
  await check('a bad status is a 400', (await download('/admin/export/tasks?status=done', adminToken)).status === 400);
  await check('a bad date is a 400', (await download('/admin/export/tasks?from=yesterday', adminToken)).status === 400);
  await check('an unknown team is a 404', (await download(`/admin/export/tasks?team=${new mongoose.Types.ObjectId()}`, adminToken)).status === 404);

  const exports = await db.collection('auditeventv2').find({ action: 'admin_export' }).sort({ _id: 1 }).toArray();
  await check('each export is in the audit log, saying which', exports.length === 6 && exports[0].details.export === 'users' &&
    exports[0].details.rows === 7 && exports.slice(1).every((e) => e.details.export === 'tasks'), JSON.stringify(exports.map((e) => e.details)));
  await check('with the filters used', exports[2].details.filters.status === 'completed' && exports[3].details.filters.team === String(ids.alpha) &&
    exports[5].details.filters.from === dayAgo(4), JSON.stringify(exports.map((e) => e.details.filters)));
});

test('reading the audit log', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { admin, lee } = people;
  const events = db.collection('auditeventv2');
  // Ids from the driver go up in the order they are made; an event dated in
  // the past gets an id from that time
  const event = (actor, action, fields = {}) => ({
    ...(fields.createdAt ? { _id: idAt(fields.createdAt) } : {}),
    actor: oid(actor), action, targetType: 'Thing', targetId: null, status: 'success',
    ip: null, userAgent: null, details: {}, ...stamp(fields.createdAt), ...fields,
  });
  const missingActor = new mongoose.Types.ObjectId();
  await events.insertMany([
    event(lee._id, 'test_by_leader', { targetType: 'Task', targetId: 'task-42' }),
    event(ids.deleted, 'test_by_deleted'),
    event(missingActor, 'test_by_missing'),
    event(admin._id, 'test_failed', { status: 'failed' }),
    event(admin._id, 'test_old', { createdAt: daysAgo(20) }),
  ]);
  await sleep(1100); // the bulk events must sort after the ones above
  await events.insertMany(Array.from({ length: 210 }, (_, i) => event(admin._id, 'test_bulk', { details: { i } })));

  const first = await call('GET', '/admin/audit', { token: adminToken });
  await check('admin reads the log', first.status === 200 && first.data.count === 50 && first.data.hasMore === true, JSON.stringify(first.data).slice(0, 300));
  const order = first.data.data.map((e) => e._id);
  await check('newest first', order.every((id, i) => i === 0 || id < order[i - 1]) && first.data.data[0].details.i === 209);
  await check('the actor is filled in', first.data.data[0].actor?.name === 'Admin User' && first.data.data[0].actor.email === ADMIN.email &&
    first.data.data[0].actor.role === 'admin', JSON.stringify(first.data.data[0].actor));

  const second = await call('GET', `/admin/audit?action=test_bulk&before=${first.data.data.at(-1)._id}`, { token: adminToken });
  await check('?before= loads the page before', second.data.count === 50 && second.data.data[0].details.i === 159, JSON.stringify(second.data.data[0]?.details));
  const big = await call('GET', '/admin/audit?action=test_bulk&limit=500', { token: adminToken });
  await check('limit is at most 200', big.data.count === 200 && big.data.hasMore === true);
  const small = await call('GET', '/admin/audit?action=test_bulk&limit=5', { token: adminToken });
  await check('a smaller limit', small.data.count === 5);
  const last = await call('GET', `/admin/audit?action=test_bulk&limit=200&before=${big.data.data.at(-1)._id}`, { token: adminToken });
  await check('the last page says there is no more', last.data.count === 10 && last.data.hasMore === false);

  const leader = await call('GET', `/admin/audit?actor=${lee._id}`, { token: adminToken });
  await check('?actor= filters', leader.data.count === 1 && leader.data.data[0].action === 'test_by_leader' &&
    leader.data.data[0].actor.name === 'Lee Leader' && leader.data.data[0].actor.role === 'team_leader');
  const target = await call('GET', '/admin/audit?targetType=Task&targetId=task-42', { token: adminToken });
  await check('?targetType and ?targetId filter', target.data.count === 1 && target.data.data[0].action === 'test_by_leader');
  const failed = await call('GET', '/admin/audit?status=failed', { token: adminToken });
  await check('?status= filters', failed.data.count >= 1 && failed.data.data.every((e) => e.status === 'failed') &&
    failed.data.data.some((e) => e.action === 'test_failed'));
  const deleted = await call('GET', '/admin/audit?action=test_by_deleted', { token: adminToken });
  await check('a deleted account shows its anonymised name', deleted.data.data[0]?.actor?.name === 'Deleted user' &&
    deleted.data.data[0].actor.deleted === true, JSON.stringify(deleted.data.data[0]?.actor));
  const missing = await call('GET', '/admin/audit?action=test_by_missing', { token: adminToken });
  await check('an account with no record left shows as Deleted user too', missing.data.data[0]?.actor?.name === 'Deleted user' &&
    String(missing.data.data[0].actor._id) === String(missingActor));

  const old = dayAgo(20);
  const onTheDay = await call('GET', `/admin/audit?action=test_old&from=${old}&to=${old}`, { token: adminToken });
  await check('?from&to include whole days', onTheDay.data.count === 1, JSON.stringify(onTheDay.data).slice(0, 200));
  const after = await call('GET', `/admin/audit?action=test_old&from=${dayAgo(19)}`, { token: adminToken });
  await check('?from= leaves out earlier days', after.data.count === 0);
  const beforeIt = await call('GET', `/admin/audit?action=test_old&to=${dayAgo(21)}`, { token: adminToken });
  await check('?to= leaves out later days', beforeIt.data.count === 0);

  await check('a malformed actor is a 400', (await call('GET', '/admin/audit?actor=nope', { token: adminToken })).status === 400);
  await check('a malformed cursor is a 400', (await call('GET', '/admin/audit?before=nope', { token: adminToken })).status === 400);
  await check('an unknown status is a 400', (await call('GET', '/admin/audit?status=maybe', { token: adminToken })).status === 400);
  await check('a bad date is a 400', (await call('GET', '/admin/audit?from=2026-13-01', { token: adminToken })).status === 400);

  const actions = await call('GET', '/admin/audit/actions', { token: adminToken });
  const names = actions.data?.data || [];
  await check('the action names, for a filter list', actions.status === 200 && ['test_bulk', 'test_by_leader', 'test_old', 'admin_export']
    .every((name) => names.includes(name)), JSON.stringify(names));
  await check('each once, in order', new Set(names).size === names.length && names.every((name, i) => i === 0 || name > names[i - 1]));
});

test('the contact form', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const contacts = db.collection('contacts');

  const tooLong = await call('POST', '/contact', {
    body: {
      name: 'n'.repeat(101), email: `${'e'.repeat(250)}@x.com`, phone: '1'.repeat(31), subject: 's'.repeat(201), message: 'm'.repeat(5001),
    },
  });
  const problems = tooLong.data?.message || '';
  await check('fields over their limits are refused', tooLong.status === 400, JSON.stringify(tooLong.data).slice(0, 300));
  for (const text of ['Name can be at most 100 characters', 'Email can be at most 254 characters', 'Phone can be at most 30 characters',
    'Subject can be at most 200 characters', 'Message can be at most 5000 characters']) {
    await check(`with a readable message: ${text}`, problems.includes(text), problems);
  }

  const bot = await call('POST', '/contact', {
    body: { name: 'Bot', email: 'bot@spam.test', subject: 'Honeypot subject', message: 'Buy now', website: 'http://spam.test' },
  });
  await check('a filled-in honeypot answers as normal', bot.status === 201 && bot.data.success === true &&
    bot.data.message === 'Your message has been sent successfully' && bot.data.data?.status === 'new', JSON.stringify(bot.data));
  await check('but nothing is stored', (await contacts.countDocuments({ subject: 'Honeypot subject' })) === 0);

  const longest = {
    name: 'V'.repeat(100), email: 'visitor@admin9.test', phone: '+'.padEnd(30, '9'), subject: 'Pricing '.padEnd(200, 'x'),
    message: 'Do you have a team plan? '.padEnd(5000, '.'), website: '',
  };
  const sent = await call('POST', '/contact', { body: longest });
  await check('values at their limits are accepted', sent.status === 201 && sent.data.data._id, JSON.stringify(sent.data).slice(0, 300));
  await check('and stored', (await contacts.countDocuments({ email: 'visitor@admin9.test' })) === 1);
  await sleep(300);

  const inbox = await call('GET', '/notifications', { token: adminToken });
  const notices = (inbox.data?.data || []).filter((n) => n.type === 'contact_message');
  await check('admins are told about the new message', notices.length === 1 && notices[0].link === '/admin/messages' &&
    notices[0].data.contactId === sent.data.data._id && notices[0].actor === null, JSON.stringify(notices));
  await check('the notification is short', notices[0]?.title.length <= 200 && notices[0]?.body.length <= 500 &&
    notices[0]?.title.startsWith(`New message from ${'V'.repeat(100)}`));
  await check('nobody is told about the honeypot one', !(inbox.data?.data || []).some((n) => /Honeypot/.test(n.title)));
  await check('and emailed', outbox(OUTBOX).some((mail) => mail.to === ADMIN.email && mail.subject.startsWith('New message from')),
    JSON.stringify(outbox(OUTBOX)).slice(0, 300));
  await check('only to admins', !(await call('GET', '/notifications', { token: people.lee.token })).data.data.some((n) => n.type === 'contact_message'));
});

test('the contact inbox: search, sort, counts and status', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const contacts = db.collection('contacts');
  const message = (n, fields) => ({
    phone: '', status: 'new', replies: [], message: 'Hello there', ...stamp(daysAgo(n)), ...fields,
  });
  await contacts.insertMany([
    message(9, { name: 'Zed Oldest', email: 'dot.test@admin9.test', subject: 'Invoice question', status: 'closed' }),
    message(8, { name: 'Amy Early', email: 'dotxtest@admin9.test', subject: 'Partnership', status: 'resolved' }),
    message(7, { name: 'Bea Middle', email: 'bea@admin9.test', subject: 'Support', message: 'My PRICING page is broken', status: 'in-progress' }),
  ]);

  const all = await call('GET', '/contact', { token: adminToken });
  await check('every message, newest first by default', all.status === 200 && all.data.count === 4 &&
    all.data.data[0].email === 'visitor@admin9.test' && all.data.data.at(-1).name === 'Zed Oldest', JSON.stringify(all.data).slice(0, 300));
  const oldest = await call('GET', '/contact?sort=oldest', { token: adminToken });
  await check('?sort=oldest', oldest.data.data[0].name === 'Zed Oldest');
  const byName = await call('GET', '/contact?sort=name', { token: adminToken });
  await check('?sort=name', byName.data.data[0].name === 'Amy Early' && byName.data.data[1].name === 'Bea Middle');
  await check('an unknown sort is a 400', (await call('GET', '/contact?sort=random', { token: adminToken })).status === 400);

  const pricing = await call('GET', '/contact?q=pricing', { token: adminToken });
  await check('?q= searches subject and message, any case', pricing.data.count === 2 &&
    pricing.data.data.some((m) => m.name === 'Bea Middle'), JSON.stringify(pricing.data.data.map((m) => m.name)));
  const dotted = await call('GET', '/contact?q=dot.test', { token: adminToken });
  await check('?q= is plain text, not a pattern', dotted.data.count === 1 && dotted.data.data[0].name === 'Zed Oldest',
    JSON.stringify(dotted.data.data.map((m) => m.email)));
  const byNameSearch = await call('GET', '/contact?q=amy', { token: adminToken });
  await check('?q= searches names', byNameSearch.data.count === 1);
  const resolvedOnly = await call('GET', '/contact?status=resolved', { token: adminToken });
  await check('?status= filters', resolvedOnly.data.count === 1 && resolvedOnly.data.data[0].name === 'Amy Early');
  await check('?status=all is every message', (await call('GET', '/contact?status=all', { token: adminToken })).data.count === 4);
  await check('an unknown status is a 400', (await call('GET', '/contact?status=spam', { token: adminToken })).status === 400);
  const paged = await call('GET', '/contact?page=2&limit=3', { token: adminToken });
  await check('paging still works', paged.data.count === 1 && paged.data.pagination.total === 4);

  const stats = await call('GET', '/contact/stats', { token: adminToken });
  await check('counts by status', stats.status === 200 && stats.data.data.total === 4 && stats.data.data.byStatus.new === 1 &&
    stats.data.data.byStatus['in-progress'] === 1 && stats.data.data.byStatus.resolved === 1 && stats.data.data.byStatus.closed === 1,
  JSON.stringify(stats.data));

  // Resolving records who did it; moving away clears it
  const visitor = all.data.data[0];
  const resolved = await call('PUT', `/contact/${visitor._id}`, { token: adminToken, body: { status: 'resolved' } });
  await check('resolving records who and when', resolved.status === 200 && resolved.data.data.resolvedBy?.name === 'Admin User' &&
    resolved.data.data.resolvedAt);
  const reopened = await call('PUT', `/contact/${visitor._id}`, { token: adminToken, body: { status: 'in-progress' } });
  await check('moving it away from resolved clears who resolved it', reopened.status === 200 && reopened.data.data.status === 'in-progress' &&
    !reopened.data.data.resolvedBy && !reopened.data.data.resolvedAt, JSON.stringify(reopened.data.data).slice(0, 300));
  const stored = await contacts.findOne({ _id: oid(visitor._id) });
  await check('in the database too', !stored.resolvedBy && !stored.resolvedAt);
  const same = await call('PUT', `/contact/${visitor._id}`, { token: adminToken, body: { status: 'in-progress' } });
  await check('setting the same status changes nothing', same.status === 200);
  await check('no status is a 400', (await call('PUT', `/contact/${visitor._id}`, { token: adminToken, body: {} })).status === 400);
  const invalid = await call('PUT', `/contact/${visitor._id}`, { token: adminToken, body: { status: 'spam' } });
  await check('an unknown status is refused', invalid.status === 400 && invalid.data.message === 'Invalid status', JSON.stringify(invalid.data));
  await check('an unknown message is a 404',
    (await call('PUT', `/contact/${new mongoose.Types.ObjectId()}`, { token: adminToken, body: { status: 'closed' } })).status === 404);
  const { insertedId: legacyId } = await contacts.insertOne(message(30, {
    name: 'L'.repeat(150), email: 'legacy@admin9.test', subject: 'From before the limits', message: 'x'.repeat(6000),
  }));
  const legacy = await call('PUT', `/contact/${legacyId}`, { token: adminToken, body: { status: 'closed' } });
  await check('a message from before the limits can still be handled', legacy.status === 200 && legacy.data.data.status === 'closed',
    JSON.stringify(legacy.data).slice(0, 200));
  await contacts.deleteOne({ _id: legacyId });
  const changes = await db.collection('auditeventv2').find({ action: 'contact_status_changed', targetId: visitor._id }).sort({ _id: 1 }).toArray();
  await check('each change is in the audit log, once', changes.length === 2 && changes[0].details.from === 'new' &&
    changes[0].details.to === 'resolved' && changes[1].details.to === 'in-progress', JSON.stringify(changes.map((c) => c.details)));

  const noMail = await call('POST', `/contact/${visitor._id}/reply`, { token: adminToken, body: { message: 'Thanks!' } });
  await check("replying without email set up says so", noMail.status === 400 && noMail.data.message === "Email isn't set up on this server",
    JSON.stringify(noMail.data));
  await check('and stores nothing', (await contacts.findOne({ _id: oid(visitor._id) })).replies.length === 0);

  const removed = await call('DELETE', `/contact/${visitor._id}`, { token: adminToken });
  await check('admin deletes a message', removed.status === 200);
  const deletion = await db.collection('auditeventv2').findOne({ action: 'contact_deleted', targetId: visitor._id });
  await check('the deletion is in the audit log, saying what it was', deletion?.details.email === 'visitor@admin9.test' &&
    deletion.details.subject.startsWith('Pricing'), JSON.stringify(deletion?.details).slice(0, 200));
  await check('a deleted message is gone', (await call('GET', `/contact/${visitor._id}`, { token: adminToken })).status === 404);
  await check('a second delete is a 404', (await call('DELETE', `/contact/${visitor._id}`, { token: adminToken })).status === 404);
});

test('replying to a contact message by email', async (t) => {
  const check = checker(t);
  const { call, login } = mailServer.api;
  const token = await login(ADMIN);
  const contacts = mailDb.collection('contacts');
  const { insertedIds } = await contacts.insertMany([
    { name: 'Visitor', email: 'visitor@admin9.test', subject: 'Team plan', message: 'Do you have one?', status: 'new', replies: [], ...stamp() },
    { name: 'Nobody', email: 'bounce@admin9.test', subject: 'Lost', message: 'Hello?', status: 'new', replies: [], ...stamp() },
    { name: 'Done', email: 'done@admin9.test', subject: 'Thanks', message: 'All good', status: 'resolved', replies: [], ...stamp() },
  ]);
  const [visitorId, bounceId, resolvedId] = Object.values(insertedIds).map(String);

  await check('an empty reply is refused', (await call('POST', `/contact/${visitorId}/reply`, { token, body: { message: '   ' } })).status === 400);
  const tooLong = await call('POST', `/contact/${visitorId}/reply`, { token, body: { message: 'x'.repeat(5001) } });
  await check('a reply over 5000 characters is refused', tooLong.status === 400 && /5000/.test(tooLong.data.message), JSON.stringify(tooLong.data));
  await check('an unknown message is a 404',
    (await call('POST', `/contact/${new mongoose.Types.ObjectId()}/reply`, { token, body: { message: 'Hi' } })).status === 404);
  await check('a malformed id is a 400', (await call('POST', '/contact/nope/reply', { token, body: { message: 'Hi' } })).status === 400);

  const reply = await call('POST', `/contact/${visitorId}/reply`, { token, body: { message: 'Yes, we do. See the Pricing page.' } });
  const replied = reply.data?.data;
  await check('admin replies', reply.status === 201 && replied?.replies?.length === 1, JSON.stringify(reply.data).slice(0, 300));
  await check('the reply is kept with who sent it', replied.replies[0].by?.name === 'Admin User' && replied.replies[0].sent === true &&
    replied.replies[0].message === 'Yes, we do. See the Pricing page.' && replied.replies[0].at);
  await check('a new message moves to in progress', replied.status === 'in-progress');
  await sleep(200);
  await check('the email reached the mail server', smtp.received.some((mail) => mail.to.some((to) => to.includes('visitor@admin9.test'))),
    JSON.stringify(smtp.received.map((mail) => mail.to)));
  const mail = outbox(MAIL_OUTBOX).find((m) => m.to === 'visitor@admin9.test');
  await check('answering their subject, quoting their message', mail?.subject === 'Re: Team plan' &&
    mail.text.startsWith('Yes, we do.') && mail.text.includes('Do you have one?'), JSON.stringify(mail));
  const fetched = await call('GET', `/contact/${visitorId}`, { token });
  await check('the message shows its replies', fetched.data.data.replies[0].by?.name === 'Admin User');
  const audit = await mailDb.collection('auditeventv2').findOne({ action: 'contact_replied', targetId: visitorId });
  await check('the reply is in the audit log', audit?.status === 'success' && audit.details.sent === true);

  const bounced = await call('POST', `/contact/${bounceId}/reply`, { token, body: { message: 'Hello!' } });
  await check('a reply that could not be emailed says so', bounced.status === 502 && bounced.data.success === false &&
    /couldn't be sent/.test(bounced.data.message), JSON.stringify(bounced.data).slice(0, 300));
  await check('and is kept as not sent', bounced.data.data?.replies?.[0]?.sent === false);
  const failedAudit = await mailDb.collection('auditeventv2').findOne({ action: 'contact_replied', targetId: bounceId });
  await check('the audit log records the failure', failedAudit?.status === 'failed');

  const later = await call('POST', `/contact/${resolvedId}/reply`, { token, body: { message: 'You are welcome.' } });
  await check('replying to a resolved message keeps it resolved', later.status === 201 && later.data.data.status === 'resolved');
});
