// End-to-end checks for posting to LinkedIn from the Social Hub: the text
// LinkedIn gets (title, hashtags, escaping, the length limit), images (the
// upload checks, who may see them, sending them to LinkedIn, cleaning up),
// posting straight away, scheduling, moving and cancelling a schedule, posts
// that go once approved, retries, and sharing a task. A fake LinkedIn stands
// in for its API.
import http from 'node:http';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, SESSION_COOKIE, checker, connectDatabase, startServer } from './helpers.js';
import { LINKEDIN_TEXT_MAX, hashtagOf, linkedInText, toLittleText } from '../src/utils/linkedinText.js';
import { checkImage } from '../src/models/SocialImageV2.js';

// ---------- Images to upload ----------
const png = (width, height) => {
  const bytes = Buffer.alloc(33);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};
const gif = (width, height) => {
  const bytes = Buffer.alloc(13);
  bytes.write('GIF89a', 0, 'latin1');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
};
// SOI, an APP0 segment, then a baseline frame of the given size
const jpeg = (width, height) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0', 'latin1'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame]);
};
const b64 = (bytes) => bytes.toString('base64');

// ---------- Fake LinkedIn ----------
const calls = [];
let failNextPosts = 0;
let providerUrl;
const provider = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const call = { method: req.method, path: req.url, headers: req.headers, raw, body: null };
    try { call.body = JSON.parse(raw.toString('utf8')); } catch { /* not JSON */ }
    calls.push(call);
    const reply = (status, data, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(data === undefined ? undefined : JSON.stringify(data));
    };
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');

    if (req.method === 'GET' && req.url === '/v2/userinfo') return reply(200, { sub: `member-${token}`, name: `Member ${token}` });
    if (req.method === 'POST' && req.url === '/rest/images?action=initializeUpload') {
      const n = calls.length;
      // One member's uploads point somewhere that isn't LinkedIn
      const uploadUrl = token === 'tok-evil' ? 'https://uploads.example.com/img' : `${providerUrl}/upload/img-${n}`;
      return reply(200, { value: { uploadUrl, image: `urn:li:image:img-${n}`, uploadUrlExpiresAt: Date.now() + 60000 } });
    }
    if (req.method === 'PUT' && req.url.startsWith('/upload/')) return reply(201);
    if (req.method === 'POST' && req.url === '/rest/posts') {
      if (failNextPosts > 0) {
        failNextPosts -= 1;
        return reply(500, { message: 'Temporary problem' });
      }
      return reply(201, undefined, { 'x-restli-id': `urn:li:share:${calls.length}` });
    }
    return reply(404, { message: 'Not found' });
  });
});
const postsSent = () => calls.filter((c) => c.method === 'POST' && c.path === '/rest/posts');
const lastPostSent = () => postsSent().at(-1);
const uploads = () => calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/upload/'));

const people = {};
let server;
let db;
let adminToken;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const HOUR = 60 * 60 * 1000;

before(async () => {
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  providerUrl = `http://127.0.0.1:${provider.address().port}`;
  server = await startServer('linkedin', {
    LINKEDIN_API_BASE: providerUrl,
    LINKEDIN_API_VERSION: '202609',
  });
  db = await connectDatabase('linkedin');
  const { call, login, register } = server.api;
  // Lee leads a team that Mia is in; Sam leads another, so their posts need
  // no approval; Oz and Eve have no team, and Eve's LinkedIn misbehaves
  for (const [key, name] of [['lee', 'Lee Leader'], ['mia', 'Mia Member'], ['oz', 'Oz Outsider'], ['eve', 'Eve Elsewhere'], ['sam', 'Sam Scheduler']]) {
    people[key] = await register(name, `${key}@linkedin.test`);
  }
  adminToken = await login(ADMIN);

  const { lee, mia } = people;
  const team = (await call('POST', '/teams', { token: lee.token, body: { name: 'LI Team' } })).data.data;
  const invite = (await call('POST', `/teams/${team._id}/invite`, { token: lee.token, body: { userId: mia._id } })).data.data;
  await call('PUT', `/teams/invites/${invite._id}/accept`, { token: mia.token });
  await call('POST', '/teams', { token: people.sam.token, body: { name: 'Sam Team' } });
  for (const key of ['lee', 'mia', 'sam']) {
    await call('POST', '/social/integrations/linkedin/link', { token: people[key].token, body: { accessToken: `tok-${key}` } });
  }
  await call('POST', '/social/integrations/linkedin/link', { token: people.eve.token, body: { accessToken: 'tok-evil' } });
});
after(async () => {
  await db?.close();
  await server?.stop();
  await new Promise((resolve) => provider.close(resolve));
});

