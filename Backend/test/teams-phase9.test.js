// End-to-end checks for Phase 9 of teams: inviting by id, email or an
// unambiguous name, the people search for leaders, a team's sent invites and
// withdrawing them, the hourly invite limit, accepting without races, leaving
// a team (frozen or not), the notifications and audit entries membership
// changes leave, deactivated and deleted people in team responses, length
// limits, and the admin team list's search, filter and counts
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, startServer } from './helpers.js';

// Sign-ups are limited to 10 an hour per address: the people who have to
// sign in register (9 of them); the rest are written straight to the database
const people = {};
const teams = {};

let server;
let db;
let adminToken;
let admin;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const DATES = { startDate: '2026-10-01', dueDate: '2026-10-20' };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Someone who never signs in in these tests
const addPerson = async (name, email, extra = {}) => {
  const now = new Date();
  const { insertedId } = await db.collection('users').insertOne({
    name, email, password: 'not-a-real-hash', role: 'user', teamId: null, isActive: true, deletedAt: null,
    emailVerified: true, emailNotifications: true, createdAt: now, updatedAt: now, ...extra,
  });
  return { _id: String(insertedId), name, email };
};

before(async () => {
  server = await startServer('teams-phase9');
  db = await connectDatabase('teams-phase9');
  const { login, me, register } = server.api;
  adminToken = await login(ADMIN);
  admin = await me(adminToken);

  for (const [key, name] of [['lena', 'Lena Lead'], ['lexi', 'Lexi Lead'], ['lars', 'Lars Lead'], ['dan', 'Dan Decliner'],
    ['ari', 'Ari Accepter'], ['rex', 'Rex Racer'], ['cy', 'Cy Creator'], ['fay', 'Fay Frozen'], ['mo', 'Mo Member']]) {
    people[key] = await register(name, `${key}@p9t.test`);
  }

  people.samOne = await addPerson('Sam Same', 'sam.one@p9t.test', { department: 'Sales' });
  people.samTwo = await addPerson('Sam Same', 'sam.two@p9t.test');
  people.uma = await addPerson('Uma Unique', 'uma@p9t.test');
  // A deactivated namesake doesn't make Uma's name ambiguous
  people.umaOld = await addPerson('Uma Unique', 'uma.old@p9t.test', { isActive: false });
  people.dee = await addPerson('Dee Deactivated', 'dee@p9t.test', { isActive: false });
  // Marked deleted but (wrongly) still active: deletedAt alone must hide it
  people.del = await addPerson('Del Deleted', 'del@p9t.test', { deletedAt: new Date() });
  people.leo = await addPerson('Leo Second', 'leo@p9t.test');
  people.lou = await addPerson('Lou Later', 'lou@p9t.test');
  people.lia = await addPerson('Lia Leader', 'lia@p9t.test');
  people.lim = await addPerson('Lim Leader', 'lim@p9t.test');
  people.eli = await addPerson('Eli Echo', 'eli@p9t.test', { department: 'Ops' });
  people.ema = await addPerson('Ema Echo', 'ema@p9t.test');
  people.edd = await addPerson('Edd Echo', 'edd@p9t.test');
  people.max = await addPerson('Max Long', 'max@p9t.test');
  for (let i = 1; i <= 12; i += 1) {
    await addPerson(`Zed Crowd ${String(i).padStart(2, '0')}`, `zed${i}@p9t.test`);
  }
});
after(async () => {
  await db?.close();
  await server?.stop();
});

const notificationsFor = (person, type) =>
  db.collection('notifications').find({ user: oid(person._id), type }).toArray();
const auditsFor = (action, filter = {}) =>
  db.collection('auditeventv2').find({ action, ...filter }).toArray();
const userNow = (person) => db.collection('users').findOne({ _id: oid(person._id) });
const inviteNow = (id) => db.collection('teaminvites').findOne({ _id: oid(id) });

