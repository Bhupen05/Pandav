// End-to-end checks for Phase 9 of the chat: { success, data } responses,
// paging that keeps messages from the same millisecond, the conversations
// list, unread counts for the nav and team chat, editing and deleting
// messages, blocks, reporting messages to admins, presence that only shows
// the people a user may message, and typing permissions that expire
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, USER, checker, connectDatabase, connectSocket, sleep, startServer } from './helpers.js';

// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};
const sockets = [];

let server;
let db;
let adminToken;
let admin;
// A second server whose contacts never expire during the tests, so only the
// typing permission's own lifetime can explain a refused typing indicator,
// and whose failed contacts lookups are tried again quickly
let serverB;
let dbB;
before(async () => {
  server = await startServer('chat-phase9', {
    // Contacts expire fast, so the tests can see them looked up again
    CHAT_CONTACTS_TTL_MS: '3000',
  });
  serverB = await startServer('chat-phase9-b', {
    CHAT_TYPING_TTL_MS: '1500',
    CHAT_CONTACTS_RETRY_MS: '500',
  });
  dbB = await connectDatabase('chat-phase9-b');
  db = await connectDatabase('chat-phase9');
  const { register, login, me } = server.api;
  for (const [key, name] of [['amy', 'Amy Sender'], ['ben', 'Ben Receiver'], ['cat', 'Cat Stranger'], ['lea', 'Lea Leader'],
    ['mo', 'Mo Member'], ['nat', 'Nat Member'], ['dan', 'Dan Blocked'], ['eve', 'Eve Gone']]) {
    people[key] = await register(name, `${key}@chat9.test`);
  }
  adminToken = await login(ADMIN);
  admin = await me(adminToken);
  const userToken = await login(USER);
  people.una = { token: userToken, ...(await me(userToken)) };
  await server.api.connect(people.amy, people.ben);
});
after(async () => {
  sockets.forEach(({ socket }) => socket.close());
  await db?.close();
  await dbB?.close();
  await server?.stop();
  await serverB?.stop();
});

const oid = (id) => new mongoose.Types.ObjectId(id);
const HOUR = 60 * 60 * 1000;

// A socket that records every event it receives, by name
const watch = async (token, base = server.base) => {
  const opened = await connectSocket(base, token);
  const events = {};
  opened.socket.onAny((name, payload) => { (events[name] ||= []).push(payload); });
  opened.events = events;
  sockets.push(opened);
  return opened;
};

const audits = (action) => db.collection('auditeventv2').find({ action }).toArray();