const createPost = (person, body) => server.api.call('POST', '/social/posts', { token: person.token, body });
const upload = (person, bytes, type, altText) =>
  server.api.call('POST', '/social/images', { token: person.token, body: { type, data: b64(bytes), altText } });
const runSocialJob = (now) =>
  server.api.call('POST', '/admin/jobs/social-publish/run', { token: adminToken, body: now ? { now: now.toISOString() } : {} });
// The image's bytes as a person's browser would load them
const viewImage = (person, imageId) =>
  fetch(`${server.base}/api/v2/social/images/${imageId}`, { headers: { Cookie: `${SESSION_COOKIE}=${person.token}` } });

test('the text LinkedIn gets', async (t) => {
  const check = checker(t);
  await check('a tag becomes a hashtag of letters, digits and underscores', hashtagOf('machine learning!') === 'machinelearning' && hashtagOf('C++') === 'C' && hashtagOf('día_1') === 'día_1');
  await check('the title, the post and the tags, each in its own paragraph',
    linkedInText({ title: 'Launch', content: 'We shipped.', tags: ['release', 'Team work'] }) === 'Launch\n\nWe shipped.\n\n#release #Teamwork');
  await check('tags the post already uses as hashtags are not repeated',
    linkedInText({ content: 'Big #Release today', tags: ['release', 'news', 'NEWS'] }) === 'Big #Release today\n\n#news');
  await check('a post without a title or tags is just its text', linkedInText({ content: '  Hi  ' }) === 'Hi');
  await check('reserved characters are escaped',
    toLittleText('Mail a@b.com (soon) [x] <y> *z* _u_ ~w~ {v} | \\') === 'Mail a\\@b.com \\(soon\\) \\[x\\] \\<y\\> \\*z\\* \\_u\\_ \\~w\\~ \\{v\\} \\| \\\\');
  await check('hashtags become hashtag templates',
    toLittleText('Ship it #release #v2_0') === 'Ship it {hashtag|\\#|release} {hashtag|\\#|v2\\_0}', toLittleText('Ship it #release #v2_0'));
  await check('a # inside a word or a link stays a plain #',
    toLittleText('C# and https://x.io/a#top') === 'C\\# and https://x.io/a\\#top', toLittleText('C# and https://x.io/a#top'));
  await check('the limit is LinkedIn’s 3000 characters', LINKEDIN_TEXT_MAX === 3000);
});