test('inviting by id, email or name', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, lexi, samOne, samTwo, uma, dee, del } = people;

  teams.alpha = (await call('POST', '/teams', { token: lena.token, body: { name: 'P9 Alpha' } })).data.data;
  teams.beta = (await call('POST', '/teams', { token: lexi.token, body: { name: 'P9 Beta' } })).data.data;
  await check('setup: two teams', !!teams.alpha?._id && !!teams.beta?._id);
  const invite = (body, token = lena.token) => call('POST', `/teams/${teams.alpha._id}/invite`, { token, body });

  const ambiguous = await invite({ username: 'sam same' });
  await check('a name two people share is refused', ambiguous.status === 409 &&
    ambiguous.data.message === 'More than one person is called sam same. Invite them by email.', JSON.stringify(ambiguous.data));

  const byEmail = await invite({ email: '  SAM.ONE@P9T.TEST ' });
  await check('an exact email in any case finds the person', byEmail.status === 201 && byEmail.data.data.invitedUser?._id === samOne._id,
    JSON.stringify(byEmail.data).slice(0, 200));
  await check('whoever typed the email sees it', byEmail.data.data.invitedUser?.email === 'sam.one@p9t.test');

  const byName = await invite({ username: 'uma unique' });
  await check("a name only one active person has works (a deactivated namesake doesn't count)",
    byName.status === 201 && byName.data.data.invitedUser?._id === uma._id, JSON.stringify(byName.data).slice(0, 200));
  await check('but a leader inviting by name does not see the email', byName.data.data.invitedUser && byName.data.data.invitedUser.email === undefined);

  for (const [how, body] of [['email', { email: dee.email }], ['id', { userId: dee._id }], ['name', { username: dee.name }]]) {
    const refused = await invite(body);
    await check(`a deactivated account looks missing (by ${how})`, refused.status === 404, `${refused.status} ${refused.data?.message}`);
  }
  const deleted = await invite({ userId: del._id });
  await check('a deleted account looks missing', deleted.status === 404 && deleted.data.message === 'User not found', JSON.stringify(deleted.data));
  await check('and so does its email', (await invite({ email: del.email })).status === 404);
  await check('nothing to go on is a 400', (await invite({})).status === 400);
  await check('a malformed id is a 400', (await invite({ userId: 'nope' })).status === 400);
  await check('a second pending invite is refused', (await invite({ userId: uma._id })).status === 400);

  // A block either way round stops a leader's invites, not an admin's
  await db.collection('blocks').insertOne({ blocker: oid(samTwo._id), blocked: oid(lena._id), createdAt: new Date(), updatedAt: new Date() });
  const blocked = await invite({ userId: samTwo._id });
  await check('someone who blocked the leader cannot be invited by them', blocked.status === 403, JSON.stringify(blocked.data));
  const byAdmin = await invite({ userId: samTwo._id }, adminToken);
  await check('an admin can invite them, and sees the email',
    byAdmin.status === 201 && byAdmin.data.data.invitedUser?.email === 'sam.two@p9t.test', JSON.stringify(byAdmin.data).slice(0, 200));
});

test('people search for leaders', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, lexi, dan, samOne, samTwo, dee } = people;
  const search = (token, q, teamId = teams.alpha._id) =>
    call('GET', `/teams/${teamId}/invite-candidates${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`, { token });

  const sams = await search(lena.token, 'sam');
  const ids = (sams.data?.data || []).map((p) => p._id);
  await check('a leader finds people by part of their name', sams.status === 200 && ids.includes(samOne._id), JSON.stringify(sams.data).slice(0, 300));
  await check('without anyone who blocked them', !ids.includes(samTwo._id));
  await check('and without emails', sams.data.data.every((p) => p.email === undefined));
  await check('with name, department and photo only (and whether they are already invited)',
    sams.data.data.every((p) => Object.keys(p).every((key) => ['_id', 'name', 'department', 'profileImage', 'invitePending'].includes(key))),
    JSON.stringify(sams.data.data[0]));
  const samEntry = sams.data.data.find((p) => p._id === samOne._id);
  await check('someone with an open invite from the team is marked', samEntry?.invitePending === true && samEntry.department === 'Sales');

  const exact = await search(lena.token, 'Sam.One@P9T.test');
  await check('an exact email finds the person and shows the email they typed',
    exact.data.count === 1 && exact.data.data[0]._id === samOne._id && exact.data.data[0].email === 'sam.one@p9t.test', JSON.stringify(exact.data));

  await check('people in a team are left out', (await search(lena.token, 'Lexi')).data.count === 0);
  await check('so are deactivated people', (await search(lena.token, dee.name)).data.count === 0);
  await check('and deleted ones', (await search(lena.token, 'Del Deleted')).data.count === 0);
  const adminHit = (await search(lena.token, 'Admin User')).data.data;
  await check('and admins', !adminHit.some((p) => p._id === admin._id));
  await check('at most 10 come back', (await search(lena.token, 'Zed Crowd')).data.count === 10);

  const asAdmin = await search(adminToken, 'sam');
  const adminIds = asAdmin.data.data.map((p) => p._id);
  await check('an admin sees everyone matching, with emails',
    asAdmin.status === 200 && adminIds.includes(samTwo._id) && asAdmin.data.data.every((p) => p.email), JSON.stringify(asAdmin.data).slice(0, 300));

  await check('one letter is not enough', (await search(lena.token, 's')).status === 400);
  await check('nor is no search at all', (await search(lena.token)).status === 400);
  await check('a user who leads no team cannot search', (await search(dan.token, 'sam')).status === 403);
  await check("another team's leader cannot search for this team", (await search(lexi.token, 'sam')).status === 403);
});