test('direct messages: responses, editing and deleting', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { amy, ben, cat } = people;
  const amySocket = await watch(amy.token);
  const benSocket = await watch(ben.token);

  const sent = await call('POST', '/chat/send', { token: amy.token, body: { receiverId: ben._id, message: 'helo' } });
  const message = sent.data?.data;
  await check('sending answers { success, data }', sent.status === 201 && sent.data.success === true && message?.message === 'helo', JSON.stringify(sent.data));
  await check('the sender and receiver carry only their names',
    Object.keys(message.sender).sort().join() === '_id,name' && message.receiver.name === 'Ben Receiver');
  await check('a new message is neither edited nor deleted', message.isEdited === false && message.deletedAt === null);

  const read = await call('PATCH', `/chat/messages/${message._id}/read`, { token: ben.token });
  await check('marking one read answers { success, data }', read.status === 200 && read.data.success === true && read.data.data.isRead === true, JSON.stringify(read.data));

  const list = await call('GET', `/chat/messages/${ben._id}`, { token: amy.token });
  await check('the conversation has a count', list.data.count === list.data.data.length && list.data.count === 1);

  // ---------- Editing ----------
  const edited = await call('PATCH', `/chat/messages/${message._id}`, { token: amy.token, body: { message: '  hello  ' } });
  await check('the sender edits their message', edited.status === 200 && edited.data.data.message === 'hello' && edited.data.data.isEdited === true && edited.data.data.editedAt, JSON.stringify(edited.data));
  await sleep(300);
  await check('both people hear about the edit',
    benSocket.events.message_updated?.[0]?.message === 'hello' && amySocket.events.message_updated?.[0]?._id === message._id,
    JSON.stringify(benSocket.events.message_updated));
  await check('the receiver cannot edit it',
    (await call('PATCH', `/chat/messages/${message._id}`, { token: ben.token, body: { message: 'mine' } })).status === 403);
  await check('nobody else can see it to edit',
    (await call('PATCH', `/chat/messages/${message._id}`, { token: cat.token, body: { message: 'x' } })).status === 404);
  await check('an edit cannot be blank',
    (await call('PATCH', `/chat/messages/${message._id}`, { token: amy.token, body: { message: '   ' } })).status === 400);
  await check('or longer than 2000 characters',
    (await call('PATCH', `/chat/messages/${message._id}`, { token: amy.token, body: { message: 'x'.repeat(2001) } })).status === 400);
  await check('a malformed id is a 400',
    (await call('PATCH', '/chat/messages/nope', { token: amy.token, body: { message: 'x' } })).status === 400);

  const old = await db.collection('chats').insertOne({
    sender: oid(amy._id), receiver: oid(ben._id), message: 'yesterday', timestamp: new Date(Date.now() - 25 * HOUR), isRead: true,
  });
  const late = await call('PATCH', `/chat/messages/${old.insertedId}`, { token: amy.token, body: { message: 'today' } });
  await check('messages older than 24 hours cannot be edited', late.status === 409, JSON.stringify(late.data));

  // ---------- Deleting ----------
  await check('the receiver cannot delete it', (await call('DELETE', `/chat/messages/${message._id}`, { token: ben.token })).status === 403);
  await check('nobody else can see it to delete', (await call('DELETE', `/chat/messages/${message._id}`, { token: cat.token })).status === 404);
  const removed = await call('DELETE', `/chat/messages/${message._id}`, { token: amy.token });
  await check('the sender deletes it, and it stays as deleted',
    removed.status === 200 && removed.data.data.message === '' && removed.data.data.deletedAt, JSON.stringify(removed.data));
  await sleep(300);
  await check('both people hear about the delete',
    benSocket.events.message_deleted?.[0]?._id === message._id && amySocket.events.message_deleted?.length === 1);
  const after = (await call('GET', `/chat/messages/${amy._id}`, { token: ben.token })).data.data;
  const shown = after.find((m) => m._id === message._id);
  await check('the conversation shows it as deleted, without its text', shown && shown.message === '' && shown.deletedAt);
  await check('a deleted message cannot be edited',
    (await call('PATCH', `/chat/messages/${message._id}`, { token: amy.token, body: { message: 'back' } })).status === 409);
  const again = await call('DELETE', `/chat/messages/${message._id}`, { token: amy.token });
  await sleep(200);
  await check('deleting again changes nothing', again.status === 200 && benSocket.events.message_deleted.length === 1);

  // Deleted messages don't count as unread
  await call('POST', '/chat/send', { token: amy.token, body: { receiverId: ben._id, message: 'one' } });
  const retracted = (await call('POST', '/chat/send', { token: amy.token, body: { receiverId: ben._id, message: 'oops' } })).data.data;
  await call('DELETE', `/chat/messages/${retracted._id}`, { token: amy.token });
  const unread = (await call('GET', '/chat/unread', { token: ben.token })).data;
  await check('unread counts leave out deleted messages', unread.data[amy._id] === 1 && unread.total === 1, JSON.stringify(unread));
  await call('PUT', `/chat/read/${amy._id}`, { token: ben.token });

  // Ids are hex, and a request may spell one in capitals
  const shouted = await call('POST', '/chat/send', { token: amy.token, body: { receiverId: ben._id.toUpperCase(), message: 'caps' } });
  await sleep(300);
  await check('an id in capitals still reaches the receiver at once',
    shouted.status === 201 && (benSocket.events.receive_message || []).some((m) => m.message === 'caps'), JSON.stringify(shouted.data));
  const receipts = (amySocket.events.messages_read || []).length;
  await call('PUT', `/chat/read/${amy._id.toUpperCase()}`, { token: ben.token });
  await sleep(300);
  await check('and so does a read receipt',
    amySocket.events.messages_read?.length === receipts + 1 && amySocket.events.messages_read.at(-1).readerId === ben._id);
  const toSelf = await call('POST', '/chat/send', { token: adminToken, body: { receiverId: admin._id.toUpperCase(), message: 'me' } });
  await check('nobody messages themselves, whatever the case of the id', toSelf.status === 400, JSON.stringify(toSelf.data));
});

test('paging keeps messages sent in the same millisecond', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { ben, cat, lea, mo } = people;

  // 52 messages with one timestamp: a date alone can't tell the last two apart
  const at = new Date(Date.now() - HOUR);
  await db.collection('chats').insertMany(Array.from({ length: 52 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(), sender: oid(cat._id), receiver: oid(ben._id), message: `same ${i}`, timestamp: at, isRead: true,
  })));
  const first = (await call('GET', `/chat/messages/${cat._id}`, { token: ben.token })).data;
  await check('the first page has 50 and says there are more', first.count === 50 && first.hasMore === true);
  const oldest = first.data[0];
  const next = (await call('GET', `/chat/messages/${cat._id}?before=${encodeURIComponent(oldest.timestamp)}&beforeId=${oldest._id}`, { token: ben.token })).data;
  await check('before with beforeId returns the two left at the same moment',
    next.count === 2 && next.hasMore === false && next.data[0].message === 'same 0' && next.data[1].message === 'same 1', JSON.stringify(next).slice(0, 300));
  const dateOnly = (await call('GET', `/chat/messages/${cat._id}?before=${encodeURIComponent(oldest.timestamp)}`, { token: ben.token })).data;
  await check('before alone still works as before (strictly older)', dateOnly.count === 0);
  await check('a malformed beforeId is a 400',
    (await call('GET', `/chat/messages/${cat._id}?before=${encodeURIComponent(oldest.timestamp)}&beforeId=nope`, { token: ben.token })).status === 400);
  await check('beforeId needs before',
    (await call('GET', `/chat/messages/${cat._id}?beforeId=${oldest._id}`, { token: ben.token })).status === 400);

  // The same for team chat
  const team = (await call('POST', '/teams', { token: lea.token, body: { name: 'Paging Team' } })).data.data;
  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lea.token, body: { userId: mo._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: mo.token });
  people.team = team;
  await db.collection('teamchatmessages').insertMany(Array.from({ length: 52 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(), team: oid(team._id), sender: oid(mo._id), message: `t${i}`,
    readBy: [{ user: oid(lea._id), readAt: at }], isEdited: false, createdAt: at, updatedAt: at,
  })));
  const teamFirst = (await call('GET', `/chat/teams/${team._id}/messages`, { token: lea.token })).data;
  const teamOldest = teamFirst.data[0];
  const teamNext = (await call('GET', `/chat/teams/${team._id}/messages?before=${encodeURIComponent(teamOldest.createdAt)}&beforeId=${teamOldest._id}`, { token: lea.token })).data;
  await check('team chat pages the same way',
    teamFirst.count === 50 && teamNext.count === 2 && teamNext.data[0].message === 't0' && teamNext.hasMore === false, JSON.stringify(teamNext).slice(0, 200));
});

