// End-to-end checks for the Social Hub: who may publish to LinkedIn/GitHub and
// to which targets, publish jobs that run once, stored provider tokens
// encrypted at rest, input checks, and cleanup when a user is deleted. A fake
// provider server stands in for the GitHub and LinkedIn APIs.
import http from 'node:http';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, runScript, startServer } from './helpers.js';

// ---------- Fake GitHub/LinkedIn API ----------
const providerCalls = [];
const provider = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    providerCalls.push({ method: req.method, path: req.url, auth, body });
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (auth === 'Bearer bad-token') return reply(401, { message: 'Bad credentials' });
    if (req.method === 'GET' && req.url === '/user') return reply(200, { id: 7, login: 'octo', name: 'Octo' });
    if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/issues$/.test(req.url)) {
      return reply(201, { id: providerCalls.length, html_url: `https://github.example/issues/${providerCalls.length}` });
    }
    if (req.method === 'GET' && req.url === '/userinfo') return reply(200, { sub: 'li-1', name: 'Li' });
    if (req.method === 'POST' && req.url === '/ugcPosts') return reply(201, { id: 'urn:li:share:1' });
    return reply(404, { message: 'Not found' });
  });
});
const issueCalls = () => providerCalls.filter((c) => c.method === 'POST' && c.path.endsWith('/issues'));

let server;
before(async () => {
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  server = await startServer('social', { GITHUB_API_BASE: providerUrl, LINKEDIN_API_BASE: providerUrl });
});
after(async () => {
  await server?.stop();
  await new Promise((resolve) => provider.close(resolve));
});