test("a team's sent invites, and withdrawing them", async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, lexi, dan, ari, uma, samOne } = people;
  const alphaId = teams.alpha._id;
  const invite = (body) => call('POST', `/teams/${alphaId}/invite`, { token: lena.token, body });

  const danInvite = (await invite({ email: dan.email })).data.data;
  const declined = await call('PUT', `/teams/invites/${danInvite._id}/decline`, { token: dan.token });
  await check('the invitee declines', declined.status === 200);
  const declinedNote = (await notificationsFor(lena, 'team_invite_declined'))[0];
  await check("the team's leader hears about it", declinedNote?.title === 'Dan Decliner declined the invite to P9 Alpha' && declinedNote.link === '/teams',
    JSON.stringify(declinedNote));

  const ariInvite = (await invite({ userId: ari._id })).data.data;
  const accepted = await call('PUT', `/teams/invites/${ariInvite._id}/accept`, { token: ari.token });
  await check('another accepts', accepted.status === 200, JSON.stringify(accepted.data));
  const joinedNote = (await notificationsFor(lena, 'team_invite_accepted'))[0];
  await check('and the leader hears that too', joinedNote?.title === 'Ari Accepter joined P9 Alpha' && joinedNote.link === '/teams');

  // Withdrawing
  const umaInvite = await db.collection('teaminvites').findOne({ team: oid(alphaId), invitedUser: oid(uma._id), status: 'pending' });
  const withdrawn = await call('DELETE', `/teams/${alphaId}/invites/${umaInvite._id}`, { token: lena.token });
  await check('the leader withdraws a pending invite', withdrawn.status === 200 && withdrawn.data.data.state === 'withdrawn' &&
    (await inviteNow(umaInvite._id)).status === 'withdrawn', JSON.stringify(withdrawn.data).slice(0, 200));
  const again = await call('DELETE', `/teams/${alphaId}/invites/${umaInvite._id}`, { token: lena.token });
  await check('withdrawing it again is a conflict', again.status === 409 && again.data.message === 'This invite was already withdrawn', JSON.stringify(again.data));
  await check('as is withdrawing an accepted one',
    (await call('DELETE', `/teams/${alphaId}/invites/${ariInvite._id}`, { token: lena.token })).status === 409);
  await check('audit: team_invite_withdrawn', (await auditsFor('team_invite_withdrawn', { targetId: String(umaInvite._id) })).length === 1);

  const secondDan = (await invite({ userId: dan._id })).data.data;
  await check('a declined invite does not stop a new one', !!secondDan?._id);
  await call('DELETE', `/teams/${alphaId}/invites/${secondDan._id}`, { token: lena.token });
  const lateAccept = await call('PUT', `/teams/invites/${secondDan._id}/accept`, { token: dan.token });
  await check('a withdrawn invite cannot be accepted', lateAccept.status === 400 && lateAccept.data.message === 'Invite is already withdrawn',
    JSON.stringify(lateAccept.data));
  await check('nor is it in the invitee\'s list',
    !(await call('GET', '/teams/invites/my', { token: dan.token })).data.data.some((i) => i._id === secondDan._id));

  // Expired, and older than 30 days
  const samInvite = await db.collection('teaminvites').findOne({ team: oid(alphaId), invitedUser: oid(samOne._id) });
  await db.collection('teaminvites').updateOne({ _id: samInvite._id }, { $set: { expiresAt: new Date(Date.now() - DAY) } });
  const old = new Date(Date.now() - 40 * DAY);
  const { insertedIds } = await db.collection('teaminvites').insertMany([
    { team: oid(alphaId), invitedUser: oid(uma._id), invitedBy: oid(lena._id), status: 'declined', expiresAt: new Date(old.getTime() + 7 * DAY), respondedAt: old, createdAt: old, updatedAt: old },
    { team: oid(alphaId), invitedUser: oid(uma._id), invitedBy: oid(lena._id), status: 'pending', expiresAt: new Date(Date.now() - 35 * DAY), createdAt: old, updatedAt: old },
  ]);
  const withdrawExpired = await call('DELETE', `/teams/${alphaId}/invites/${samInvite._id}`, { token: lena.token });
  await check('an expired invite cannot be withdrawn', withdrawExpired.status === 409 && withdrawExpired.data.message === 'This invite has already expired');

  const sent = await call('GET', `/teams/${alphaId}/invites`, { token: lena.token });
  const stateOf = (id) => sent.data?.data?.find((i) => i._id === String(id))?.state;
  await check('the leader lists the invites the team sent', sent.status === 200 && sent.data.count === sent.data.data.length, JSON.stringify(sent.data).slice(0, 200));
  await check('each with its state', stateOf(danInvite._id) === 'declined' && stateOf(umaInvite._id) === 'withdrawn' &&
    stateOf(samInvite._id) === 'expired' && stateOf(secondDan._id) === 'withdrawn',
  JSON.stringify(sent.data.data.map((i) => [i.invitedUser?.name, i.state])));
  await check('accepted invites are not listed', stateOf(ariInvite._id) === undefined);
  await check('nor ones closed more than 30 days ago', !stateOf(insertedIds[0]) && !stateOf(insertedIds[1]));
  await check("with the invitee's name and not their email", sent.data.data.every((i) => i.invitedUser?.name && i.invitedUser.email === undefined));
  const pendingCount = sent.data.data.filter((i) => i.state === 'pending').length;

  const asAdmin = await call('GET', `/teams/${alphaId}/invites`, { token: adminToken });
  await check('an admin lists them with emails', asAdmin.status === 200 && asAdmin.data.data.every((i) => i.invitedUser?.email));
  await check('a member cannot list them', (await call('GET', `/teams/${alphaId}/invites`, { token: ari.token })).status === 403);
  await check("nor can another team's leader", (await call('GET', `/teams/${alphaId}/invites`, { token: lexi.token })).status === 403);

  const betaInvite = (await call('POST', `/teams/${teams.beta._id}/invite`, { token: lexi.token, body: { userId: uma._id } })).data.data;
  await check("another team's invite is not found under this team",
    (await call('DELETE', `/teams/${alphaId}/invites/${betaInvite._id}`, { token: lena.token })).status === 404);
  await check('a member cannot withdraw invites',
    (await call('DELETE', `/teams/${teams.beta._id}/invites/${betaInvite._id}`, { token: ari.token })).status === 403);
  await check("another team's leader cannot either",
    (await call('DELETE', `/teams/${teams.beta._id}/invites/${betaInvite._id}`, { token: lena.token })).status === 403);

  const mine = (await call('GET', '/teams/my', { token: lena.token })).data.data;
  await check("a leader's team says how many invites are open", mine.counts?.openInvites === pendingCount && pendingCount > 0,
    JSON.stringify(mine.counts));
  const member = (await call('GET', '/teams/my', { token: ari.token })).data.data;
  await check('a member sees head counts but not the invites', member.counts?.members >= 1 && member.counts.openInvites === undefined,
    JSON.stringify(member.counts));
});