test('team chat: unread counts, editing, deleting, reporting', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lea, mo, nat, cat } = people;
  const team = people.team;
  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lea.token, body: { userId: nat._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: nat.token });
  const leaSocket = await watch(lea.token);

  // ---------- Unread ----------
  // Lea read the 52 from the paging test; Mo and Nat haven't
  const send = async (who, message) =>
    (await call('POST', `/chat/teams/${team._id}/send`, { token: who.token, body: { message } })).data.data;
  const typo = await send(mo, 'meeting at 3, bring the slids');
  await send(mo, 'and coffee');
  await send(nat, 'ok');
  const leaUnread = (await call('GET', '/chat/unread', { token: lea.token })).data;
  await check("a leader's unread team messages, by team",
    leaUnread.teams?.[team._id] === 3 && leaUnread.teamTotal === 3, JSON.stringify(leaUnread));
  const moUnread = (await call('GET', '/chat/unread', { token: mo.token })).data;
  await check('their own messages never count', moUnread.teams?.[team._id] === 1 && moUnread.teamTotal === 1, JSON.stringify(moUnread));
  await check('direct counts still come in data, with a total', typeof moUnread.data === 'object' && moUnread.total === 0);
  const chats = (await call('GET', '/chat/teams/chats', { token: lea.token })).data.data;
  await check('the team chat list has the unread count', chats.find((c) => c.teamId === team._id)?.unreadCount === 3, JSON.stringify(chats));
  await call('PATCH', `/chat/teams/${team._id}/read`, { token: lea.token });
  await check('reading clears it', (await call('GET', '/chat/unread', { token: lea.token })).data.teams[team._id] === undefined);
  const adminChats = (await call('GET', '/chat/teams/chats', { token: adminToken })).data.data;
  await check('an admin looking in has nothing unread', adminChats.find((c) => c.teamId === team._id)?.unreadCount === 0);
  const adminUnread = (await call('GET', '/chat/unread', { token: adminToken })).data;
  await check('and no team counts', JSON.stringify(adminUnread.teams) === '{}' && adminUnread.teamTotal === 0);

  // ---------- Editing ----------
  const fixed = await call('PATCH', `/chat/teams/${team._id}/messages/${typo._id}`, { token: mo.token, body: { message: 'meeting at 3, bring the slides' } });
  await check('the sender edits a team message',
    fixed.status === 200 && fixed.data.data.message.endsWith('slides') && fixed.data.data.isEdited === true && fixed.data.data.sender.name === 'Mo Member', JSON.stringify(fixed.data));
  await sleep(300);
  await check('the team hears about it', leaSocket.events.team_message_updated?.[0]?._id === typo._id);
  await check('a teammate cannot edit it',
    (await call('PATCH', `/chat/teams/${team._id}/messages/${typo._id}`, { token: nat.token, body: { message: 'x' } })).status === 403);
  await check('nor can a leader',
    (await call('PATCH', `/chat/teams/${team._id}/messages/${typo._id}`, { token: lea.token, body: { message: 'x' } })).status === 403);
  await check('an outsider cannot reach it',
    (await call('PATCH', `/chat/teams/${team._id}/messages/${typo._id}`, { token: cat.token, body: { message: 'x' } })).status === 403);
  await check('a malformed message id is a 400',
    (await call('PATCH', `/chat/teams/${team._id}/messages/nope`, { token: mo.token, body: { message: 'x' } })).status === 400);
  const elsewhere = (await call('POST', '/teams', { token: cat.token, body: { name: 'Other Team' } })).data.data;
  await check("a message is only found in its own team's chat",
    (await call('PATCH', `/chat/teams/${elsewhere._id}/messages/${typo._id}`, { token: cat.token, body: { message: 'x' } })).status === 404);
  const old = await db.collection('teamchatmessages').insertOne({
    team: oid(team._id), sender: oid(mo._id), message: 'old news', readBy: [], isEdited: false,
    createdAt: new Date(Date.now() - 25 * HOUR), updatedAt: new Date(),
  });
  await check('messages older than 24 hours cannot be edited',
    (await call('PATCH', `/chat/teams/${team._id}/messages/${old.insertedId}`, { token: mo.token, body: { message: 'new news' } })).status === 409);
  await check('a team message is at most 2000 characters',
    (await call('PATCH', `/chat/teams/${team._id}/messages/${typo._id}`, { token: mo.token, body: { message: 'x'.repeat(2001) } })).status === 400);

  // ---------- Reporting ----------
  const rude = await send(mo, 'something rude');
  const report = await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: nat.token, body: { reason: 'Not nice' } });
  await check('a teammate reports a message', report.status === 201 && report.data.success === true, JSON.stringify(report.data));
  await check('once', (await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: nat.token, body: {} })).status === 409);
  await check('the sender cannot report their own',
    (await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: mo.token, body: {} })).status === 403);
  await check('an admin outside the team cannot report it',
    (await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: adminToken, body: {} })).status === 403);
  await check('an outsider cannot either',
    (await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: cat.token, body: {} })).status === 403);
  await check('a reason is at most 500 characters',
    (await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: lea.token, body: { reason: 'x'.repeat(501) } })).status === 400);
  const notes = (await call('GET', '/notifications', { token: adminToken })).data.data;
  const note = notes.find((n) => n.type === 'message_reported');
  await check('admins are told', note && note.link === '/admin/moderation?tab=messages' && note.data.kind === 'team' && note.data.messageId === rude._id, JSON.stringify(notes).slice(0, 300));
  await check('the report is audited', (await audits('chat_message_reported')).some((a) => a.targetId === rude._id));
  const history = (await call('GET', `/chat/teams/${team._id}/messages`, { token: mo.token })).data.data;
  const seen = history.find((m) => m._id === rude._id);
  await check('the team never sees who reported what', seen && !('reports' in seen) && !('lastReportedAt' in seen), JSON.stringify(seen));

  // ---------- Deleting ----------
  await check('a teammate cannot delete it', (await call('DELETE', `/chat/teams/${team._id}/messages/${rude._id}`, { token: nat.token })).status === 403);
  const byLeader = await call('DELETE', `/chat/teams/${team._id}/messages/${rude._id}`, { token: lea.token });
  await check('a leader deletes it, and it stays as deleted',
    byLeader.status === 200 && byLeader.data.data.message === '' && byLeader.data.data.deletedAt, JSON.stringify(byLeader.data));
  await sleep(300);
  await check('the team hears about it', leaSocket.events.team_message_deleted?.[0]?._id === rude._id);
  await check("a leader's delete is audited", (await audits('chat_message_deleted')).some((a) => a.targetId === rude._id && a.details.senderId === mo._id));
  await check('a deleted message cannot be reported',
    (await call('POST', `/chat/teams/${team._id}/messages/${rude._id}/report`, { token: lea.token, body: {} })).status === 409);
  const own = await send(nat, 'never mind');
  await check('the sender deletes their own', (await call('DELETE', `/chat/teams/${team._id}/messages/${own._id}`, { token: nat.token })).status === 200);
  await check('an outsider cannot delete', (await call('DELETE', `/chat/teams/${team._id}/messages/${typo._id}`, { token: cat.token })).status === 403);

  // ---------- A frozen team ----------
  const last = await send(nat, 'last one');
  const frozen = await call('PUT', `/teams/${team._id}`, { token: adminToken, body: { isActive: false } });
  await check('an admin freezes the team', frozen.status === 200);
  const isFrozenRefusal = (response) => response.status === 400 && /frozen/.test(response.data?.message);
  await check('no edits in a frozen team',
    isFrozenRefusal(await call('PATCH', `/chat/teams/${team._id}/messages/${last._id}`, { token: nat.token, body: { message: 'edit' } })));
  await check('no deletes by the sender', isFrozenRefusal(await call('DELETE', `/chat/teams/${team._id}/messages/${last._id}`, { token: nat.token })));
  await check('or by a leader', isFrozenRefusal(await call('DELETE', `/chat/teams/${team._id}/messages/${typo._id}`, { token: lea.token })));
  await check('reports still reach the admins',
    (await call('POST', `/chat/teams/${team._id}/messages/${last._id}/report`, { token: lea.token, body: { reason: 'checking' } })).status === 201);
  const byAdmin = await call('DELETE', `/chat/teams/${team._id}/messages/${last._id}`, { token: adminToken });
  await check('an admin can still delete', byAdmin.status === 200 && byAdmin.data.data.deletedAt);
  await call('PUT', `/teams/${team._id}`, { token: adminToken, body: { isActive: true } });
});