test('social hub', async (t) => {
  const check = checker(t);
  const { call, login, me, register } = server.api;
  const db = await connectDatabase('social');
  // Closed even when a check throws, or the process would never exit
  t.after(() => db.close());
  const integrations = db.collection('socialintegrationv2');

  // ---------- Setup: Lee leads Alpha (Mia is a member), Kim leads Beta, Oscar has no team ----------
  const adminToken = await login(ADMIN);
  const lee = await register('Lee Leader', 'lee@social.test');
  const mia = await register('Mia Member', 'mia@social.test');
  const kim = await register('Kim Other', 'kim@social.test');
  const oscar = await register('Oscar Outsider', 'oscar@social.test');
  const alpha = (await call('POST', '/teams', { token: adminToken, body: { name: 'Alpha', leaderId: lee._id } })).data.data;
  await call('POST', '/teams', { token: adminToken, body: { name: 'Beta', leaderId: kim._id } });
  const invite = (await call('POST', `/teams/${alpha._id}/invite`, { token: lee.token, body: { userId: mia._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: mia.token });
  await check('setup: Mia is in Lee\'s team', (await me(mia.token)).role === 'team_member');

  // ---------- Linked accounts: tokens are encrypted at rest ----------
  const badLink = await call('POST', '/social/integrations/github/link', { token: mia.token, body: { accessToken: 'bad-token' } });
  await check('a token the provider refuses is a 400 with its reason', badLink.status === 400 && badLink.data.message === 'Bad credentials', JSON.stringify(badLink.data));
  const link = await call('POST', '/social/integrations/github/link', { token: mia.token, body: { accessToken: 'mia-secret-token' } });
  await check('Mia links GitHub', link.status === 200 && !('accessToken' in link.data.data), JSON.stringify(link.data).slice(0, 200));
  const stored = await integrations.findOne({ provider: 'github' });
  await check('the token is stored encrypted', stored?.accessToken?.startsWith('enc:v1:') && !stored.accessToken.includes('mia-secret-token'), stored?.accessToken);

  // ---------- Publishing can't skip approval ----------
  const pandavOnly = (await call('POST', '/social/posts', { token: mia.token, body: { content: 'Pandav only', targets: { pandav: true } } })).data.data;
  await check('a Pandav-only post needs no approval', pandavOnly.approvalStatus === 'none');
  const sneaky = await call('POST', `/social/posts/${pandavOnly._id}/publish`, { token: mia.token, body: { targets: { linkedin: true } } });
  await check('it cannot then be published to LinkedIn', sneaky.status === 400, JSON.stringify(sneaky.data));
  const sneakyJobs = await call('POST', `/social/posts/${pandavOnly._id}/publish/jobs`, { token: mia.token, body: { targets: { github: true }, githubRepo: 'acme/site' } });
  await check('or queued for GitHub', sneakyJobs.status === 400, JSON.stringify(sneakyJobs.data));
  await check('nothing reached the providers', !providerCalls.some((c) => c.method === 'POST'));

  const shipIt = (await call('POST', '/social/posts', { token: mia.token, body: { content: 'Ship it', targets: { pandav: true, github: true } } })).data.data;
  await check('a member\'s GitHub post waits for approval', shipIt.approvalStatus === 'pending');
  await check('a leader of another team cannot approve it',
    (await call('PATCH', `/social/posts/${shipIt._id}/approve`, { token: kim.token, body: { action: 'approved' } })).status === 403);
  await check('her own leader approves it',
    (await call('PATCH', `/social/posts/${shipIt._id}/approve`, { token: lee.token, body: { action: 'approved' } })).status === 200);

  // ---------- Only the author, an admin, or the author's leader publishes ----------
  await check('a leader of another team cannot publish it',
    (await call('POST', `/social/posts/${shipIt._id}/publish`, { token: kim.token, body: { targets: { github: true }, githubRepo: 'acme/site' } })).status === 403);
  await check('or queue jobs for it',
    (await call('POST', `/social/posts/${shipIt._id}/publish/jobs`, { token: kim.token, body: { githubRepo: 'acme/site' } })).status === 403);
  for (const repo of ['../../user/repos', 'acme/../../user', 'acme/.', 'acme/site/issues']) {
    const traversal = await call('POST', `/social/posts/${shipIt._id}/publish`, { token: lee.token, body: { targets: { github: true }, githubRepo: repo } });
    await check(`githubRepo "${repo}" is refused`, traversal.status === 400, `status ${traversal.status}`);
  }
  await check('so no other GitHub endpoint was called', providerCalls.every((c) => c.method !== 'POST'));

  const published = await call('POST', `/social/posts/${shipIt._id}/publish`, { token: lee.token, body: { targets: { github: true }, githubRepo: 'acme/.github' } });
  await check('her leader publishes it', published.status === 200 && published.data.result.github.status === 'published', JSON.stringify(published.data).slice(0, 240));
  const lastIssue = issueCalls().at(-1);
  await check('to the requested repository', lastIssue?.path === '/repos/acme/.github/issues', lastIssue?.path);
  await check('with Mia\'s decrypted token', lastIssue?.auth === 'Bearer mia-secret-token', lastIssue?.auth);

  // ---------- Publish jobs run once ----------
  const jobs = await call('POST', `/social/posts/${shipIt._id}/publish/jobs`, { token: mia.token, body: { githubRepo: 'acme/site' } });
  const job = jobs.data.data?.[0];
  await check('Mia queues a GitHub job', jobs.status === 201 && job?.status === 'queued', JSON.stringify(jobs.data).slice(0, 200));
  await check('a leader of another team cannot run it',
    (await call('POST', `/social/publish-jobs/${job._id}/process`, { token: kim.token })).status === 403);
  await check('or retry it', (await call('POST', `/social/publish-jobs/${job._id}/retry`, { token: kim.token })).status === 403);
  const issuesBefore = issueCalls().length;
  const ran = await call('POST', `/social/publish-jobs/${job._id}/process`, { token: mia.token });
  await check('Mia runs it', ran.status === 200 && ran.data.data.status === 'completed', JSON.stringify(ran.data).slice(0, 200));
  await call('POST', `/social/publish-jobs/${job._id}/process`, { token: mia.token });
  const retried = await call('POST', `/social/publish-jobs/${job._id}/retry`, { token: mia.token });
  await check('a completed job cannot be retried', retried.status === 409, `status ${retried.status}`);
  await call('POST', `/social/publish-jobs/${job._id}/process`, { token: mia.token });
  await check('it was published exactly once', issueCalls().length === issuesBefore + 1, `${issueCalls().length - issuesBefore} calls`);

  // Two requests at the same moment still publish once
  await call('POST', '/social/integrations/github/link', { token: lee.token, body: { accessToken: 'lee-token' } });
  const leePost = (await call('POST', '/social/posts', { token: lee.token, body: { content: 'Leader news', targets: { github: true } } })).data.data;
  const leeJob = (await call('POST', `/social/posts/${leePost._id}/publish/jobs`, { token: lee.token, body: { githubRepo: 'acme/site' } })).data.data[0];
  const raceBefore = issueCalls().length;
  const race = await Promise.all([1, 2, 3].map(() => call('POST', `/social/publish-jobs/${leeJob._id}/process`, { token: lee.token })));
  await check('concurrent runs publish the job once', issueCalls().length === raceBefore + 1, `${issueCalls().length - raceBefore} calls; statuses ${race.map((r) => r.status)}`);

  // ---------- Hidden posts stay inside Pandav ----------
  await call('PATCH', `/social/moderation/posts/${shipIt._id}`, { token: adminToken, body: { action: 'hide' } });
  await check('a hidden post cannot be published',
    (await call('POST', `/social/posts/${shipIt._id}/publish`, { token: mia.token, body: { targets: { github: true }, githubRepo: 'acme/site' } })).status === 409);

  // ---------- Input checks ----------
  const badPost = (body) => call('POST', '/social/posts', { token: mia.token, body: { content: 'x', ...body } });
  await check('javascript: media links are refused', (await badPost({ mediaUrls: ['javascript:alert(1)'] })).status === 400);
  await check('an unknown visibility is a 400', (await badPost({ visibility: 'everyone' })).status === 400);
  await check('non-text content is a 400', (await badPost({ content: 5 })).status === 400);
  await check('too many tags are refused', (await badPost({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status === 400);

  const oscarTask = (await call('POST', '/social/personal-tasks', { token: oscar.token, body: { title: 'Private plans', description: 'secret details' } })).data.data;
  const borrowed = await badPost({ sourceTask: oscarTask._id });
  await check('a post cannot show someone else\'s personal task', borrowed.status === 400, JSON.stringify(borrowed.data));
  const miaTask = (await call('POST', '/social/personal-tasks', { token: mia.token, body: { title: 'Wrote docs', description: 'internal notes' } })).data.data;
  await call('POST', '/social/posts', { token: mia.token, body: { content: 'Done', sourceTask: miaTask._id } });
  const feedTask = (await call('GET', '/social/feed', { token: oscar.token })).data.data.find((p) => p.sourceTask)?.sourceTask;
  await check('the feed shows only the task\'s title and status', feedTask?.title === 'Wrote docs' && !('description' in feedTask), JSON.stringify(feedTask));
  await check('a schema-refused value is a 400, not a 500',
    (await call('POST', '/social/personal-tasks', { token: mia.token, body: { title: 'x', priority: 'bogus' } })).status === 400);

  const pattern = await call('GET', `/social/users/discover?q=${encodeURIComponent('.*')}`, { token: mia.token });
  await check('user discovery treats the search as text, not a pattern', pattern.status === 200 && pattern.data.count === 0, JSON.stringify(pattern.data).slice(0, 160));
  await check('and still finds people by name',
    (await call('GET', '/social/users/discover?q=Oscar', { token: mia.token })).data.data.some((u) => u._id === oscar._id));

  // ---------- Network messages ----------
  await check('a malformed receiver is a 400',
    (await call('POST', '/social/messages', { token: kim.token, body: { receiverId: 'nope', message: 'hi' } })).status === 400);
  await check('messages have a length limit',
    (await call('POST', '/social/messages', { token: kim.token, body: { receiverId: oscar._id, message: 'x'.repeat(2001) } })).status === 400);
  await check('a team leader needs a connection to message an outsider, like everyone else',
    (await call('POST', '/social/messages', { token: kim.token, body: { receiverId: oscar._id, message: 'hello' } })).status === 403);
  const kimAsks = (await call('POST', '/social/connections/request', { token: kim.token, body: { userId: oscar._id } })).data.data;
  await call('PATCH', `/social/connections/${kimAsks._id}/respond`, { token: oscar.token, body: { action: 'accepted' } });
  const dm = await call('POST', '/social/messages', { token: kim.token, body: { receiverId: oscar._id, message: 'hello' } });
  const senderKeys = Object.keys(dm.data.data?.sender || {}).sort().join(',');
  await check('message payloads expose only participant names', dm.status === 201 && senderKeys === '_id,name', senderKeys);

  // ---------- OAuth state ----------
  const forged = await call('POST', '/social/integrations/github/oauth/callback', { token: mia.token, body: { code: 'c', state: 'not-a-state' } });
  await check('a forged OAuth state is a 400', forged.status === 400, `status ${forged.status}`);
  const sessionAsState = await call('POST', '/social/integrations/github/oauth/callback', { token: mia.token, body: { code: 'c', state: mia.token } });
  await check('a session token is not an OAuth state', sessionAsState.status === 400, `status ${sessionAsState.status}`);

  // ---------- Tokens saved before encryption keep working, and the migration encrypts them ----------
  await integrations.insertOne({
    user: new mongoose.Types.ObjectId(oscar._id), provider: 'github', accountHandle: 'old',
    isConnected: true, accessToken: 'legacy-plain-token', scopes: [], metadata: {},
  });
  await call('GET', '/social/integrations/github/profile', { token: oscar.token });
  await check('a plain-text token from before still works', providerCalls.at(-1)?.auth === 'Bearer legacy-plain-token', providerCalls.at(-1)?.auth);
  runScript('social', 'scripts/migrate-data.js');
  const migrated = await integrations.findOne({ accountHandle: 'old' });
  await check('the migration encrypts it', migrated.accessToken.startsWith('enc:v1:'), migrated.accessToken);
  await call('GET', '/social/integrations/github/profile', { token: oscar.token });
  await check('and it still works afterwards', providerCalls.at(-1)?.auth === 'Bearer legacy-plain-token', providerCalls.at(-1)?.auth);

  // ---------- Deleting a user removes their Social Hub data ----------
  await call('POST', '/social/posts', { token: oscar.token, body: { content: 'Connections only', visibility: 'connections' } });
  await call('POST', `/social/posts/${pandavOnly._id}/comments`, { token: oscar.token, body: { text: 'nice' } });
  const deleted = await call('DELETE', `/users/${oscar._id}`, { token: adminToken });
  await check('admin deletes Oscar', deleted.status === 200);
  const feedAfter = await call('GET', '/social/feed', { token: mia.token });
  await check('the feed still loads', feedAfter.status === 200, `status ${feedAfter.status}`);
  await check('his posts and comments are gone', feedAfter.status === 200 &&
    !feedAfter.data.data.some((p) => p.author?._id === oscar._id || p.comments.some((c) => c.user === oscar._id)));
  await check('his linked account and token are gone', (await integrations.countDocuments({ accountHandle: 'old' })) === 0);

  // A leftover post without an author (data from before this cleanup) doesn't break the feed
  await db.collection('socialpostv2').insertOne({
    author: new mongoose.Types.ObjectId(), content: 'orphan', visibility: 'team',
    moderationStatus: 'clean', approvalStatus: 'none', targets: { pandav: true }, likes: [], comments: [], createdAt: new Date(),
  });
  await check('posts by deleted accounts are skipped', (await call('GET', '/social/feed', { token: mia.token })).status === 200);
});

test('social feed: who sees what, paging and likes', async (t) => {
  const check = checker(t);
  const { call, login, register } = server.api;
  const db = await connectDatabase('social');
  t.after(() => db.close());

  // Gil leads Gamma with Hal; Ivy is connected to Gil; Jon knows nobody
  const adminToken = await login(ADMIN);
  const gil = await register('Gil Leader', 'gil@feed.test');
  const hal = await register('Hal Member', 'hal@feed.test');
  const ivy = await register('Ivy Contact', 'ivy@feed.test');
  const jon = await register('Jon Stranger', 'jon@feed.test');
  const gamma = (await call('POST', '/teams', { token: adminToken, body: { name: 'Gamma', leaderId: gil._id } })).data.data;
  const invite = (await call('POST', `/teams/${gamma._id}/invite`, { token: gil.token, body: { userId: hal._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: hal.token });
  const request = (await call('POST', '/social/connections/request', { token: ivy.token, body: { userId: gil._id } })).data.data;
  await call('PATCH', `/social/connections/${request._id}/respond`, { token: gil.token, body: { action: 'accepted' } });

  const post = async (content, visibility) =>
    (await call('POST', '/social/posts', { token: gil.token, body: { content, visibility } })).data.data;
  await post('Gil public', 'public');
  await post('Gil team', 'team');
  await post('Gil connections', 'connections');
  const hidden = await post('Gil hidden', 'public');
  const removed = await post('Gil removed', 'public');
  await call('PATCH', `/social/moderation/posts/${hidden._id}`, { token: adminToken, body: { action: 'hide' } });
  await call('PATCH', `/social/moderation/posts/${removed._id}`, { token: adminToken, body: { action: 'remove' } });

  const gilPostsSeenBy = async (token) => {
    const feed = await call('GET', '/social/feed', { token });
    return feed.data.data.filter((p) => p.author._id === gil._id).map((p) => p.content.replace('Gil ', '')).sort().join(',');
  };
  const expectations = [
    ['his teammate', hal.token, 'public,team'],
    ['a connection', ivy.token, 'connections,public'],
    ['a stranger', jon.token, 'public'],
    ['the author (hidden included)', gil.token, 'connections,hidden,public,team'],
    ['an admin', adminToken, 'connections,hidden,public,team'],
  ];
  for (const [who, token, expected] of expectations) {
    const seen = await gilPostsSeenBy(token);
    await check(`the feed shows ${who} the right posts`, seen === expected, seen);
  }

  // ---------- Paging ----------
  const start = Date.now() - 3600 * 1000;
  await db.collection('socialpostv2').insertMany(Array.from({ length: 70 }, (_, i) => ({
    author: new mongoose.Types.ObjectId(jon._id), content: `bulk ${i}`, visibility: 'public',
    moderationStatus: 'clean', approvalStatus: 'none', targets: { pandav: true, linkedin: false, github: false },
    likes: [], comments: [], mediaUrls: [], tags: [], createdAt: new Date(start + i * 1000), updatedAt: new Date(),
  })));
  const pages = [];
  let cursor;
  for (let i = 0; i < 5; i += 1) {
    const page = (await call('GET', `/social/feed${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`, { token: jon.token })).data;
    pages.push(page);
    if (!page.hasMore) break;
    cursor = page.data.at(-1).createdAt;
  }
  const allIds = pages.flatMap((page) => page.data.map((p) => p._id));
  const bulkSeen = pages.flatMap((page) => page.data).filter((p) => p.content.startsWith('bulk')).length;
  await check('the feed comes in pages of 50', pages[0].data.length === 50 && pages[0].hasMore === true, `${pages[0].data.length} ${pages[0].hasMore}`);
  await check('the pages cover every post once', bulkSeen === 70 && new Set(allIds).size === allIds.length, `${bulkSeen} bulk, ${allIds.length} ids`);
  await check('the last page says there is no more', pages.at(-1).hasMore === false);
  await check('a bad before date is a 400', (await call('GET', '/social/feed?before=soon', { token: jon.token })).status === 400);

  // ---------- Likes from several people at once are all kept ----------
  const target = (await call('POST', '/social/posts', { token: jon.token, body: { content: 'Like me' } })).data.data;
  const likers = [gil, hal, ivy, jon];
  await Promise.all(likers.map((u) => call('POST', `/social/posts/${target._id}/like`, { token: u.token })));
  const liked = await db.collection('socialpostv2').findOne({ _id: new mongoose.Types.ObjectId(target._id) });
  await check('four likes at once are four likes', liked.likes.length === 4, `${liked.likes.length} likes`);
  const unlike = await call('POST', `/social/posts/${target._id}/like`, { token: hal.token });
  await check('liking again takes the like back', unlike.data.liked === false && unlike.data.likesCount === 3, JSON.stringify(unlike.data));

  // ---------- Personal task input ----------
  const noNotes = await call('POST', '/social/personal-tasks', { token: jon.token, body: { title: 'No notes', description: null } });
  await check('a null description means none (it used to be a 500)', noNotes.status === 201 && noNotes.data.data?.description === '', JSON.stringify(noNotes.data));
  const quiet = await call('POST', '/social/personal-tasks', { token: jon.token, body: { title: 'Quiet', autoGenerateLinkedInPost: 'false' } });
  await check('"false" as text turns auto-sharing off, as it does on update',
    quiet.status === 201 && quiet.data.data?.autoGenerateLinkedInPost === false, JSON.stringify(quiet.data));
});