test('accepting at the same moment', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, lexi, rex, cy } = people;

  // A few rounds, so the two requests really do overlap in some of them
  const rounds = [];
  for (let round = 0; round < 4; round += 1) {
    const fromAlpha = (await call('POST', `/teams/${teams.alpha._id}/invite`, { token: lena.token, body: { userId: rex._id } })).data.data;
    const fromBeta = (await call('POST', `/teams/${teams.beta._id}/invite`, { token: lexi.token, body: { userId: rex._id } })).data.data;
    const results = await Promise.all([fromAlpha, fromBeta].map((invite) =>
      call('PUT', `/teams/invites/${invite._id}/accept`, { token: rex.token })));

    const winner = results[0].status === 200 ? fromAlpha : fromBeta;
    const loser = winner === fromAlpha ? fromBeta : fromAlpha;
    const rexNow = await userNow(rex);
    const inAlpha = (await db.collection('teams').countDocuments({ _id: oid(teams.alpha._id), members: oid(rex._id) })) === 1;
    const inBeta = (await db.collection('teams').countDocuments({ _id: oid(teams.beta._id), members: oid(rex._id) })) === 1;
    rounds.push({
      statuses: results.map((r) => r.status).sort().join(','),
      oneTeam: inAlpha !== inBeta && String(rexNow.teamId) === String(winner.team._id) && rexNow.role === 'team_member',
      invites: `${(await inviteNow(winner._id)).status},${(await inviteNow(loser._id)).status}`,
      refusal: results.find((r) => r.status !== 200)?.data?.message,
    });
    // Back out for the next round; the last round's team is kept
    await call('DELETE', `/teams/${loser.team._id}/invites/${loser._id}`, { token: adminToken });
    if (round < 3) await call('POST', `/teams/${winner.team._id}/leave`, { token: rex.token });
  }
  await check('two invites accepted at once: one goes through', rounds.every((r) => r.statuses === '200,400'), JSON.stringify(rounds));
  await check('he is in exactly one team', rounds.every((r) => r.oneTeam), JSON.stringify(rounds));
  await check('the other invite is still pending', rounds.every((r) => r.invites === 'accepted,pending'), JSON.stringify(rounds));
  await check('and the refusal says why', rounds.every((r) => /already belong to a team/.test(r.refusal)), JSON.stringify(rounds));

  // Creating a team and accepting an invite at the same moment
  const cyInvite = (await call('POST', `/teams/${teams.alpha._id}/invite`, { token: lena.token, body: { userId: cy._id } })).data.data;
  const [accept, create] = await Promise.all([
    call('PUT', `/teams/invites/${cyInvite._id}/accept`, { token: cy.token }),
    call('POST', '/teams', { token: cy.token, body: { name: 'P9 Cy' } }),
  ]);
  await check('only one of accepting and creating goes through', (accept.status === 200) !== (create.status === 201),
    `${accept.status} ${create.status} ${JSON.stringify([accept.data, create.data]).slice(0, 300)}`);
  const cyNow = await userNow(cy);
  const cyTeams = await db.collection('teams').find({ $or: [{ leaders: oid(cy._id) }, { members: oid(cy._id) }] }).toArray();
  await check('so Cy is in one team, with the matching role', cyTeams.length === 1 && String(cyNow.teamId) === String(cyTeams[0]._id) &&
    cyNow.role === (accept.status === 200 ? 'team_member' : 'team_leader'), `${cyTeams.length} ${cyNow.role}`);
  await check('and the invite says what happened', (await inviteNow(cyInvite._id)).status === (accept.status === 200 ? 'accepted' : 'pending'));
});