test('reporting direct messages, and the admins list', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { amy, ben, cat } = people;

  const bad = (await call('POST', '/chat/send', { token: amy.token, body: { receiverId: ben._id, message: 'a bad message' } })).data.data;
  await check('the sender cannot report it',
    (await call('POST', `/chat/messages/${bad._id}/report`, { token: amy.token, body: {} })).status === 403);
  await check('nobody else can see it',
    (await call('POST', `/chat/messages/${bad._id}/report`, { token: cat.token, body: {} })).status === 404);
  await check('a reason is at most 500 characters',
    (await call('POST', `/chat/messages/${bad._id}/report`, { token: ben.token, body: { reason: 'x'.repeat(501) } })).status === 400);
  const reported = await call('POST', `/chat/messages/${bad._id}/report`, { token: ben.token, body: { reason: 'Spam' } });
  await check('the receiver reports it', reported.status === 201, JSON.stringify(reported.data));
  await check('once', (await call('POST', `/chat/messages/${bad._id}/report`, { token: ben.token, body: {} })).status === 409);
  await call('PATCH', `/chat/messages/${bad._id}`, { token: amy.token, body: { message: 'a nice message' } });

  const gone = (await call('POST', '/chat/send', { token: amy.token, body: { receiverId: ben._id, message: 'gone' } })).data.data;
  await call('DELETE', `/chat/messages/${gone._id}`, { token: amy.token });
  await check('a deleted message cannot be reported',
    (await call('POST', `/chat/messages/${gone._id}/report`, { token: ben.token, body: {} })).status === 409);

  const conversation = (await call('GET', `/chat/messages/${ben._id}`, { token: amy.token })).data.data;
  const mine = conversation.find((m) => m._id === bad._id);
  await check('the sender never sees the report', mine && !('reports' in mine) && !('lastReportedAt' in mine));

  const list = await call('GET', '/chat/reports', { token: adminToken });
  await check('only admins list reports', (await call('GET', '/chat/reports', { token: ben.token })).status === 403);
  const rows = list.data.data || [];
  const direct = rows.find((row) => row._id === bad._id);
  await check('admins see reported direct messages first, newest report first',
    list.status === 200 && list.data.count === rows.length && rows[0]?._id === bad._id, JSON.stringify(rows.map((r) => r._id)));
  await check('with sender, receiver, the text now and the reports',
    direct?.kind === 'direct' && direct.sender.name === 'Amy Sender' && direct.receiver.name === 'Ben Receiver' &&
    direct.text === 'a nice message' && direct.reports[0].by.name === 'Ben Receiver' && direct.reports[0].reason === 'Spam',
    JSON.stringify(direct));
  await check('each report keeps the text as it was reported', direct?.reports[0].text === 'a bad message');
  const team = rows.find((row) => row.kind === 'team' && row.reportCount === 1 && row.reports[0].reason === 'Not nice');
  await check('and reported team messages, with the team', team?.team?.name === 'Paging Team' && team.receiver === null && team.deletedAt, JSON.stringify(team));
  const paged = (await call('GET', '/chat/reports?limit=1', { token: adminToken })).data;
  const rest = (await call('GET', `/chat/reports?limit=10&before=${encodeURIComponent(paged.data[0].lastReportedAt)}&beforeId=${paged.data[0]._id}`, { token: adminToken })).data;
  await check('the list comes in pages', paged.count === 1 && paged.hasMore === true && rest.count === rows.length - 1, `${paged.count} ${rest.count} ${rows.length}`);
  const note = (await call('GET', '/notifications', { token: adminToken })).data.data.find((n) => n.type === 'message_reported' && n.data.kind === 'direct');
  await check('admins are told about direct reports too', note?.data.messageId === bad._id && /Spam/.test(note.body));
});