test('what may be uploaded as an image', async (t) => {
  const check = checker(t);
  const ok = checkImage({ type: 'image/png', data: b64(png(1200, 627)), altText: '  A   chart ' });
  await check('a PNG is read with its size, and its description tidied',
    ok.width === 1200 && ok.height === 627 && ok.altText === 'A chart' && ok.type === 'image/png', JSON.stringify({ ...ok, bytes: undefined }));
  const j = checkImage({ type: 'image/jpg', data: b64(jpeg(640, 480)) });
  await check('a JPEG is read with its size (image/jpg is JPEG)', j.type === 'image/jpeg' && j.width === 640 && j.height === 480, JSON.stringify({ ...j, bytes: undefined }));
  const g = checkImage({ type: 'image/gif', data: `data:image/gif;base64,${b64(gif(3, 2))}` });
  await check('a GIF too, also sent as a data: URL', g.width === 3 && g.height === 2);
  await check('WebP and SVG are refused', /PNG, JPEG or GIF/.test(checkImage({ type: 'image/webp', data: b64(png(1, 1)) }).error)
    && /PNG, JPEG or GIF/.test(checkImage({ type: 'image/svg+xml', data: b64(Buffer.from('<svg/>')) }).error));
  await check('a file that is not what its type says is refused', /don't match/.test(checkImage({ type: 'image/png', data: b64(gif(1, 1)) }).error));
  await check('an image LinkedIn would refuse for its pixels is refused', /too large/.test(checkImage({ type: 'image/png', data: b64(png(10000, 10000)) }).error));
  await check('over 2 MB is refused', /2 MB/.test(checkImage({ type: 'image/png', data: b64(Buffer.concat([png(10, 10), Buffer.alloc(2 * 1024 * 1024)])) }).error));
  await check('a long description is refused', /description/.test(checkImage({ type: 'image/png', data: b64(png(1, 1)), altText: 'x'.repeat(301) }).error));
  await check('bad base64 is refused', /base64/.test(checkImage({ type: 'image/png', data: '%%%' }).error));
});

test('images: upload, who sees them, and cleaning up', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, oz, mia } = people;

  const first = await upload(lee, png(800, 600), 'image/png', 'Team photo');
  await check('an image is uploaded with its size', first.status === 201 && first.data.data.width === 800 && first.data.data.post === null, JSON.stringify(first.data));
  const imageId = first.data.data._id;

  const own = await viewImage(lee, imageId);
  await check('its owner sees it, as the image it is', own.status === 200 && own.headers.get('content-type') === 'image/png'
    && own.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(own.headers.get('content-security-policy')));
  await check('nobody else sees it before it is posted', (await viewImage(oz, imageId)).status === 404);

  const forFeed = await createPost(lee, { content: 'With a photo', images: [{ id: imageId, altText: 'Our team at the offsite' }] });
  await check('a post is created with it', forFeed.status === 201 && forFeed.data.data.images?.[0]?._id === imageId
    && forFeed.data.data.images[0].altText === 'Our team at the offsite', JSON.stringify(forFeed.data).slice(0, 400));
  await check('then everyone who sees the post sees the image', (await viewImage(oz, imageId)).status === 200);
  const again = await createPost(lee, { content: 'Same photo again', images: [{ id: imageId }] });
  await check('an image can only be in one post', again.status === 400 && /images/.test(again.data.message), JSON.stringify(again.data));
  const removePosted = await call('DELETE', `/social/images/${imageId}`, { token: lee.token });
  await check('a posted image can only go with its post', removePosted.status === 409, JSON.stringify(removePosted.data));

  const teamImage = (await upload(lee, gif(10, 10), 'image/gif')).data.data._id;
  await createPost(lee, { content: 'Team only', visibility: 'team', images: [{ id: teamImage }] });
  await check('a team-only post’s image is seen by the team', (await viewImage(mia, teamImage)).status === 200);
  await check('and not by others', (await viewImage(oz, teamImage)).status === 404);

  const othersImage = (await upload(oz, png(10, 10), 'image/png')).data.data._id;
  const stolen = await createPost(lee, { content: 'Not mine', images: [{ id: othersImage }] });
  await check('nobody posts someone else’s image', stolen.status === 400, JSON.stringify(stolen.data));
  await check('a refused post gives back the images it took', (await db.collection('socialimagev2').findOne({ _id: oid(othersImage) })).post === null);

  const five = await createPost(lee, { content: 'Too many', images: [1, 2, 3, 4, 5].map(() => ({ id: String(new mongoose.Types.ObjectId()) })) });
  await check('a post has at most 4 images', five.status === 400 && /at most 4/.test(five.data.message), JSON.stringify(five.data));
  const twice = await createPost(lee, { content: 'Twice', images: [{ id: othersImage }, { id: othersImage }] });
  await check('the same image can’t be in a post twice', twice.status === 400 && /twice/.test(twice.data.message));

  const spare = (await upload(oz, jpeg(4, 4), 'image/jpeg')).data.data._id;
  const removed = await call('DELETE', `/social/images/${spare}`, { token: oz.token });
  await check('an image that isn’t posted can be removed', removed.status === 200 && (await viewImage(oz, spare)).status === 404);

  const big = await call('POST', '/social/images', { token: oz.token, body: { type: 'image/png', data: b64(Buffer.concat([png(10, 10), Buffer.alloc(1900 * 1024)])) } });
  await check('an image near 2 MB fits in a request', big.status === 201, `${big.status} ${JSON.stringify(big.data)}`);

  // Unused for over a day: the background job removes them
  const run = await runSocialJob(new Date(Date.now() + 25 * HOUR));
  await check('images nobody posted go after a day', run.data.data?.unusedImagesRemoved >= 2 && (await viewImage(oz, othersImage)).status === 404,
    JSON.stringify(run.data).slice(0, 300));
  await check('posted images stay', (await viewImage(oz, imageId)).status === 200);

  const toDelete = (await upload(lee, png(5, 5), 'image/png')).data.data._id;
  const doomed = (await createPost(lee, { content: 'Short-lived', images: [{ id: toDelete }] })).data.data;
  await call('DELETE', `/social/posts/${doomed._id}`, { token: lee.token });
  await check('deleting a post deletes its images', (await viewImage(lee, toDelete)).status === 404);
});