test('leaving a team', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lena, lexi, ari, dan, fay, leo, lou } = people;
  const alphaId = teams.alpha._id;

  const finished = (await call('POST', `/teams/${alphaId}/tasks`, { token: lena.token, body: { title: 'Done work', description: 'd', ...DATES, assignedTo: [ari._id] } })).data.data;
  await call('POST', `/tasks/${finished._id}/request-completion`, { token: ari.token });
  await call('PUT', `/teams/${alphaId}/tasks/${finished._id}/approve`, { token: lena.token });
  const open = (await call('POST', `/teams/${alphaId}/tasks`, { token: lena.token, body: { title: 'Open work', description: 'd', ...DATES, assignedTo: [ari._id] } })).data.data;
  await check('setup: two team tasks', !!finished?._id && !!open?._id);

  const left = await call('POST', `/teams/${alphaId}/leave`, { token: ari.token });
  await check('a member leaves', left.status === 200 && left.data.message === 'You have left P9 Alpha.', JSON.stringify(left.data));
  const ariNow = await userNow(ari);
  await check('and is a plain user in no team', ariNow.role === 'user' && ariNow.teamId === null, `${ariNow.role} ${ariNow.teamId}`);
  const alphaNow = await db.collection('teams').findOne({ _id: oid(alphaId) });
  await check('the team no longer lists them', !alphaNow.members.map(String).includes(ari._id));
  const tasks = db.collection('tasks');
  await check('their open team task no longer waits on them',
    !(await tasks.findOne({ _id: oid(open._id) })).assignedTo.map(String).includes(ari._id));
  await check('their finished one still credits them',
    (await tasks.findOne({ _id: oid(finished._id) })).assignedTo.map(String).includes(ari._id));
  const leftNote = (await notificationsFor(lena, 'team_member_left'))[0];
  await check("the team's leaders are told", leftNote?.title === 'Ari Accepter left P9 Alpha' && leftNote.link === '/teams', JSON.stringify(leftNote));
  await check('audit: team_member_left', (await auditsFor('team_member_left', { actor: oid(ari._id), targetId: alphaId })).length === 1);
  await check('leaving twice is a 404', (await call('POST', `/teams/${alphaId}/leave`, { token: ari.token })).status === 404);
  await check('so is leaving a team you are not in', (await call('POST', `/teams/${alphaId}/leave`, { token: dan.token })).status === 404);
  await check('and they can start again elsewhere',
    (await call('POST', '/teams', { token: ari.token, body: { name: 'P9 Ari' } })).status === 201);

  const alone = await call('POST', `/teams/${alphaId}/leave`, { token: lena.token });
  await check("the team's only leader cannot leave", alone.status === 409 && /only leader/.test(alone.data.message), JSON.stringify(alone.data));
  await call('POST', `/teams/${alphaId}/leaders`, { token: adminToken, body: { userId: leo._id } });
  const handedOver = await call('POST', `/teams/${alphaId}/leave`, { token: lena.token });
  await check('with a second leader, a leader can', handedOver.status === 200, JSON.stringify(handedOver.data));
  const lenaNow = await userNow(lena);
  const leadersNow = (await db.collection('teams').findOne({ _id: oid(alphaId) })).leaders.map(String);
  await check('the team keeps its other leader', leadersNow.length === 1 && leadersNow[0] === leo._id && lenaNow.role === 'user' && !lenaNow.teamId);
  await check('who is told', (await notificationsFor(leo, 'team_member_left')).some((n) => n.title === 'Lena Lead left P9 Alpha'));
  await check('audit says a leader left', (await auditsFor('team_member_left', { actor: oid(lena._id) }))[0]?.details?.wasLeader === true);

  // A deactivated second leader can't keep the team going
  await call('POST', `/teams/${teams.beta._id}/leaders`, { token: adminToken, body: { userId: lou._id } });
  await db.collection('users').updateOne({ _id: oid(lou._id) }, { $set: { isActive: false } });
  await check('a leader whose only fellow leader is deactivated cannot leave',
    (await call('POST', `/teams/${teams.beta._id}/leave`, { token: lexi.token })).status === 409);

  // Frozen: members can still move on
  const fayInvite = (await call('POST', `/teams/${teams.beta._id}/invite`, { token: lexi.token, body: { userId: fay._id } })).data.data;
  await call('PUT', `/teams/invites/${fayInvite._id}/accept`, { token: fay.token });
  await call('PUT', `/teams/${teams.beta._id}`, { token: adminToken, body: { isActive: false } });
  const frozenLeave = await call('POST', `/teams/${teams.beta._id}/leave`, { token: fay.token });
  await check('a member of a frozen team can leave', frozenLeave.status === 200 && (await userNow(fay)).teamId === null, JSON.stringify(frozenLeave.data));
  await check('and its leader is told', (await notificationsFor(lexi, 'team_member_left')).some((n) => n.title === 'Fay Frozen left P9 Beta'));
});