test('conversations list', async (t) => {
  const check = checker(t);
  const { call, connect } = server.api;
  const { amy, ben, eve } = people;

  await connect(eve, amy);
  await call('POST', '/chat/send', { token: eve.token, body: { receiverId: amy._id, message: 'bye for now' } });
  // An account deleted by anonymising it (see Users.md), with its messages
  // still in place: how the chat shows whatever is left of a deleted account.
  // Deleting an account through the API removes its messages today (see
  // "Deleted accounts and teams" in Chat.md), so this is set up directly.
  await db.collection('users').updateOne({ _id: oid(eve._id) },
    { $set: { name: 'Deleted user', isActive: false, deletedAt: new Date(), email: `deleted-${eve._id}@deleted.invalid` } });
  const long = 'L'.repeat(200);
  await call('POST', '/chat/send', { token: ben.token, body: { receiverId: amy._id, message: long } });
  await call('POST', '/chat/send', { token: adminToken, body: { receiverId: amy._id, message: 'welcome' } });

  const list = await call('GET', '/chat/conversations', { token: amy.token });
  const rows = list.data.data || [];
  await check('one row per person, newest first',
    list.status === 200 && list.data.count === rows.length && rows[0]?.user._id === admin._id && rows[1]?.user._id === ben._id && rows[2]?.user._id === eve._id,
    JSON.stringify(rows.map((r) => r.user.name)));
  const benRow = rows[1];
  await check("with the person's details",
    benRow && benRow.user.name === 'Ben Receiver' && benRow.user.role === 'user' && 'department' in benRow.user && 'profileImage' in benRow.user &&
    benRow.user.isActive === true && benRow.user.deleted === false, JSON.stringify(benRow?.user));
  await check('the latest message, cut to 120 characters',
    benRow?.lastMessage.text.length === 120 && benRow.lastMessage.fromMe === false && benRow.lastMessage.isRead === false && benRow.lastMessage.at, JSON.stringify(benRow?.lastMessage));
  await check('the unread count', benRow?.unreadCount === 1 && rows[0].unreadCount === 1);
  await check('and whether the user may write to them', benRow?.canMessage === true && rows[0].canMessage === true);
  const eveRow = rows[2];
  await check('a deleted account shows as "Deleted user", and cannot be messaged',
    eveRow?.user.name === 'Deleted user' && eveRow.user.deleted === true && eveRow.canMessage === false && eveRow.lastMessage.text === 'bye for now',
    JSON.stringify(eveRow));
  await check('what is left of the conversation can still be read',
    (await call('GET', `/chat/messages/${eve._id}`, { token: amy.token })).data.count === 1);

  const page = (await call('GET', '/chat/conversations?limit=1', { token: amy.token })).data;
  const next = (await call('GET', `/chat/conversations?limit=5&before=${encodeURIComponent(page.data[0].lastMessage.at)}&beforeId=${page.data[0].lastMessage._id}`, { token: amy.token })).data;
  await check('it comes in pages', page.count === 1 && page.hasMore === true && next.data[0]?.user._id === ben._id && next.count === rows.length - 1);
  await check('a malformed cursor is a 400', (await call('GET', '/chat/conversations?before=never', { token: amy.token })).status === 400);
  const benList = (await call('GET', '/chat/conversations', { token: ben.token })).data.data;
  const amyRow = benList.find((row) => row.user._id === amy._id);
  await check("the other side sees it from theirs", amyRow?.lastMessage.fromMe === true && amyRow.unreadCount >= 0);
});