test('posting to LinkedIn straight away', async (t) => {
  const check = checker(t);
  const { lee, oz } = people;

  const noAccount = await createPost(oz, { content: 'Hello LinkedIn', targets: { pandav: true, linkedin: true }, autoPublish: true });
  await check('it needs a connected LinkedIn account', noAccount.status === 400 && /Connect your LinkedIn/.test(noAccount.data.message), JSON.stringify(noAccount.data));
  const notForLinkedIn = await createPost(lee, { content: 'Pandav only', autoPublish: true });
  await check('and a post for LinkedIn', notForLinkedIn.status === 400, JSON.stringify(notForLinkedIn.data));
  const tooLong = await createPost(lee, { title: 'Long', content: 'x'.repeat(LINKEDIN_TEXT_MAX), targets: { linkedin: true } });
  await check('a post too long for LinkedIn is refused, counting the title',
    tooLong.status === 400 && /Too long for LinkedIn: 3006 of 3000/.test(tooLong.data.message), JSON.stringify(tooLong.data));
  const longForPandav = await createPost(lee, { content: 'x'.repeat(4000) });
  await check('the limit is only for LinkedIn', longForPandav.status === 201);

  const photo = (await upload(lee, png(1200, 627), 'image/png', 'Launch banner')).data.data._id;
  const sentBefore = postsSent().length;
  const created = await createPost(lee, {
    title: 'We launched',
    content: 'Thanks to everyone (really) #launch',
    tags: ['launch', 'team work'],
    targets: { pandav: true, linkedin: true },
    images: [{ id: photo }],
    autoPublish: true,
  });
  const linkedin = created.data.data?.publishResults?.linkedin;
  await check('a leader’s post goes to LinkedIn as it is created', created.status === 201 && linkedin?.status === 'published'
    && /^urn:li:share:/.test(linkedin.externalId) && postsSent().length === sentBefore + 1, JSON.stringify(created.data).slice(0, 500));
  await check('with no job left over', Object.keys(created.data.data.queuedJobs).length === 0, JSON.stringify(created.data.data.queuedJobs));

  const sent = lastPostSent();
  await check('LinkedIn is called as the versioned API', sent.headers['linkedin-version'] === '202609' && sent.headers['x-restli-protocol-version'] === '2.0.0'
    && sent.headers.authorization === 'Bearer tok-lee');
  await check('as the member, publicly', sent.body.author === 'urn:li:person:member-tok-lee' && sent.body.visibility === 'PUBLIC' && sent.body.lifecycleState === 'PUBLISHED');
  await check('with the title, the escaped text and the tags as hashtags',
    sent.body.commentary === 'We launched\n\nThanks to everyone \\(really\\) {hashtag|\\#|launch}\n\n{hashtag|\\#|teamwork}', sent.body.commentary);
  const upload1 = uploads().at(-1);
  await check('the image is uploaded with the member’s token, as its bytes',
    upload1.headers.authorization === 'Bearer tok-lee' && upload1.headers['content-type'] === 'image/png' && upload1.raw.equals(png(1200, 627)));
  await check('and attached with its description', /^urn:li:image:/.test(sent.body.content?.media?.id) && sent.body.content.media.altText === 'Launch banner', JSON.stringify(sent.body.content));

  const pics = [];
  for (const [bytes, type] of [[png(2, 2), 'image/png'], [jpeg(3, 3), 'image/jpeg']]) pics.push((await upload(lee, bytes, type)).data.data._id);
  await createPost(lee, { content: 'Two photos', targets: { linkedin: true }, images: pics.map((id) => ({ id })), autoPublish: true });
  const multi = lastPostSent().body.content?.multiImage?.images;
  await check('two images go as a multi-image post, in order', multi?.length === 2 && multi.every((image) => /^urn:li:image:/.test(image.id)) && !('altText' in multi[0]),
    JSON.stringify(lastPostSent().body.content));

  // LinkedIn has a problem: the job tries again later, and then it works
  failNextPosts = 1;
  const flaky = await createPost(lee, { content: 'Second time lucky', targets: { linkedin: true }, autoPublish: true });
  const retry = flaky.data.data?.queuedJobs?.linkedin;
  await check('a failure is reported, with the retry it will make',
    flaky.status === 201 && flaky.data.data.publishResults.linkedin.status === 'failed' && /Temporary problem/.test(flaky.data.data.publishResults.linkedin.message)
    && retry?.status === 'queued' && retry.attempts === 1 && new Date(retry.nextRetryAt) > new Date(), JSON.stringify(flaky.data).slice(0, 500));
  await runSocialJob(new Date(Date.now() + HOUR));
  const later = await server.api.call('GET', `/social/posts/${flaky.data.data._id}`, { token: lee.token });
  await check('the retry posts it', later.data.data.publishResults.linkedin.status === 'published' && Object.keys(later.data.data.queuedJobs).length === 0, JSON.stringify(later.data.data.publishResults));

  // An upload link that isn't LinkedIn's never gets the member's token
  const evilPhoto = (await upload(people.eve, png(2, 2), 'image/png')).data.data._id;
  const uploadsBefore = uploads().length;
  const evilPost = (await createPost(people.eve, { content: 'Elsewhere', targets: { linkedin: true }, images: [{ id: evilPhoto }], autoPublish: true })).data.data;
  // Eve has no team: an admin approves, and that sends it
  const evil = await server.api.call('PATCH', `/social/posts/${evilPost._id}/approve`, { token: adminToken, body: { action: 'approved' } });
  await check('an upload link outside LinkedIn is refused', evil.data.data.publishResults.linkedin.status === 'failed'
    && /no place to upload/.test(evil.data.data.publishResults.linkedin.message) && uploads().length === uploadsBefore, JSON.stringify(evil.data.data.publishResults));
});