test('invites per hour', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lim, uma } = people;
  const team = (await call('POST', '/teams', { token: adminToken, body: { name: 'P9 Limit', leaderId: lim._id } })).data.data;

  const recently = new Date(Date.now() - 10 * 60 * 1000);
  await db.collection('teaminvites').insertMany(Array.from({ length: 30 }, () => ({
    team: oid(team._id), invitedUser: new mongoose.Types.ObjectId(), invitedBy: oid(admin._id), status: 'pending',
    expiresAt: new Date(Date.now() + 7 * DAY), createdAt: recently, updatedAt: recently,
  })));
  const limited = await call('POST', `/teams/${team._id}/invite`, { token: adminToken, body: { userId: uma._id } });
  const retryAfter = Number(limited.headers.get('retry-after'));
  await check('the 31st invite in an hour is refused', limited.status === 429 &&
    limited.data.message === 'This team has sent 30 invites in the last hour. Please try again later.', JSON.stringify(limited.data));
  await check('and says when to try again', retryAfter > 0 && retryAfter <= 3600, String(retryAfter));

  await db.collection('teaminvites').updateMany({ team: oid(team._id) }, { $set: { createdAt: new Date(Date.now() - 2 * HOUR) } });
  await check('an hour later it works again',
    (await call('POST', `/teams/${team._id}/invite`, { token: adminToken, body: { userId: uma._id } })).status === 201);
});