test('blocks', async (t) => {
  const check = checker(t);
  const { call, connect } = server.api;
  const { amy, dan, cat } = people;

  await connect(dan, amy);
  const before = (await call('POST', '/chat/send', { token: amy.token, body: { receiverId: dan._id, message: 'hi Dan' } })).data.data;
  await call('POST', '/social/connections/request', { token: cat.token, body: { userId: amy._id } });
  const between = (a, b) => db.collection('networkconnectionv2').countDocuments({
    $or: [{ requester: oid(a._id), recipient: oid(b._id) }, { requester: oid(b._id), recipient: oid(a._id) }],
  });
  await check('(they are connected, and Cat has asked to connect)', (await between(amy, dan)) === 1 && (await between(amy, cat)) === 1);

  const blocked = await call('POST', '/chat/blocks', { token: amy.token, body: { userId: dan._id } });
  await check('a user blocks someone', blocked.status === 201 && blocked.data.data._id === dan._id && blocked.data.data.name === 'Dan Blocked', JSON.stringify(blocked.data));
  await check('blocking again changes nothing', (await call('POST', '/chat/blocks', { token: amy.token, body: { userId: dan._id } })).status === 200);
  await check('only one block is kept', (await db.collection('blocks').countDocuments({ blocker: oid(amy._id), blocked: oid(dan._id) })) === 1);
  await check('their connection is removed', (await between(amy, dan)) === 0);
  await check('neither can message the other',
    (await call('POST', '/chat/send', { token: dan.token, body: { receiverId: amy._id, message: 'hey' } })).status === 403 &&
    (await call('POST', '/chat/send', { token: amy.token, body: { receiverId: dan._id, message: 'hey' } })).status === 403);
  await check('nor edit what they sent before',
    (await call('PATCH', `/chat/messages/${before._id}`, { token: amy.token, body: { message: 'hi there Dan' } })).status === 403);
  await check('deleting still works', (await call('DELETE', `/chat/messages/${before._id}`, { token: amy.token })).status === 200);
  const conversations = (await call('GET', '/chat/conversations', { token: dan.token })).data.data;
  await check('the conversations list says so', conversations.find((row) => row.user._id === amy._id)?.canMessage === false);
  await check('the block is audited', (await audits('chat_user_blocked')).some((a) => a.targetId === dan._id));

  await call('POST', '/chat/blocks', { token: amy.token, body: { userId: cat._id } });
  await check('a waiting connection request is removed too', (await between(amy, cat)) === 0);

  const list = await call('GET', '/chat/blocks', { token: amy.token });
  await check('the people I blocked, newest first',
    list.status === 200 && list.data.count === 2 && list.data.data[0]._id === cat._id && list.data.data[1]._id === dan._id &&
    Object.keys(list.data.data[0]).sort().join() === '_id,blockedAt,name,profileImage', JSON.stringify(list.data));
  await check("others' blocks are not listed", (await call('GET', '/chat/blocks', { token: dan.token })).data.count === 0);

  await check('nobody blocks themselves', (await call('POST', '/chat/blocks', { token: amy.token, body: { userId: amy._id } })).status === 400);
  const selfInCapitals = await call('POST', '/chat/blocks', { token: amy.token, body: { userId: amy._id.toUpperCase() } });
  await check('not even with their id in capitals',
    selfInCapitals.status === 400 && (await db.collection('blocks').countDocuments({ blocker: oid(amy._id), blocked: oid(amy._id) })) === 0,
    JSON.stringify(selfInCapitals.data));
  await check('admins cannot be blocked', (await call('POST', '/chat/blocks', { token: amy.token, body: { userId: admin._id } })).status === 400);
  await check('a malformed id is a 400', (await call('POST', '/chat/blocks', { token: amy.token, body: { userId: 'nope' } })).status === 400);
  await check('an unknown person is a 404',
    (await call('POST', '/chat/blocks', { token: amy.token, body: { userId: new mongoose.Types.ObjectId().toString() } })).status === 404);
  await check('a deleted account is a 404', (await call('POST', '/chat/blocks', { token: amy.token, body: { userId: people.eve._id } })).status === 404);

  await check('the blocked person cannot lift it', (await call('DELETE', `/chat/blocks/${amy._id}`, { token: dan.token })).status === 404);
  // The id in capitals: the audit log still names Dan by his id
  const lifted = await call('DELETE', `/chat/blocks/${dan._id.toUpperCase()}`, { token: amy.token });
  await check('the blocker unblocks', lifted.status === 200);
  await check('unblocking again is a 404', (await call('DELETE', `/chat/blocks/${dan._id}`, { token: amy.token })).status === 404);
  await check('a malformed id is a 400 there too', (await call('DELETE', '/chat/blocks/nope', { token: amy.token })).status === 400);
  await check('the unblock is audited', (await audits('chat_user_unblocked')).some((a) => a.targetId === dan._id));
  await check('the reply rule applies again', (await call('POST', '/chat/send', { token: dan.token, body: { receiverId: amy._id, message: 'thanks' } })).status === 201);
  await call('DELETE', `/chat/blocks/${cat._id}`, { token: amy.token });

  // A deactivated account keeps its block (it applies again if the account
  // comes back), so it stays on the list where it can be lifted
  const { nat } = people;
  await call('POST', '/chat/blocks', { token: amy.token, body: { userId: nat._id } });
  const deactivated = await call('PUT', `/users/${nat._id}/toggle-active`, { token: adminToken });
  const withInactive = (await call('GET', '/chat/blocks', { token: amy.token })).data;
  await check('a deactivated person stays on the list',
    deactivated.status === 200 && withInactive.data.some((row) => row._id === nat._id && row.name === 'Nat Member'), JSON.stringify(withInactive));
  await check('and can be unblocked from it', (await call('DELETE', `/chat/blocks/${nat._id}`, { token: amy.token })).status === 200);
  await call('PUT', `/users/${nat._id}/toggle-active`, { token: adminToken });
});

