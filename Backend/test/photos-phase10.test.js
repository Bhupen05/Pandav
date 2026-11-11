// End-to-end checks for profile photos as images: GET /users/:id/photo (the
// bytes and their type, caching headers, who may ask, the 404s) and the
// leaderboard, which gives a photoUrl instead of carrying the picture
import http from 'node:http';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { ADMIN, checker, connectDatabase, istDay, startServer } from './helpers.js';

const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const JPEG_BYTES = Buffer.from('/9j/4AAQSkZJRgABAQ==', 'base64');
const jpeg = `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`;
const GIF_BYTES = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
const gif = `data:image/gif;base64,${GIF_BYTES.toString('base64')}`;

const today = istDay();
const DATES = { startDate: today, dueDate: new Date(Date.parse(`${today}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10) };

let server;
let db;
let adminToken;
// Sign-ups are limited to 10 an hour per address, so the tests share people
const people = {};

before(async () => {
  server = await startServer('photos');
  db = await connectDatabase('photos');
  const { call, login, register } = server.api;
  adminToken = await login(ADMIN);
  for (const [key, name] of [['ann', 'Ann Photo'], ['bob', 'Bob Plain'], ['cy', 'Cy Legacy'], ['dee', 'Dee Gone'], ['eve', 'Eve Away']]) {
    people[key] = await register(name, `${key}@photos.test`);
  }
  // Everyone gets a task, so everyone is on the admin's leaderboard
  for (const person of Object.values(people)) {
    await call('POST', '/tasks', { token: adminToken, body: { title: `Task for ${person.name}`, description: 'd', ...DATES, assignedTo: [person._id] } });
  }
  const setImage = (person, profileImage) => call('PUT', `/users/${person._id}`, { token: person.token, body: { profileImage } });
  for (const key of ['ann', 'dee', 'eve']) {
    const saved = await setImage(people[key], png);
    if (saved.status !== 200) throw new Error(`Could not set the photo of ${key}: ${JSON.stringify(saved.data)}`);
  }
  // Accounts saved before the format was checked may hold an image address
  await db.collection('users').updateOne({ email: 'cy@photos.test' }, { $set: { profileImage: 'https://example.com/cy.png' } });
  people.setImage = setImage;
});

after(async () => {
  await db?.close();
  await server?.stop();
});

const photo = (id, token, headers) => server.api.call('GET', `/users/${id}/photo`, { token, headers });
// The raw response: the api client parses JSON, an image needs its bytes
const photoBytes = async (id, token, headers = {}) => {
  const res = await fetch(`${server.base}/api/v2/users/${id}/photo`, { headers: { Cookie: `pandav_session=${token}`, ...headers } });
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
};
const board = async (token = adminToken) => (await server.api.call('GET', '/tasks/leaderboard', { token })).data;
const rowOf = (result, person) => result.data.find((r) => r._id === person._id);

test('a photo comes back as the image it was saved as', async (t) => {
  const check = checker(t);
  const { ann, bob } = people;

  const { res, bytes } = await photoBytes(ann._id, bob.token);
  await check("anyone signed in gets someone's photo", res.status === 200, String(res.status));
  await check('with the image type', res.headers.get('content-type') === 'image/png', res.headers.get('content-type'));
  await check('and exactly the stored bytes', bytes.equals(PNG_BYTES), `${bytes.length} bytes`);
  await check('kept by the browser for a day, and only theirs', res.headers.get('cache-control') === 'private, max-age=86400', res.headers.get('cache-control'));
  await check('with a strong ETag', /^"[0-9a-f]{40}"$/.test(res.headers.get('etag') || ''), res.headers.get('etag'));
  await check('never run as a page',
    res.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(res.headers.get('content-security-policy') || ''));

  const etag = res.headers.get('etag');
  // Plain http: fetch() adds Cache-Control: no-cache to a request with If-None-Match, which a browser's own revalidation doesn't
  const conditional = (ifNoneMatch) => new Promise((resolve, reject) => {
    http.get(`${server.base}/api/v2/users/${ann._id}/photo`, { headers: { Cookie: `pandav_session=${bob.token}`, 'If-None-Match': ifNoneMatch } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ res, bytes: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const again = await conditional(etag);
  await check('asking again with the ETag is a 304 without the image',
    again.res.statusCode === 304 && again.bytes.length === 0 && again.res.headers['cache-control'] === 'private, max-age=86400',
    String(again.res.statusCode));
  const other = await conditional('"something-else"');
  await check('another ETag gets the image', other.res.statusCode === 200 && other.bytes.equals(PNG_BYTES));

  await check('the owner gets their own', (await photoBytes(ann._id, ann.token)).res.status === 200);
  await check('an admin gets it too', (await photoBytes(ann._id, adminToken)).res.status === 200);
  await check('signed out is a 401', (await photo(ann._id)).status === 401);

  // The type follows what was saved
  await people.setImage(bob, jpeg);
  const asJpeg = await photoBytes(bob._id, ann.token);
  await check('a JPEG comes back as image/jpeg with its bytes',
    asJpeg.res.headers.get('content-type') === 'image/jpeg' && asJpeg.bytes.equals(JPEG_BYTES), asJpeg.res.headers.get('content-type'));
  await check('with its own ETag', asJpeg.res.headers.get('etag') !== etag);
  await people.setImage(bob, gif);
  const asGif = await photoBytes(bob._id, ann.token);
  await check('a GIF comes back as image/gif', asGif.res.headers.get('content-type') === 'image/gif' && asGif.bytes.equals(GIF_BYTES));
});

test('no photo, no account, no answer', async (t) => {
  const check = checker(t);
  const { ann, bob, cy, dee, eve } = people;
  const { call } = server.api;

  // bob's photo was only set in the test above; take it off again
  await people.setImage(bob, null);
  const none = await photo(bob._id, ann.token);
  await check('someone without a photo is a 404', none.status === 404 && none.data.message === 'Photo not found', JSON.stringify(none.data));
  await check('removing a photo stops it being served', (await photo(bob._id, adminToken)).status === 404);
  await check('the admin has none', (await photo((await server.api.me(adminToken))._id, ann.token)).status === 404);
  await check('an unknown id is a 404', (await photo('64b7f0c2a1b2c3d4e5f60718', ann.token)).status === 404);
  await check('so is something that is no id', (await photo('nope', ann.token)).status === 404);
  await check('a stored image address (not a data URL) is a 404', (await photo(cy._id, ann.token)).status === 404);

  const asEve = await photoBytes(eve._id, ann.token);
  await check('a deactivated account keeps its photo, as old conversations show it', asEve.res.status === 200);
  await call('PUT', `/users/${eve._id}/toggle-active`, { token: adminToken });
  await check('also while it is deactivated', (await photoBytes(eve._id, ann.token)).res.status === 200);

  await check('a deleted account has one before', (await photoBytes(dee._id, ann.token)).res.status === 200);
  const deleted = await call('DELETE', `/users/${dee._id}`, { token: adminToken });
  await check('the account is deleted', deleted.status === 200, JSON.stringify(deleted.data));
  await check('and its photo is a 404 for everyone, admins too',
    (await photo(dee._id, ann.token)).status === 404 && (await photo(dee._id, adminToken)).status === 404);
  // Even if the image were still stored (a cleanup that stopped part-way)
  await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(dee._id) }, { $set: { profileImage: png } });
  await check('a deleted account with a stored image is still a 404', (await photo(dee._id, ann.token)).status === 404);

  // A new photo is a different image with a different ETag
  const before = (await photoBytes(ann._id, bob.token)).res.headers.get('etag');
  await people.setImage(ann, jpeg);
  const after = await photoBytes(ann._id, bob.token);
  await check('a changed photo is served at once, with a new ETag', after.bytes.equals(JPEG_BYTES) && after.res.headers.get('etag') !== before);
});

test('the leaderboard links to photos instead of carrying them', async (t) => {
  const check = checker(t);
  const { ann, bob, cy, dee } = people;

  // Back to a known state: ann has the PNG, bob and cy have none usable
  await people.setImage(ann, png);
  const result = await board();
  const rows = result.data;
  const row = (person) => rowOf(result, person);
  await check('the board has the people with tasks', result.success && row(ann) && row(bob) && row(cy), JSON.stringify(rows.map((r) => r.name)));
  await check('no row has profileImage, and no picture is in the answer', rows.every((r) => !('profileImage' in r)) && !JSON.stringify(result).includes('base64'));
  await check('a row has these fields and no others',
    rows.every((r) => Object.keys(r).sort().join() === ['_id', 'completedTasks', 'completionRate', 'name', 'photoUrl', 'totalTasks'].join()),
    JSON.stringify(rows[0]));

  const url = row(ann).photoUrl;
  await check('someone with a photo gets its link', new RegExp(`^/api/v2/users/${ann._id}/photo\\?v=\\d+$`).test(url), String(url));
  await check('someone without one gets null', row(bob).photoUrl === null);
  await check('so does someone whose stored value is not an image', row(cy).photoUrl === null);
  await check('a deleted account is not listed', !row(dee));

  const { res, bytes } = await photoBytes(ann._id, bob.token);
  await check('the link leads to the image', res.status === 200 && bytes.equals(PNG_BYTES));
  const viaLink = await fetch(`${server.base}${url}`, { headers: { Cookie: `pandav_session=${bob.token}` } });
  await check('with its version in the address too', viaLink.status === 200 && Buffer.from(await viaLink.arrayBuffer()).equals(PNG_BYTES));

  // A new photo changes the link, so a browser that kept the old one fetches the new one
  await new Promise((resolve) => setTimeout(resolve, 20));
  await people.setImage(ann, jpeg);
  const changed = rowOf(await board(), ann);
  await check('a changed photo has a different link', changed.photoUrl && changed.photoUrl !== url, `${url} -> ${changed.photoUrl}`);
  await people.setImage(ann, null);
  await check('a removed photo has no link', rowOf(await board(), ann).photoUrl === null);

  // The same for a member looking at their team's board
  const own = await board(bob.token);
  await check('a member without a team sees only themselves, with the same fields',
    own.data.length === 1 && own.data[0]._id === bob._id && own.data[0].photoUrl === null && !('profileImage' in own.data[0]), JSON.stringify(own.data));
});