test('freezing, deleting and leader changes tell people', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lars, mo, lia, uma } = people;

  const created = await call('POST', '/teams', { token: adminToken, body: { name: 'P9 Delta', leaderId: lars._id } });
  const delta = created.data.data;
  await check('an admin creates a team for someone', created.status === 201);
  await check('who is told they lead it', (await notificationsFor(lars, 'team_leader_added'))[0]?.title === 'Admin User made you the leader of P9 Delta');
  await check('audit: team_created', (await auditsFor('team_created', { targetId: delta._id })).length === 1);
  const moInvite = (await call('POST', `/teams/${delta._id}/invite`, { token: lars.token, body: { userId: mo._id } })).data.data;
  await call('PUT', `/teams/invites/${moInvite._id}/accept`, { token: mo.token });
  const pending = (await call('POST', `/teams/${delta._id}/invite`, { token: lars.token, body: { userId: uma._id } })).data.data;

  const freeze = () => call('PUT', `/teams/${delta._id}`, { token: adminToken, body: { isActive: false } });
  await check('admin freezes the team', (await freeze()).status === 200);
  const [leaderFrozen] = await notificationsFor(lars, 'team_frozen');
  const [memberFrozen] = await notificationsFor(mo, 'team_frozen');
  await check('its leader is told, with a link to the team page', leaderFrozen?.title === 'P9 Delta has been frozen' && leaderFrozen.link === '/teams');
  await check('and so are its members, with theirs', memberFrozen?.link === '/team-member', JSON.stringify(memberFrozen));
  await check('audit: team_frozen', (await auditsFor('team_frozen', { targetId: delta._id })).length === 1);
  await freeze();
  await check('freezing a frozen team tells nobody again', (await notificationsFor(lars, 'team_frozen')).length === 1 &&
    (await auditsFor('team_frozen', { targetId: delta._id })).length === 1);

  const frozenSearch = await call('GET', `/teams/${delta._id}/invite-candidates?q=uma`, { token: lars.token });
  await check("a frozen team's leader cannot search for people", frozenSearch.status === 400 && /frozen/.test(frozenSearch.data.message));
  await check('but can still see the invites sent', (await call('GET', `/teams/${delta._id}/invites`, { token: lars.token })).status === 200);
  await check('and cannot withdraw them',
    (await call('DELETE', `/teams/${delta._id}/invites/${pending._id}`, { token: lars.token })).status === 400);
  await check('an admin can',
    (await call('DELETE', `/teams/${delta._id}/invites/${pending._id}`, { token: adminToken })).status === 200);

  await call('PUT', `/teams/${delta._id}`, { token: adminToken, body: { isActive: true } });
  await check('unfreezing tells the leader and the member',
    (await notificationsFor(lars, 'team_unfrozen')).length === 1 && (await notificationsFor(mo, 'team_unfrozen'))[0]?.link === '/team-member');
  await check('audit: team_unfrozen', (await auditsFor('team_unfrozen', { targetId: delta._id })).length === 1);

  await call('PUT', `/teams/${delta._id}`, { token: lars.token, body: { name: 'P9 Delta Force' } });
  await check('audit: team_updated, with the old and new name',
    (await auditsFor('team_updated', { targetId: delta._id }))[0]?.details?.to === 'P9 Delta Force');

  const added = await call('POST', `/teams/${delta._id}/leaders`, { token: adminToken, body: { userId: lia._id } });
  await check('admin adds a leader', added.status === 200 && added.data.data.leaders.some((l) => l._id === lia._id));
  await check('who is told', (await notificationsFor(lia, 'team_leader_added'))[0]?.title === 'Admin User made you a leader of P9 Delta Force');
  await check('audit: team_leader_added', (await auditsFor('team_leader_added', { targetId: delta._id }))[0]?.details?.userId === lia._id);

  await call('DELETE', `/teams/${delta._id}/members/${lia._id}`, { token: adminToken });
  await check('audit: team_leader_removed', (await auditsFor('team_leader_removed', { targetId: delta._id }))[0]?.details?.userId === lia._id);
  await check('the removed leader is told', (await notificationsFor(lia, 'team_removed')).length === 1);

  const removed = await call('DELETE', `/teams/${delta._id}/members/${mo._id}`, { token: lars.token });
  const [removedNote] = await notificationsFor(mo, 'team_removed');
  await check('the leader removes a member, who is told', removed.status === 200 &&
    removedNote?.title === 'You were removed from P9 Delta Force' && removedNote.link === '/teams', JSON.stringify(removedNote));
  await check('audit: team_member_removed', (await auditsFor('team_member_removed', { targetId: delta._id }))[0]?.details?.userId === mo._id);

  await call('DELETE', `/teams/${delta._id}`, { token: adminToken });
  const [deletedNote] = await notificationsFor(lars, 'team_deleted');
  await check('deleting the team tells its people', deletedNote?.title === 'P9 Delta Force was deleted' && deletedNote.link === '/teams');
  await check('audit: team_deleted', (await auditsFor('team_deleted', { targetId: delta._id }))[0]?.details?.name === 'P9 Delta Force');
});