test('scheduling a post for later', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { sam, oz } = people;

  const inPast = await createPost(sam, { content: 'Yesterday', targets: { linkedin: true }, autoPublish: true, publishAt: new Date(Date.now() - 2 * HOUR).toISOString() });
  await check('a time already past is refused', inPast.status === 400 && /still to come/.test(inPast.data.message), JSON.stringify(inPast.data));
  const tooFar = await createPost(sam, { content: 'Next year', targets: { linkedin: true }, autoPublish: true, publishAt: new Date(Date.now() + 100 * 24 * HOUR).toISOString() });
  await check('so is one more than 90 days ahead', tooFar.status === 400 && /90 days/.test(tooFar.data.message));
  const noAuto = await createPost(sam, { content: 'Timing only', targets: { linkedin: true }, publishAt: new Date(Date.now() + HOUR).toISOString() });
  await check('a time needs autoPublish', noAuto.status === 400 && /autoPublish/.test(noAuto.data.message));

  const at = new Date(Date.now() + 3 * HOUR);
  const sentBefore = postsSent().length;
  const scheduled = await createPost(sam, { content: 'Going out later', targets: { pandav: true, linkedin: true }, autoPublish: true, publishAt: at.toISOString() });
  const job = scheduled.data.data?.queuedJobs?.linkedin;
  await check('a scheduled post waits, with its job due at its time', scheduled.status === 201 && postsSent().length === sentBefore
    && scheduled.data.data.publishAt === at.toISOString() && job?.status === 'queued' && job.nextRetryAt === at.toISOString(), JSON.stringify(scheduled.data).slice(0, 500));
  await check('it is in the feed already', scheduled.data.data.targets.pandav === true && scheduled.data.data.publishResults.linkedin.status === 'none');
  const asOthers = await call('GET', `/social/posts/${scheduled.data.data._id}`, { token: oz.token });
  await check('only its publishers see its job', asOthers.status === 200 && Object.keys(asOthers.data.data.queuedJobs).length === 0, JSON.stringify(asOthers.data.data.queuedJobs));

  await runSocialJob(new Date(at.getTime() - 60 * 1000));
  await check('the background job leaves it until then', postsSent().length === sentBefore);

  const postId = scheduled.data.data._id;
  const moved = new Date(Date.now() + 5 * HOUR);
  const move = await call('PUT', `/social/posts/${postId}/schedule`, { token: sam.token, body: { publishAt: moved.toISOString() } });
  await check('it can be moved', move.status === 200 && move.data.data.publishAt === moved.toISOString() && move.data.data.queuedJobs.linkedin.nextRetryAt === moved.toISOString()
    && (await db.collection('socialpublishjobv2').countDocuments({ post: oid(postId) })) === 1, JSON.stringify(move.data).slice(0, 400));
  await check('only by who may publish it', (await call('PUT', `/social/posts/${postId}/schedule`, { token: oz.token, body: {} })).status === 403);

  await runSocialJob(new Date(moved.getTime() + 60 * 1000));
  const done = await call('GET', `/social/posts/${postId}`, { token: sam.token });
  await check('at its time, the background job posts it', done.data.data.publishResults.linkedin.status === 'published' && postsSent().length === sentBefore + 1,
    JSON.stringify(done.data.data.publishResults));
  const afterwards = await call('PUT', `/social/posts/${postId}/schedule`, { token: sam.token, body: {} });
  await check('a post on LinkedIn can’t be scheduled again', afterwards.status === 409, JSON.stringify(afterwards.data));

  // Scheduled, then posted now instead
  const second = (await createPost(sam, { content: 'Actually now', targets: { linkedin: true }, autoPublish: true, publishAt: new Date(Date.now() + 2 * HOUR).toISOString() })).data.data;
  const now = await call('PUT', `/social/posts/${second._id}/schedule`, { token: sam.token, body: { publishAt: null } });
  await check('“post now” posts it at once', now.status === 200 && now.data.data.publishResults.linkedin.status === 'published' && now.data.data.publishAt === null,
    JSON.stringify(now.data).slice(0, 300));

  // Scheduled, then cancelled
  const third = (await createPost(sam, { content: 'Never mind', targets: { linkedin: true }, autoPublish: true, publishAt: new Date(Date.now() + 2 * HOUR).toISOString() })).data.data;
  const cancel = await call('DELETE', `/social/posts/${third._id}/schedule`, { token: sam.token });
  await check('a schedule can be cancelled', cancel.status === 200 && cancel.data.data.autoPublish === false && Object.keys(cancel.data.data.queuedJobs).length === 0
    && (await db.collection('socialpublishjobv2').countDocuments({ post: oid(third._id) })) === 0, JSON.stringify(cancel.data).slice(0, 300));
  const plain = (await createPost(sam, { content: 'Hand-published', targets: { linkedin: true } })).data.data;
  const scheduleIt = await call('PUT', `/social/posts/${plain._id}/schedule`, { token: sam.token, body: { publishAt: new Date(Date.now() + HOUR).toISOString() } });
  await check('a post made without a time can be scheduled later', scheduleIt.status === 200 && scheduleIt.data.data.queuedJobs.linkedin?.status === 'queued');
  const notLinkedIn = (await createPost(sam, { content: 'Pandav only' })).data.data;
  await check('only a post for LinkedIn can be scheduled', (await call('PUT', `/social/posts/${notLinkedIn._id}/schedule`, { token: sam.token, body: {} })).status === 400);
});