test('presence shows only the people a user may message', async (t) => {
  const check = checker(t);
  const { call, connect } = server.api;
  const { amy, ben, cat, una } = people;
  const latest = (watched) => watched.events.update_active_users?.at(-1) || [];

  // Start from nobody online
  sockets.splice(0).forEach(({ socket }) => socket.close());
  await sleep(1200);
  const adminSocket = await watch(adminToken);
  const catSocket = await watch(cat.token);
  const benSocket = await watch(ben.token);
  await sleep(300);
  await check('each socket gets its first list on connecting', Array.isArray(catSocket.events.update_active_users?.[0]));

  const before = (adminSocket.events.update_active_users || []).length;
  const [amySocket, unaSocket] = await Promise.all([watch(amy.token), watch(una.token)]);
  await sleep(1500);
  const updates = adminSocket.events.update_active_users.length - before;
  await check('connections close together go out together', updates >= 1 && updates <= 2, `${updates} updates`);
  await check('an admin sees everyone online',
    [amy._id, ben._id, cat._id, una._id].every((id) => latest(adminSocket).includes(id)) && !latest(adminSocket).includes(admin._id), JSON.stringify(latest(adminSocket)));
  await check('a user sees the people they may message', latest(benSocket).includes(amy._id), JSON.stringify(latest(benSocket)));
  await check('and nobody else', !latest(benSocket).includes(una._id) && !latest(benSocket).includes(admin._id));
  await check('someone with no contacts sees nobody', latest(catSocket).length === 0, JSON.stringify(latest(catSocket)));

  // A new connection shows once the client asks for its contacts again
  await connect(cat, una);
  catSocket.socket.emit('refresh_contacts');
  unaSocket.socket.emit('refresh_contacts');
  await sleep(600);
  await check('refresh_contacts brings in a new connection', latest(catSocket).includes(una._id), JSON.stringify(latest(catSocket)));
  // Messages both ways, so each may still write to the other (a reply) once
  // the block below has removed their connection and been lifted
  await call('POST', '/chat/send', { token: cat.token, body: { receiverId: una._id, message: 'hi Una' } });
  await call('POST', '/chat/send', { token: una.token, body: { receiverId: cat._id, message: 'hi Cat' } });

  // A block takes effect at once, for both people
  const unaBefore = latest(unaSocket);
  await call('POST', '/chat/blocks', { token: una.token, body: { userId: cat._id } });
  await sleep(600);
  await check('a block hides each from the other at once',
    !latest(catSocket).includes(una._id) && unaBefore.includes(cat._id) && !latest(unaSocket).includes(cat._id), JSON.stringify([latest(catSocket), unaBefore, latest(unaSocket)]));
  // Well within the 3 s after which contacts are looked up anyway
  await call('DELETE', `/chat/blocks/${cat._id.toUpperCase()}`, { token: una.token });
  await sleep(600);
  await check('unblocking shows each to the other again at once, whatever the case of the id',
    latest(catSocket).includes(una._id) && latest(unaSocket).includes(cat._id), JSON.stringify([latest(catSocket), latest(unaSocket)]));

  // Contacts are looked up again on their own once they are old (3 s in these tests)
  await connect(ben, cat);
  await sleep(7000);
  await check('stale contacts are refreshed without asking', latest(catSocket).includes(ben._id), JSON.stringify(latest(catSocket)));

  // Presence across tabs
  const amySecondTab = await watch(amy.token);
  amySocket.socket.close();
  await sleep(1500);
  await check('closing one tab keeps the user online while another is open', latest(benSocket).includes(amy._id), JSON.stringify(latest(benSocket)));

  const amySees = latest(amySecondTab);
  benSocket.socket.close();
  await sleep(1500);
  await check('someone leaving is seen by their contacts', amySees.includes(ben._id) && !latest(amySecondTab).includes(ben._id),
    JSON.stringify([amySees, latest(amySecondTab)]));
  await check('the server keeps running', (await fetch(`${server.base}/api/v2/health`)).status === 200);
});

// ---------- The second server: contacts last 5 minutes, typing permissions 1.5 s ----------

const peopleB = {};