test('who a team shows', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { eli, ema, edd, dee, del } = people;

  const echo = (await call('POST', '/teams', { token: adminToken, body: { name: 'P9 Echo', leaderId: eli._id } })).data.data;
  await call('POST', `/teams/${echo._id}/leaders`, { token: adminToken, body: { userId: ema._id } });
  await call('POST', `/teams/${echo._id}/leaders`, { token: adminToken, body: { userId: edd._id } });
  await db.collection('users').updateOne({ _id: oid(ema._id) }, { $set: { isActive: false } });
  // Deleted but somehow still listed by the team
  await db.collection('users').updateOne({ _id: oid(edd._id) }, { $set: { isActive: false, deletedAt: new Date(), name: 'Deleted user' } });

  const team = (await call('GET', `/teams/${echo._id}`, { token: adminToken })).data.data;
  const shown = Object.fromEntries(team.leaders.map((l) => [l._id, l]));
  await check('each person says whether they are active', shown[eli._id]?.isActive === true && shown[ema._id]?.isActive === false,
    JSON.stringify(team.leaders));
  await check('with their department', shown[eli._id]?.department === 'Ops');
  await check('deleted accounts are left out', !shown[edd._id] && team.counts.leaders === 2, JSON.stringify(team.counts));

  const deactivated = await call('POST', `/teams/${echo._id}/leaders`, { token: adminToken, body: { userId: dee._id } });
  await check('a deactivated person cannot be made a leader', deactivated.status === 400 && deactivated.data.message === 'This account is deactivated');
  await check('a deleted one is not found',
    (await call('POST', `/teams/${echo._id}/leaders`, { token: adminToken, body: { userId: del._id } })).status === 404);
  await check('nor can an admin make one lead a new team',
    (await call('POST', '/teams', { token: adminToken, body: { name: 'P9 Ghost', leaderId: del._id } })).status === 404);
});

test('limits and the admin list', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { max, lexi, rex } = people;

  const noLeader = await call('POST', '/teams', { token: adminToken, body: { name: 'P9 Nobody' } });
  await check('an admin has to name the leader', noLeader.status === 400 && noLeader.data.message === 'leaderId is required');

  const longName = await call('POST', '/teams', { token: adminToken, body: { name: 'N'.repeat(81), leaderId: max._id } });
  await check('a name over 80 characters is refused', longName.status === 400 && longName.data.message === 'A team name can be at most 80 characters',
    JSON.stringify(longName.data));
  const longText = await call('POST', '/teams', { token: adminToken, body: { name: 'P9 Wordy', description: 'd'.repeat(501), leaderId: max._id } });
  await check('a description over 500 is refused', longText.status === 400 && longText.data.message === 'A team description can be at most 500 characters');
  await check('nothing was half made', (await userNow(max)).role === 'user');
  const fits = await call('POST', '/teams', { token: adminToken, body: { name: `P9 ${'n'.repeat(77)}`, description: 'd'.repeat(500), leaderId: max._id } });
  await check('80 and 500 fit', fits.status === 201, JSON.stringify(fits.data).slice(0, 200));
  await check('renaming is held to the same limit',
    (await call('PUT', `/teams/${fits.data.data._id}`, { token: adminToken, body: { name: 'N'.repeat(81) } })).status === 400);

  const alpha = await call('GET', '/teams?q=p9 alp', { token: adminToken });
  await check('admins search teams by name', alpha.status === 200 && alpha.data.count === 1 && alpha.data.data[0].name === 'P9 Alpha',
    JSON.stringify(alpha.data).slice(0, 200));
  const counts = alpha.data.data[0].counts;
  await check('with head counts and open invites',
    counts && counts.leaders === 1 && counts.members === alpha.data.data[0].members.length && typeof counts.openInvites === 'number', JSON.stringify(counts));

  const frozen = (await call('GET', '/teams?frozen=true', { token: adminToken })).data;
  await check('and filter frozen teams', frozen.count >= 1 && frozen.data.every((team) => team.isActive === false) &&
    frozen.data.some((team) => team.name === 'P9 Beta'));
  const active = (await call('GET', '/teams?frozen=false', { token: adminToken })).data;
  await check('or active ones', active.count >= 1 && active.data.every((team) => team.isActive === true));
  await check('frozen must be true or false', (await call('GET', '/teams?frozen=maybe', { token: adminToken })).status === 400);
  await check('only admins list teams', (await call('GET', '/teams', { token: lexi.token })).status === 403);

  const lexiTeam = (await call('GET', '/teams/my', { token: lexi.token })).data.data;
  await check('a frozen team still shows its leader the open invites', typeof lexiTeam.counts?.openInvites === 'number');
  const rexTeam = (await call('GET', `/teams/${(await userNow(rex)).teamId}`, { token: rex.token })).data.data;
  await check('a member opening their team sees no invite count', rexTeam.counts && rexTeam.counts.openInvites === undefined);
});