test('posts that need approval go once approved', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia } = people;

  const sentBefore = postsSent().length;
  const photo = (await upload(mia, png(20, 20), 'image/png')).data.data._id;
  const pending = (await createPost(mia, { content: 'Member news', targets: { pandav: true, linkedin: true }, images: [{ id: photo }], autoPublish: true })).data.data;
  await check('her leader sees the images of the post he is asked to approve', (await viewImage(lee, photo)).status === 200);
  await check('others don’t, while it waits', (await viewImage(people.oz, photo)).status === 404);
  await check('a member’s post waits for approval and is not sent', pending.approvalStatus === 'pending' && postsSent().length === sentBefore
    && Object.keys(pending.queuedJobs).length === 0, JSON.stringify(pending).slice(0, 300));
  const early = await call('PUT', `/social/posts/${pending._id}/schedule`, { token: mia.token, body: {} });
  await check('scheduling it now still waits for the approval', early.status === 200 && early.data.data.approvalStatus === 'pending' && postsSent().length === sentBefore);

  const approved = await call('PATCH', `/social/posts/${pending._id}/approve`, { token: lee.token, body: { action: 'approved' } });
  await check('approving it sends it to LinkedIn on the member’s account', approved.status === 200 && approved.data.data.publishResults.linkedin.status === 'published'
    && lastPostSent().headers.authorization === 'Bearer tok-mia', JSON.stringify(approved.data).slice(0, 400));
  const notice = await db.collection('notifications').findOne({ user: oid(mia._id), type: 'post_approved' });
  await check('the member is told it is on LinkedIn', /on LinkedIn now/.test(notice?.body), notice?.body);

  const at = new Date(Date.now() + 4 * HOUR);
  const later = (await createPost(mia, { content: 'Member news, later', targets: { linkedin: true }, autoPublish: true, publishAt: at.toISOString() })).data.data;
  const sentAtApproval = postsSent().length;
  const approvedLater = await call('PATCH', `/social/posts/${later._id}/approve`, { token: lee.token, body: { action: 'approved' } });
  await check('approving a scheduled post queues it for its time', approvedLater.data.data.queuedJobs.linkedin?.nextRetryAt === at.toISOString()
    && postsSent().length === sentAtApproval, JSON.stringify(approvedLater.data.data.queuedJobs));
  const laterNotice = await db.collection('notifications').find({ user: oid(mia._id), type: 'post_approved' }).sort({ _id: -1 }).limit(1).next();
  await check('and the member is told when', /goes to LinkedIn on/.test(laterNotice?.body), laterNotice?.body);

  const edited = await call('PATCH', `/social/posts/${later._id}`, { token: mia.token, body: { content: 'Member news, reworded' } });
  await check('editing it sends it back for approval and drops its job', edited.data.data.approvalStatus === 'pending' && Object.keys(edited.data.data.queuedJobs).length === 0);
  const reApproved = await call('PATCH', `/social/posts/${later._id}/approve`, { token: lee.token, body: { action: 'approved' } });
  await check('approving it again queues it again for its time', reApproved.data.data.queuedJobs.linkedin?.nextRetryAt === at.toISOString());

  const tooLong = await call('PATCH', `/social/posts/${later._id}`, { token: mia.token, body: { content: 'y'.repeat(LINKEDIN_TEXT_MAX + 1) } });
  await check('an edit can’t make it too long for LinkedIn', tooLong.status === 400 && /Too long for LinkedIn/.test(tooLong.data.message), JSON.stringify(tooLong.data));
});

