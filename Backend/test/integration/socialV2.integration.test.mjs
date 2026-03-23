import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.INTEGRATION_BASE_URL || 'http://localhost:5000/api/v2';
const PASSWORD = process.env.INTEGRATION_TEST_PASSWORD || 'Test@1234';

const randomEmail = (prefix) => `${prefix}.${Date.now()}.${Math.floor(Math.random() * 10000)}@test.local`;

const request = async (path, options = {}) => {
  const { headers: optionHeaders = {}, ...rest } = options;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...optionHeaders,
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { response, body };
};

const registerAndLogin = async (name, email) => {
  const registerRes = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });

  assert.ok([200, 201].includes(registerRes.response.status), `Register failed for ${email}: ${registerRes.body?.message}`);
  assert.equal(registerRes.body?.success, true);

  const token = registerRes.body?.data?.token;
  assert.ok(token, 'Missing token from register response');

  const meRes = await request('/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(meRes.response.status, 200);
  assert.equal(meRes.body?.success, true);

  return { token, user: meRes.body.data };
};

test('social integration: feed visibility by connections', async () => {
  const userA = await registerAndLogin('User A', randomEmail('usera'));
  const userB = await registerAndLogin('User B', randomEmail('userb'));
  const userC = await registerAndLogin('User C', randomEmail('userc'));

  const createPostRes = await request('/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.token}` },
    body: JSON.stringify({
      title: 'Connections only update',
      content: 'Private to my accepted connections',
      visibility: 'connections',
      targets: { pandav: true, linkedin: false, github: false },
    }),
  });

  assert.equal(createPostRes.response.status, 201);
  const postId = createPostRes.body?.data?._id;
  assert.ok(postId, 'Post id missing');

  const feedCBefore = await request('/social/feed', {
    method: 'GET',
    headers: { Authorization: `Bearer ${userC.token}` },
  });
  assert.equal(feedCBefore.response.status, 200);
  const hasPostForCBefore = (feedCBefore.body?.data || []).some((p) => p._id === postId);
  assert.equal(hasPostForCBefore, false, 'Unconnected user should not see connections-only post');

  const requestConn = await request('/social/connections/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.token}` },
    body: JSON.stringify({ userId: userB.user._id }),
  });
  assert.equal(requestConn.response.status, 201);

  const listB = await request('/social/connections', {
    method: 'GET',
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(listB.response.status, 200);
  const pending = listB.body?.data?.pendingReceived || [];
  const reqEntry = pending.find((r) => r.requester?._id === userA.user._id);
  assert.ok(reqEntry?._id, 'Pending connection request missing for userB');

  const accept = await request(`/social/connections/${reqEntry._id}/respond`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${userB.token}` },
    body: JSON.stringify({ action: 'accepted' }),
  });
  assert.equal(accept.response.status, 200);

  const feedBAfter = await request('/social/feed', {
    method: 'GET',
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(feedBAfter.response.status, 200);
  const hasPostForBAfter = (feedBAfter.body?.data || []).some((p) => p._id === postId);
  assert.equal(hasPostForBAfter, true, 'Connected user should see connections-only post');
});

test('social integration: direct message requires connection', async () => {
  const userX = await registerAndLogin('User X', randomEmail('userx'));
  const userY = await registerAndLogin('User Y', randomEmail('usery'));

  const blockedMsg = await request('/social/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userX.token}` },
    body: JSON.stringify({ receiverId: userY.user._id, message: 'hello without connection' }),
  });
  assert.equal(blockedMsg.response.status, 403);

  const connReq = await request('/social/connections/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userX.token}` },
    body: JSON.stringify({ userId: userY.user._id }),
  });
  assert.equal(connReq.response.status, 201);

  const listY = await request('/social/connections', {
    method: 'GET',
    headers: { Authorization: `Bearer ${userY.token}` },
  });
  const pending = listY.body?.data?.pendingReceived || [];
  const reqEntry = pending.find((r) => r.requester?._id === userX.user._id);
  assert.ok(reqEntry?._id);

  const accept = await request(`/social/connections/${reqEntry._id}/respond`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${userY.token}` },
    body: JSON.stringify({ action: 'accepted' }),
  });
  assert.equal(accept.response.status, 200);

  const allowedMsg = await request('/social/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userX.token}` },
    body: JSON.stringify({ receiverId: userY.user._id, message: 'hello after connection' }),
  });
  assert.equal(allowedMsg.response.status, 201);
});

test('social integration: external publish blocked while pending approval', async () => {
  const userM = await registerAndLogin('User M', randomEmail('userm'));

  const createPostRes = await request('/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userM.token}` },
    body: JSON.stringify({
      title: 'Pending approval post',
      content: 'This should require approval before external publish',
      visibility: 'public',
      targets: { pandav: true, linkedin: true, github: false },
    }),
  });
  assert.equal(createPostRes.response.status, 201);

  const postId = createPostRes.body?.data?._id;
  assert.ok(postId);
  assert.equal(createPostRes.body?.data?.approvalStatus, 'pending');

  const publishRes = await request(`/social/posts/${postId}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userM.token}` },
    body: JSON.stringify({ targets: { pandav: true, linkedin: true, github: false } }),
  });

  assert.equal(publishRes.response.status, 409);
});