test('a socket whose first contacts lookup fails gets its list once a retry works', async (t) => {
  const check = checker(t);
  const { login, me } = serverB.api;
  const token = await login(USER);
  const una = await me(token);

  // A team document the app can't read makes every lookup of Una's contacts throw
  const unreadable = await dbB.collection('teams').insertOne({
    name: 'Unreadable', leaders: 'not-an-id', members: [oid(una._id)], isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const socket = await watch(token, serverB.base);
  await sleep(1500);
  await check('(no list while the lookup fails)', socket.ok && !socket.events.update_active_users, JSON.stringify(socket.events));

  await dbB.collection('teams').deleteOne({ _id: unreadable.insertedId });
  await sleep(1500);
  await check('the lookup is tried again, and the socket gets its first list', Array.isArray(socket.events.update_active_users?.[0]),
    JSON.stringify(socket.events));
  socket.socket.close();
});

test('typing permissions expire on their own', async (t) => {
  const check = checker(t);
  const { call, connect, login, register } = serverB.api;
  const adminTokenB = await login(ADMIN);
  for (const [key, name] of [['pia', 'Pia Typist'], ['quinn', 'Quinn Reader'], ['leo', 'Leo Leader'], ['max', 'Max Member']]) {
    peopleB[key] = await register(name, `${key}@chat9b.test`);
  }
  const { pia, quinn, leo, max } = peopleB;
  const typingFrom = (watched, who) => (watched.events.user_typing || []).filter((e) => e.userId === who._id).length;

  // ---------- A block ----------
  await connect(pia, quinn);
  const piaSocket = await watch(pia.token, serverB.base);
  const quinnSocket = await watch(quinn.token, serverB.base);
  await sleep(300);
  piaSocket.socket.emit('typing', { recipientId: quinn._id });
  await sleep(300);
  await check('typing reaches a contact', typingFrom(quinnSocket, pia) === 1, JSON.stringify(quinnSocket.events));

  // Made behind the app's back, so nothing looks up contacts again: only the
  // typing permission running out can stop the indicator
  await dbB.collection('blocks').insertOne({ blocker: oid(quinn._id), blocked: oid(pia._id), createdAt: new Date(), updatedAt: new Date() });
  piaSocket.socket.emit('typing', { recipientId: quinn._id });
  await sleep(300);
  await check('(the permission is remembered for a while)', typingFrom(quinnSocket, pia) === 2, `${typingFrom(quinnSocket, pia)} typing events`);
  await sleep(1500);
  piaSocket.socket.emit('typing', { recipientId: quinn._id });
  await sleep(300);
  await check('once it runs out, a new block stops typing', typingFrom(quinnSocket, pia) === 2, `${typingFrom(quinnSocket, pia)} typing events`);
  await dbB.collection('blocks').deleteOne({ blocker: oid(quinn._id), blocked: oid(pia._id) });
  // A refused recipient is checked again on the next event
  piaSocket.socket.emit('typing', { recipientId: quinn._id.toUpperCase() });
  await sleep(300);
  await check('typing works again once the block is gone, whatever the case of the id', typingFrom(quinnSocket, pia) === 3,
    `${typingFrom(quinnSocket, pia)} typing events`);

  // ---------- A frozen team ----------
  const team = (await call('POST', '/teams', { token: leo.token, body: { name: 'Typing Team' } })).data.data;
  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: leo.token, body: { userId: max._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: max.token });
  peopleB.team = team;
  const leoSocket = await watch(leo.token, serverB.base);
  const maxSocket = await watch(max.token, serverB.base);
  await sleep(300);
  leoSocket.socket.emit('typing', { recipientId: max._id });
  await sleep(300);
  await check('typing reaches a teammate', typingFrom(maxSocket, leo) === 1, JSON.stringify(maxSocket.events));
  const frozen = await call('PUT', `/teams/${team._id}`, { token: adminTokenB, body: { isActive: false } });
  await sleep(1800);
  leoSocket.socket.emit('typing', { recipientId: max._id });
  await sleep(300);
  await check('once the permission runs out, a frozen team stops typing', frozen.status === 200 && typingFrom(maxSocket, leo) === 1,
    `${typingFrom(maxSocket, leo)} typing events`);
  await call('PUT', `/teams/${team._id}`, { token: adminTokenB, body: { isActive: true } });
});

test('an edit racing a delete never brings the text back', async (t) => {
  const check = checker(t);
  const { call } = serverB.api;
  const { pia, quinn, leo, max, team } = peopleB;
  const deletedWithText = (stored) => stored.filter((m) => m.deletedAt && m.message !== '');

  // Team messages: the sender edits each one as a leader deletes it
  const teamMessages = [];
  for (let i = 0; i < 8; i++) {
    teamMessages.push((await call('POST', `/chat/teams/${team._id}/send`, { token: max.token, body: { message: `team ${i}` } })).data.data);
  }
  const teamOutcomes = await Promise.all(teamMessages.map((m) => Promise.all([
    call('PATCH', `/chat/teams/${team._id}/messages/${m._id}`, { token: max.token, body: { message: `team ${m._id} edited` } }),
    call('DELETE', `/chat/teams/${team._id}/messages/${m._id}`, { token: leo.token }),
  ])));
  const teamStored = await dbB.collection('teamchatmessages').find({ _id: { $in: teamMessages.map((m) => oid(m._id)) } }).toArray();
  await check('every team message ends up deleted, without its text',
    teamStored.length === 8 && teamStored.every((m) => m.deletedAt) && deletedWithText(teamStored).length === 0,
    JSON.stringify(deletedWithText(teamStored)));
  await check('each edit either landed first or was refused',
    teamOutcomes.every(([edit, remove]) => [200, 409].includes(edit.status) && remove.status === 200),
    JSON.stringify(teamOutcomes.map(([edit, remove]) => [edit.status, remove.status])));

  // Direct messages: the sender edits and deletes each one from two tabs
  const direct = [];
  for (let i = 0; i < 5; i++) {
    direct.push((await call('POST', '/chat/send', { token: pia.token, body: { receiverId: quinn._id, message: `direct ${i}` } })).data.data);
  }
  await Promise.all(direct.map((m) => Promise.all([
    call('PATCH', `/chat/messages/${m._id}`, { token: pia.token, body: { message: `direct ${m._id} edited` } }),
    call('DELETE', `/chat/messages/${m._id}`, { token: pia.token }),
  ])));
  const directStored = await dbB.collection('chats').find({ _id: { $in: direct.map((m) => oid(m._id)) } }).toArray();
  await check('every direct message ends up deleted, without its text',
    directStored.length === 5 && directStored.every((m) => m.deletedAt) && deletedWithText(directStored).length === 0,
    JSON.stringify(deletedWithText(directStored)));
});