test('sharing a completed task on LinkedIn', async (t) => {
  const check = checker(t);
  const { call } = server.api;
  const { lee, mia } = people;

  const task = (await call('POST', '/social/personal-tasks', { token: lee.token, body: { title: 'Write the launch notes', autoGenerateLinkedInPost: true } })).data.data;
  await call('PATCH', `/social/personal-tasks/${task._id}/toggle-complete`, { token: lee.token });
  const sentBefore = postsSent().length;
  const shared = await call('POST', `/social/personal-tasks/${task._id}/share`, { token: lee.token, body: { linkedin: true } });
  await check('a leader’s shared task goes to LinkedIn at once', shared.status === 201 && shared.data.data.publishResult.linkedin.status === 'published'
    && postsSent().length === sentBefore + 1, JSON.stringify(shared.data).slice(0, 400));
  const tasks = (await call('GET', '/social/personal-tasks', { token: lee.token })).data.data;
  await check('and the task says it was shared', tasks.find((item) => item._id === task._id)?.autoPostStatus === 'published');

  const memberTask = (await call('POST', '/social/personal-tasks', { token: mia.token, body: { title: 'Fix the footer', autoGenerateLinkedInPost: true } })).data.data;
  await call('PATCH', `/social/personal-tasks/${memberTask._id}/toggle-complete`, { token: mia.token });
  const memberShare = await call('POST', `/social/personal-tasks/${memberTask._id}/share`, { token: mia.token, body: { linkedin: true } });
  const postId = memberShare.data.data.postId;
  await check('a member’s waits for approval', memberShare.data.data.pendingApproval === true && postsSent().length === sentBefore + 1);
  await call('PATCH', `/social/posts/${postId}/approve`, { token: lee.token, body: { action: 'approved' } });
  const memberTasks = (await call('GET', '/social/personal-tasks', { token: mia.token })).data.data;
  await check('and goes to LinkedIn once approved, marking the task shared', postsSent().length === sentBefore + 2
    && memberTasks.find((item) => item._id === memberTask._id)?.autoPostStatus === 'published', JSON.stringify(memberTasks.map((item) => item.autoPostStatus)));
});
