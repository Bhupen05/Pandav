import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import SocialPost from '../models/SocialPostV2.js';
import NetworkConnection from '../models/NetworkConnectionV2.js';
import PersonalTask from '../models/PersonalTaskV2.js';
import SocialIntegration from '../models/SocialIntegrationV2.js';
import SocialPublishJobV2 from '../models/SocialPublishJobV2.js';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';

const LINKEDIN_API_BASE = process.env.LINKEDIN_API_BASE || 'https://api.linkedin.com';
const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const providerHeaders = (token, extra = {}) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  ...extra,
});

const fetchGithubProfile = async (token) => {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    method: 'GET',
    headers: providerHeaders(token),
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Unable to verify GitHub token');
  }

  return {
    providerUserId: String(data.id),
    accountHandle: data.login,
    metadata: {
      name: data.name || null,
      avatarUrl: data.avatar_url || null,
      profileUrl: data.html_url || null,
    },
  };
};

const fetchLinkedInProfile = async (token) => {
  const userInfoResponse = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
    method: 'GET',
    headers: providerHeaders(token),
  });

  if (userInfoResponse.ok) {
    const data = await safeJson(userInfoResponse);
    return {
      providerUserId: String(data?.sub || ''),
      accountHandle: data?.name || data?.email || String(data?.sub || ''),
      metadata: {
        name: data?.name || null,
        email: data?.email || null,
        picture: data?.picture || null,
      },
    };
  }

  const meResponse = await fetch(`${LINKEDIN_API_BASE}/v2/me`, {
    method: 'GET',
    headers: providerHeaders(token),
  });

  const meData = await safeJson(meResponse);
  if (!meResponse.ok) {
    throw new Error(meData?.message || 'Unable to verify LinkedIn token');
  }

  const localizedFirstName = meData?.localizedFirstName || '';
  const localizedLastName = meData?.localizedLastName || '';

  return {
    providerUserId: String(meData.id),
    accountHandle: `${localizedFirstName} ${localizedLastName}`.trim() || String(meData.id),
    metadata: {
      localizedFirstName: meData?.localizedFirstName || null,
      localizedLastName: meData?.localizedLastName || null,
    },
  };
};

const fetchLinkedInPosts = async (token, providerUserId) => {
  const ownerUrn = `urn:li:person:${providerUserId}`;
  const url = `${LINKEDIN_API_BASE}/v2/shares?q=owners&owners=${encodeURIComponent(ownerUrn)}&count=20`;

  const response = await fetch(url, {
    method: 'GET',
    headers: providerHeaders(token, { 'X-Restli-Protocol-Version': '2.0.0' }),
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Unable to fetch LinkedIn posts');
  }

  return data?.elements || [];
};

const fetchGithubPosts = async (token, accountHandle) => {
  const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(accountHandle)}/events/public?per_page=20`;
  const response = await fetch(url, {
    method: 'GET',
    headers: providerHeaders(token),
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Unable to fetch GitHub activity');
  }

  return Array.isArray(data) ? data : [];
};

const publishToLinkedIn = async (integration, text) => {
  const ownerUrn = `urn:li:person:${integration.providerUserId}`;
  const body = {
    author: ownerUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await fetch(`${LINKEDIN_API_BASE}/v2/ugcPosts`, {
    method: 'POST',
    headers: providerHeaders(integration.accessToken, {
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    }),
    body: JSON.stringify(body),
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'LinkedIn publish failed');
  }

  const externalId = data?.id || response.headers.get('x-restli-id') || null;
  return { externalId, raw: data };
};

const publishToGithub = async (integration, post, githubRepo) => {
  const targetRepo = githubRepo || process.env.GITHUB_DEFAULT_REPO;
  if (!targetRepo) {
    throw new Error('githubRepo is required (owner/repo) or set GITHUB_DEFAULT_REPO');
  }

  const body = {
    title: post.title || `Pandav update by ${post.author.name}`,
    body: post.content,
  };

  const response = await fetch(`${GITHUB_API_BASE}/repos/${targetRepo}/issues`, {
    method: 'POST',
    headers: providerHeaders(integration.accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'GitHub publish failed');
  }

  return { externalId: data?.html_url || data?.id || null, raw: data };
};

const needsExternalApproval = (role, targets) => {
  const hasExternal = Boolean(targets.linkedin || targets.github);
  if (!hasExternal) return false;
  return role === 'team_member' || role === 'user';
};

const canUserViewPost = async (post, currentUser) => {
  if (post.moderationStatus === 'removed') {
    return currentUser.role === 'admin';
  }

  if (post.moderationStatus === 'hidden') {
    const authorIdHidden = post.author._id ? post.author._id.toString() : post.author.toString();
    const isOwnerHidden = authorIdHidden === currentUser.id.toString();
    return isOwnerHidden || currentUser.role === 'admin';
  }

  if (post.visibility === 'public') return true;

  const authorId = post.author._id ? post.author._id.toString() : post.author.toString();
  const isOwner = authorId === currentUser.id.toString();
  if (isOwner) return true;

  if (currentUser.role === 'admin') return true;

  if (post.visibility === 'team') {
    const authorTeamId = post.author.teamId ? post.author.teamId.toString() : null;
    const currentTeamId = currentUser.teamId ? currentUser.teamId.toString() : null;
    return Boolean(authorTeamId && currentTeamId && authorTeamId === currentTeamId);
  }

  if (post.visibility === 'connections') {
    const connection = await NetworkConnection.findOne({
      $or: [
        { requester: authorId, recipient: currentUser._id, status: 'accepted' },
        { requester: currentUser._id, recipient: authorId, status: 'accepted' },
      ],
    }).lean();

    return Boolean(connection);
  }

  return false;
};

const ensureAtLeastOneTarget = (targets = {}) => {
  return Boolean(targets.pandav || targets.linkedin || targets.github);
};

const buildTaskPostContent = (task, user, options = {}) => {
  const intro = options.intro || 'Task update';
  const lines = [
    `${intro}: ${task.title}`,
    task.description ? `Summary: ${task.description}` : null,
    `Status: ${task.status}`,
    task.priority ? `Priority: ${task.priority}` : null,
    `Completed by: ${user.name}`,
    'Shared from Pandav V2',
  ].filter(Boolean);

  return lines.join('\n');
};

const executePublishForPost = async (post, effectiveTargets = {}, githubRepo = null) => {
  const result = {
    pandav: { status: 'none', message: null },
    linkedin: { status: 'none', message: null },
    github: { status: 'none', message: null },
  };

  if (effectiveTargets.pandav) {
    result.pandav = { status: 'published', message: 'Post is available in Pandav feed' };
    post.publishResults.pandav = { status: 'published', message: 'Post is available in Pandav feed', publishedAt: new Date() };
  }

  if (effectiveTargets.linkedin) {
    try {
      const linkedInIntegration = await SocialIntegration.findOne({ user: post.author._id, provider: 'linkedin' }).select('+accessToken');
      if (!linkedInIntegration || !linkedInIntegration.isConnected || !linkedInIntegration.accessToken) {
        throw new Error('LinkedIn account not linked for post author');
      }

      const linkedInPublish = await publishToLinkedIn(linkedInIntegration, post.content);
      result.linkedin = { status: 'published', externalId: linkedInPublish.externalId, message: 'Published to LinkedIn' };
      post.publishResults.linkedin = {
        status: 'published',
        externalId: linkedInPublish.externalId,
        message: 'Published to LinkedIn',
        publishedAt: new Date(),
      };
    } catch (error) {
      result.linkedin = { status: 'failed', message: error.message };
      post.publishResults.linkedin = { status: 'failed', message: error.message, publishedAt: null, externalId: null };
    }
  }

  if (effectiveTargets.github) {
    try {
      const githubIntegration = await SocialIntegration.findOne({ user: post.author._id, provider: 'github' }).select('+accessToken');
      if (!githubIntegration || !githubIntegration.isConnected || !githubIntegration.accessToken) {
        throw new Error('GitHub account not linked for post author');
      }

      const githubPublish = await publishToGithub(githubIntegration, post, githubRepo);
      result.github = { status: 'published', externalId: githubPublish.externalId, message: 'Published to GitHub' };
      post.publishResults.github = {
        status: 'published',
        externalId: githubPublish.externalId,
        message: 'Published to GitHub',
        publishedAt: new Date(),
      };
    } catch (error) {
      result.github = { status: 'failed', message: error.message };
      post.publishResults.github = { status: 'failed', message: error.message, publishedAt: null, externalId: null };
    }
  }

  await post.save();
  return result;
};

const autoGenerateLinkedInPostFromCompletedTask = async (task, user) => {
  if (!task.autoGenerateLinkedInPost) {
    return { skipped: true, reason: 'auto_generate_disabled' };
  }

  const existing = await SocialPost.findOne({
    author: user._id,
    sourceTask: task._id,
    'targets.linkedin': true,
  }).sort({ createdAt: -1 });

  if (existing) {
    task.lastAutoGeneratedPost = existing._id;
    task.autoPostStatus = existing.approvalStatus === 'pending' ? 'pending_approval' : 'already_generated';
    await task.save();
    return { skipped: true, reason: 'already_generated', postId: existing._id };
  }

  const content = buildTaskPostContent(task, user, { intro: 'Completed task' });
  const post = await SocialPost.create({
    author: user._id,
    sourceTask: task._id,
    title: `Task completed: ${task.title}`,
    content,
    tags: ['task', 'progress', 'auto-generated'],
    visibility: 'public',
    targets: { pandav: true, linkedin: true, github: false },
    approvalStatus: needsExternalApproval(user.role, { linkedin: true, github: false }) ? 'pending' : 'none',
  });

  task.lastAutoGeneratedPost = post._id;

  if (post.approvalStatus === 'pending') {
    task.autoPostStatus = 'pending_approval';
    await task.save();
    return { generated: true, postId: post._id, pendingApproval: true };
  }

  await post.populate('author', 'name role teamId');
  const publishResult = await executePublishForPost(post, { pandav: true, linkedin: true, github: false }, null);

  task.autoPostStatus = publishResult.linkedin.status === 'published' ? 'published' : 'failed';
  task.autoPostMessage = publishResult.linkedin.message || null;
  await task.save();

  return {
    generated: true,
    postId: post._id,
    pendingApproval: false,
    publishResult,
  };
};

export const createPost = async (req, res) => {
  try {
    const {
      title,
      content,
      mediaUrls = [],
      tags = [],
      visibility = 'public',
      targets = { pandav: true, linkedin: false, github: false },
      sourceTask = null,
    } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Post content is required' });
    }

    if (!ensureAtLeastOneTarget(targets)) {
      return res.status(400).json({ success: false, message: 'Select at least one target: pandav, linkedin, or github' });
    }

    const post = await SocialPost.create({
      author: req.user._id,
      sourceTask,
      title,
      content,
      mediaUrls,
      tags,
      visibility,
      targets: {
        pandav: Boolean(targets.pandav),
        linkedin: Boolean(targets.linkedin),
        github: Boolean(targets.github),
      },
      approvalStatus: needsExternalApproval(req.user.role, targets) ? 'pending' : 'none',
    });

    const populatedPost = await SocialPost.findById(post._id).populate('author', 'name email role profileImage teamId');
    await logAuditEventV2(req, {
      action: 'social_post_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: post.targets, visibility: post.visibility },
    });
    return res.status(201).json({ success: true, data: populatedPost });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const generatePostFromPersonalTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const {
      targets = { pandav: true, linkedin: false, github: false },
      visibility = 'public',
      intro = 'Completed task',
    } = req.body;

    if (!ensureAtLeastOneTarget(targets)) {
      return res.status(400).json({ success: false, message: 'Select at least one target: pandav, linkedin, or github' });
    }

    const task = await PersonalTask.findOne({ _id: taskId, user: req.user._id });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    if (task.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Only completed personal tasks can be generated as posts' });
    }

    const content = buildTaskPostContent(task, req.user, { intro });
    const title = `Task completed: ${task.title}`;

    const post = await SocialPost.create({
      author: req.user._id,
      sourceTask: task._id,
      title,
      content,
      tags: ['task', 'progress'],
      visibility,
      targets: {
        pandav: Boolean(targets.pandav),
        linkedin: Boolean(targets.linkedin),
        github: Boolean(targets.github),
      },
      approvalStatus: needsExternalApproval(req.user.role, targets) ? 'pending' : 'none',
    });

    const populatedPost = await SocialPost.findById(post._id)
      .populate('author', 'name email role profileImage teamId')
      .populate('sourceTask');

    await logAuditEventV2(req, {
      action: 'social_post_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: post.targets, visibility: post.visibility },
    });
    return res.status(201).json({ success: true, data: populatedPost });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getFeed = async (req, res) => {
  try {
    const posts = await SocialPost.find({ moderationStatus: { $ne: 'removed' } })
      .populate('author', 'name email role profileImage teamId')
      .populate('sourceTask')
      .sort({ createdAt: -1 })
      .limit(100);

    const visiblePosts = [];
    for (const post of posts) {
      const allowed = await canUserViewPost(post, req.user);
      if (allowed) visiblePosts.push(post);
    }

    return res.json({ success: true, count: visiblePosts.length, data: visiblePosts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyPosts = async (req, res) => {
  try {
    const posts = await SocialPost.find({ author: req.user._id })
      .populate('author', 'name email role profileImage teamId')
      .populate('sourceTask')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: posts.length, data: posts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await SocialPost.findById(postId).populate('author', 'teamId');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const allowed = await canUserViewPost(post, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not allowed to interact with this post' });
    }

    const userId = req.user._id.toString();
    const likeIndex = post.likes.findIndex((id) => id.toString() === userId);

    if (likeIndex >= 0) {
      post.likes.splice(likeIndex, 1);
    } else {
      post.likes.push(req.user._id);
    }

    await post.save();

    return res.json({
      success: true,
      liked: likeIndex < 0,
      likesCount: post.likes.length,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Comment text is required' });
    }

    const post = await SocialPost.findById(postId).populate('author', 'teamId');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const allowed = await canUserViewPost(post, req.user);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not allowed to interact with this post' });
    }

    post.comments.push({ user: req.user._id, text: text.trim() });
    await post.save();
    await post.populate('comments.user', 'name email role profileImage');

    return res.status(201).json({ success: true, data: post.comments[post.comments.length - 1] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const requestConnection = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Valid userId is required' });
    }

    if (req.user._id.toString() === userId.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot connect with yourself' });
    }

    const targetUser = await User.findById(userId).select('_id isActive');
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({ success: false, message: 'User not found or inactive' });
    }

    let connection = await NetworkConnection.findOne({ requester: req.user._id, recipient: userId });
    if (!connection) {
      connection = await NetworkConnection.findOne({ requester: userId, recipient: req.user._id });
      if (connection && connection.status === 'pending') {
        connection.status = 'accepted';
        connection.respondedAt = new Date();
        await connection.save();
        return res.json({ success: true, message: 'Connection accepted from existing request', data: connection });
      }
    }

    if (connection) {
      return res.status(409).json({ success: false, message: `Connection already ${connection.status}` });
    }

    const created = await NetworkConnection.create({ requester: req.user._id, recipient: userId });
    await logAuditEventV2(req, {
      action: 'network_connection_requested',
      targetType: 'NetworkConnectionV2',
      targetId: created._id,
      details: { recipient: userId },
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const respondConnection = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { action } = req.body;

    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be accepted or rejected' });
    }

    const connection = await NetworkConnection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection request not found' });
    }

    if (connection.recipient.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only recipient can respond to request' });
    }

    if (connection.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Request already ${connection.status}` });
    }

    connection.status = action;
    connection.respondedAt = new Date();
    await connection.save();

    return res.json({ success: true, data: connection });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getConnections = async (req, res) => {
  try {
    const [sent, received, connected] = await Promise.all([
      NetworkConnection.find({ requester: req.user._id, status: 'pending' }).populate('recipient', 'name email role profileImage'),
      NetworkConnection.find({ recipient: req.user._id, status: 'pending' }).populate('requester', 'name email role profileImage'),
      NetworkConnection.find({
        $or: [{ requester: req.user._id }, { recipient: req.user._id }],
        status: 'accepted',
      }).populate('requester recipient', 'name email role profileImage'),
    ]);

    return res.json({
      success: true,
      data: {
        pendingSent: sent,
        pendingReceived: received,
        connected,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const hasAcceptedConnection = async (currentUserId, targetUserId) => {
  const connection = await NetworkConnection.findOne({
    $or: [
      { requester: currentUserId, recipient: targetUserId, status: 'accepted' },
      { requester: targetUserId, recipient: currentUserId, status: 'accepted' },
    ],
  }).lean();

  return Boolean(connection);
};

export const sendNetworkMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;

    if (!receiverId || !message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'receiverId and message are required' });
    }

    const isConnected = await hasAcceptedConnection(req.user._id, receiverId);
    const canBypass = req.user.role === 'admin' || req.user.role === 'team_leader';

    if (!isConnected && !canBypass) {
      return res.status(403).json({ success: false, message: 'Connect with this user before messaging' });
    }

    const newMessage = await Chat.create({
      sender: req.user._id,
      receiver: receiverId,
      message: message.trim(),
    });

    await newMessage.populate('sender receiver', 'name email role profileImage');

    const io = req.app.get('io');
    if (io) {
      io.to(receiverId.toString()).emit('receive_message', newMessage);
    }

    await logAuditEventV2(req, {
      action: 'network_message_sent',
      targetType: 'Chat',
      targetId: newMessage._id,
      details: { receiverId },
    });
    return res.status(201).json({ success: true, data: newMessage });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getNetworkMessages = async (req, res) => {
  try {
    const { userId } = req.params;

    const isConnected = await hasAcceptedConnection(req.user._id, userId);
    const canBypass = req.user.role === 'admin' || req.user.role === 'team_leader' || req.user._id.toString() === userId;

    if (!isConnected && !canBypass) {
      return res.status(403).json({ success: false, message: 'Connect with this user before viewing messages' });
    }

    const messages = await Chat.find({
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id },
      ],
    })
      .populate('sender receiver', 'name email role profileImage')
      .sort({ timestamp: 1 });

    return res.json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const discoverUsers = async (req, res) => {
  try {
    const { q = '' } = req.query;
    const filter = {
      _id: { $ne: req.user._id },
      isActive: true,
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
    };

    const users = await User.find(filter)
      .select('name email role profileImage teamId department')
      .limit(30)
      .sort({ name: 1 });

    return res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approvePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { action = 'approved' } = req.body;

    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be approved or rejected' });
    }

    const post = await SocialPost.findById(postId).populate('author', 'teamId');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.approvalStatus !== 'pending') {
      return res.status(409).json({ success: false, message: `Post approval is ${post.approvalStatus}` });
    }

    if (req.user.role !== 'admin') {
      const sameTeam = post.author.teamId && req.user.teamId && post.author.teamId.toString() === req.user.teamId.toString();
      const isLeader = req.user.role === 'team_leader' && sameTeam;
      if (!isLeader) {
        return res.status(403).json({ success: false, message: 'Only admin or same-team leader can approve' });
      }
    }

    post.approvalStatus = action;
    post.approvedBy = req.user._id;
    post.approvedAt = new Date();
    await post.save();

    await logAuditEventV2(req, {
      action: 'social_post_approval_updated',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { action },
    });
    return res.json({ success: true, data: post });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPersonalTask = async (req, res) => {
  try {
    const { title, description = '', priority = 'medium', dueDate = null, autoGenerateLinkedInPost = true } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }

    const task = await PersonalTask.create({
      user: req.user._id,
      title: title.trim(),
      description: description.trim(),
      priority,
      dueDate,
      autoGenerateLinkedInPost: Boolean(autoGenerateLinkedInPost),
    });

    await logAuditEventV2(req, {
      action: 'personal_task_created',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
      details: { priority, dueDate },
    });
    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPersonalTasks = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const tasks = await PersonalTask.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePersonalTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = { ...req.body };

    if (typeof updates.title === 'string') updates.title = updates.title.trim();
    if (typeof updates.description === 'string') updates.description = updates.description.trim();

    const existingTask = await PersonalTask.findOne({ _id: taskId, user: req.user._id });
    if (!existingTask) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    if (updates.status === 'completed') {
      updates.completedAt = new Date();
    }

    if (updates.status && updates.status !== 'completed') {
      updates.completedAt = null;
    }

    const task = await PersonalTask.findOneAndUpdate(
      { _id: taskId, user: req.user._id },
      updates,
      { new: true, runValidators: true },
    );

    const transitionedToCompleted = existingTask.status !== 'completed' && task.status === 'completed';
    let autoShare = null;

    if (transitionedToCompleted) {
      autoShare = await autoGenerateLinkedInPostFromCompletedTask(task, req.user);
    }

    await logAuditEventV2(req, {
      action: 'personal_task_updated',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
      details: { status: task.status },
    });
    return res.json({ success: true, data: task, autoShare });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePersonalTaskComplete = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await PersonalTask.findOne({ _id: taskId, user: req.user._id });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    const nextCompleted = task.status !== 'completed';
    task.status = nextCompleted ? 'completed' : 'todo';
    task.completedAt = nextCompleted ? new Date() : null;

    await task.save();

    let autoShare = null;
    if (nextCompleted) {
      autoShare = await autoGenerateLinkedInPostFromCompletedTask(task, req.user);
    }

    await logAuditEventV2(req, {
      action: 'personal_task_updated',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
      details: { status: task.status },
    });
    return res.json({ success: true, data: task, autoShare });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePersonalTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await PersonalTask.findOneAndDelete({ _id: taskId, user: req.user._id });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    await logAuditEventV2(req, {
      action: 'personal_task_deleted',
      targetType: 'PersonalTaskV2',
      targetId: task._id,
    });
    return res.json({ success: true, message: 'Personal task deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const linkProviderAccount = async (req, res) => {
  try {
    const { provider } = req.params;
    const { accessToken, refreshToken = null, tokenExpiresAt = null, scopes = [] } = req.body;

    if (!['linkedin', 'github'].includes(provider)) {
      return res.status(400).json({ success: false, message: 'provider must be linkedin or github' });
    }

    if (!accessToken || !String(accessToken).trim()) {
      return res.status(400).json({ success: false, message: 'accessToken is required' });
    }

    const profile = provider === 'linkedin'
      ? await fetchLinkedInProfile(accessToken)
      : await fetchGithubProfile(accessToken);

    const integration = await SocialIntegration.findOneAndUpdate(
      { user: req.user._id, provider },
      {
        user: req.user._id,
        provider,
        providerUserId: profile.providerUserId,
        accountHandle: profile.accountHandle,
        isConnected: true,
        scopes,
        accessToken: String(accessToken).trim(),
        refreshToken: refreshToken ? String(refreshToken).trim() : null,
        tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
        connectedAt: new Date(),
        accessTokenHint: `${provider}-token-configured`,
        metadata: profile.metadata || {},
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).select('-accessToken -refreshToken');

    await logAuditEventV2(req, {
      action: 'social_integration_linked',
      targetType: 'SocialIntegrationV2',
      targetId: integration._id,
      details: { provider },
    });
    return res.json({ success: true, data: integration });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getSocialIntegrations = async (req, res) => {
  try {
    const integrations = await SocialIntegration.find({ user: req.user._id })
      .select('-accessToken -refreshToken')
      .sort({ provider: 1 });

    return res.json({ success: true, count: integrations.length, data: integrations });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getProviderProfile = async (req, res) => {
  try {
    const { provider } = req.params;
    if (!['linkedin', 'github'].includes(provider)) {
      return res.status(400).json({ success: false, message: 'provider must be linkedin or github' });
    }

    const integration = await SocialIntegration.findOne({ user: req.user._id, provider }).select('+accessToken');
    if (!integration || !integration.isConnected || !integration.accessToken) {
      return res.status(404).json({ success: false, message: `${provider} account is not linked` });
    }

    const profile = provider === 'linkedin'
      ? await fetchLinkedInProfile(integration.accessToken)
      : await fetchGithubProfile(integration.accessToken);

    return res.json({ success: true, data: profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const fetchProviderPosts = async (req, res) => {
  try {
    const { provider } = req.params;
    if (!['linkedin', 'github'].includes(provider)) {
      return res.status(400).json({ success: false, message: 'provider must be linkedin or github' });
    }

    const integration = await SocialIntegration.findOne({ user: req.user._id, provider }).select('+accessToken');
    if (!integration || !integration.isConnected || !integration.accessToken) {
      return res.status(404).json({ success: false, message: `${provider} account is not linked` });
    }

    const posts = provider === 'linkedin'
      ? await fetchLinkedInPosts(integration.accessToken, integration.providerUserId)
      : await fetchGithubPosts(integration.accessToken, integration.accountHandle);

    return res.json({ success: true, provider, count: posts.length, data: posts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const publishPostToTargets = async (req, res) => {
  try {
    const { postId } = req.params;
    const { targets = null, githubRepo = null } = req.body;

    const post = await SocialPost.findById(postId).populate('author', 'name role teamId');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const isOwner = post.author._id.toString() === req.user._id.toString();
    const canManage = req.user.role === 'admin' || req.user.role === 'team_leader';
    if (!isOwner && !canManage) {
      return res.status(403).json({ success: false, message: 'Not allowed to publish this post' });
    }

    if (post.approvalStatus === 'pending') {
      return res.status(409).json({ success: false, message: 'Post is pending approval before external publish' });
    }

    if (post.approvalStatus === 'rejected') {
      return res.status(409).json({ success: false, message: 'Post approval was rejected for external publish' });
    }

    const effectiveTargets = targets || post.targets;
    if (!ensureAtLeastOneTarget(effectiveTargets)) {
      return res.status(400).json({ success: false, message: 'At least one target is required' });
    }

    const result = await executePublishForPost(post, effectiveTargets, githubRepo);

    await logAuditEventV2(req, {
      action: 'social_post_publish_triggered',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { targets: effectiveTargets },
    });
    return res.json({
      success: true,
      postId: post._id,
      approvalStatus: post.approvalStatus,
      targets: effectiveTargets,
      result,
      publishedAt: toIso(new Date()),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};











const getOAuthConfig = (provider) => {
  if (provider === 'github') {
    return {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      redirectUri: process.env.GITHUB_REDIRECT_URI,
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scope: process.env.GITHUB_OAUTH_SCOPE || 'read:user user:email public_repo',
    };
  }

  return {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: process.env.LINKEDIN_REDIRECT_URI,
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scope: process.env.LINKEDIN_OAUTH_SCOPE || 'openid profile email w_member_social',
  };
};

const verifyOAuthConfig = (provider) => {
  const cfg = getOAuthConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    throw new Error(`${provider} OAuth env vars are missing`);
  }
  return cfg;
};

const signOAuthState = (provider, userId) => {
  return jwt.sign(
    { provider, userId: String(userId), type: 'social-oauth-state' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
};

const decodeOAuthState = (state) => {
  return jwt.verify(state, process.env.JWT_SECRET);
};

const exchangeGithubCodeForToken = async (code, cfg) => {
  const response = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
    }),
  });

  const data = await safeJson(response);
  if (!response.ok || data?.error) {
    throw new Error(data?.error_description || data?.error || 'GitHub OAuth token exchange failed');
  }

  return {
    accessToken: data.access_token,
    scope: data.scope ? String(data.scope).split(',').filter(Boolean) : [],
    tokenType: data.token_type || null,
  };
};

const exchangeLinkedInCodeForToken = async (code, cfg) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const response = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await safeJson(response);
  if (!response.ok || data?.error) {
    throw new Error(data?.error_description || data?.error || 'LinkedIn OAuth token exchange failed');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || null,
    scope: cfg.scope ? String(cfg.scope).split(' ').filter(Boolean) : [],
  };
};

const canManagePostPublish = (user, post) => {
  const isOwner = post.author._id.toString() === user._id.toString();
  const canManage = user.role === 'admin' || user.role === 'team_leader';
  return isOwner || canManage;
};

const runPublishJob = async (job) => {
  job.status = 'processing';
  job.startedAt = new Date();
  job.attempts += 1;
  await job.save();

  const post = await SocialPost.findById(job.post).populate('author', 'name role teamId');
  if (!post) {
    job.status = 'failed';
    job.lastError = 'Post not found';
    job.completedAt = new Date();
    await job.save();
    return { success: false, error: job.lastError };
  }

  if (post.approvalStatus === 'pending' || post.approvalStatus === 'rejected') {
    job.status = 'failed';
    job.lastError = `Post approval status is ${post.approvalStatus}`;
    job.completedAt = new Date();
    await job.save();
    return { success: false, error: job.lastError };
  }

  try {
    let publishResult = null;

    if (job.provider === 'linkedin') {
      const integration = await SocialIntegration.findOne({ user: post.author._id, provider: 'linkedin' }).select('+accessToken');
      if (!integration || !integration.isConnected || !integration.accessToken) {
        throw new Error('LinkedIn account not linked for post author');
      }
      publishResult = await publishToLinkedIn(integration, post.content);
      post.publishResults.linkedin = {
        status: 'published',
        externalId: publishResult.externalId,
        message: 'Published to LinkedIn',
        publishedAt: new Date(),
      };
    }

    if (job.provider === 'github') {
      const integration = await SocialIntegration.findOne({ user: post.author._id, provider: 'github' }).select('+accessToken');
      if (!integration || !integration.isConnected || !integration.accessToken) {
        throw new Error('GitHub account not linked for post author');
      }
      publishResult = await publishToGithub(integration, post, job.payload?.githubRepo || null);
      post.publishResults.github = {
        status: 'published',
        externalId: publishResult.externalId,
        message: 'Published to GitHub',
        publishedAt: new Date(),
      };
    }

    await post.save();

    job.status = 'completed';
    job.lastError = null;
    job.result = publishResult;
    job.completedAt = new Date();
    await job.save();

    return { success: true, result: publishResult, post };
  } catch (error) {
    const backoffMinutes = Math.min(2 ** job.attempts, 60);

    job.lastError = error.message;
    job.status = job.attempts >= job.maxAttempts ? 'failed' : 'queued';
    job.nextRetryAt = job.status === 'queued' ? new Date(Date.now() + backoffMinutes * 60 * 1000) : null;
    job.completedAt = job.status === 'failed' ? new Date() : null;
    await job.save();

    if (job.provider === 'linkedin') {
      const post = await SocialPost.findById(job.post);
      if (post) {
        post.publishResults.linkedin = {
          status: 'failed',
          externalId: null,
          message: error.message,
          publishedAt: null,
        };
        await post.save();
      }
    }

    if (job.provider === 'github') {
      const post = await SocialPost.findById(job.post);
      if (post) {
        post.publishResults.github = {
          status: 'failed',
          externalId: null,
          message: error.message,
          publishedAt: null,
        };
        await post.save();
      }
    }

    return { success: false, error: error.message };
  }
};

export const getProviderOAuthStart = async (req, res) => {
  try {
    const { provider } = req.params;

    if (!['linkedin', 'github'].includes(provider)) {
      return res.status(400).json({ success: false, message: 'provider must be linkedin or github' });
    }

    const cfg = verifyOAuthConfig(provider);
    const state = signOAuthState(provider, req.user._id);

    let authUrl = '';
    if (provider === 'github') {
      authUrl = `${cfg.authUrl}?client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&scope=${encodeURIComponent(cfg.scope)}&state=${encodeURIComponent(state)}`;
    } else {
      authUrl = `${cfg.authUrl}?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(cfg.scope)}`;
    }

    return res.json({ success: true, data: { provider, authUrl, state, redirectUri: cfg.redirectUri } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const completeProviderOAuth = async (req, res) => {
  try {
    const { provider } = req.params;
    const { code, state } = req.body;

    if (!['linkedin', 'github'].includes(provider)) {
      return res.status(400).json({ success: false, message: 'provider must be linkedin or github' });
    }

    if (!code || !state) {
      return res.status(400).json({ success: false, message: 'code and state are required' });
    }

    const statePayload = decodeOAuthState(state);
    if (statePayload.provider !== provider || statePayload.userId !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Invalid OAuth state' });
    }

    const cfg = verifyOAuthConfig(provider);

    const tokenData = provider === 'github'
      ? await exchangeGithubCodeForToken(code, cfg)
      : await exchangeLinkedInCodeForToken(code, cfg);

    const profile = provider === 'github'
      ? await fetchGithubProfile(tokenData.accessToken)
      : await fetchLinkedInProfile(tokenData.accessToken);

    const tokenExpiresAt = tokenData.expiresIn ? new Date(Date.now() + Number(tokenData.expiresIn) * 1000) : null;

    const integration = await SocialIntegration.findOneAndUpdate(
      { user: req.user._id, provider },
      {
        user: req.user._id,
        provider,
        providerUserId: profile.providerUserId,
        accountHandle: profile.accountHandle,
        isConnected: true,
        scopes: tokenData.scope || [],
        accessToken: String(tokenData.accessToken).trim(),
        refreshToken: tokenData.refreshToken ? String(tokenData.refreshToken).trim() : null,
        tokenExpiresAt,
        connectedAt: new Date(),
        accessTokenHint: `${provider}-oauth-token-configured`,
        metadata: profile.metadata || {},
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).select('-accessToken -refreshToken');

    await logAuditEventV2(req, {
      action: 'social_oauth_completed',
      targetType: 'SocialIntegrationV2',
      targetId: integration._id,
      details: { provider },
    });

    return res.json({ success: true, data: integration });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPublishJobs = async (req, res) => {
  try {
    const { postId } = req.params;
    const { targets = null, githubRepo = null, maxAttempts = 3 } = req.body || {};

    const post = await SocialPost.findById(postId).populate('author', 'name role teamId');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (!canManagePostPublish(req.user, post)) {
      return res.status(403).json({ success: false, message: 'Not allowed to queue publish jobs for this post' });
    }

    if (post.approvalStatus === 'pending' || post.approvalStatus === 'rejected') {
      return res.status(409).json({ success: false, message: `Post approval status is ${post.approvalStatus}` });
    }

    const effectiveTargets = targets || post.targets;
    const providers = ['linkedin', 'github'].filter((provider) => Boolean(effectiveTargets[provider]));

    if (providers.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one external target (linkedin/github) is required' });
    }

    const jobs = [];

    for (const provider of providers) {
      const existing = await SocialPublishJobV2.findOne({
        owner: post.author._id,
        post: post._id,
        provider,
        status: { $in: ['queued', 'processing'] },
      }).sort({ createdAt: -1 });

      if (existing) {
        jobs.push(existing);
        continue;
      }

      const job = await SocialPublishJobV2.create({
        owner: post.author._id,
        post: post._id,
        provider,
        status: 'queued',
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(10, Number(maxAttempts) || 3)),
        nextRetryAt: new Date(),
        payload: { githubRepo: githubRepo || null },
      });

      jobs.push(job);
    }

    await logAuditEventV2(req, {
      action: 'social_publish_jobs_created',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { providers },
    });

    return res.status(201).json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPublishJobs = async (req, res) => {
  try {
    const { status, provider } = req.query;

    const filter = req.user.role === 'admin'
      ? {}
      : { owner: req.user._id };

    if (status) filter.status = status;
    if (provider) filter.provider = provider;

    const jobs = await SocialPublishJobV2.find(filter)
      .populate('post', 'title content approvalStatus targets publishResults')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const processPublishJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await SocialPublishJobV2.findById(jobId).populate('post', 'author');
    if (!job) {
      return res.status(404).json({ success: false, message: 'Publish job not found' });
    }

    const isOwner = job.owner.toString() === req.user._id.toString();
    const canManage = req.user.role === 'admin' || req.user.role === 'team_leader';
    if (!isOwner && !canManage) {
      return res.status(403).json({ success: false, message: 'Not allowed to process this job' });
    }

    if (job.status === 'completed') {
      return res.json({ success: true, message: 'Job already completed', data: job });
    }

    const runResult = await runPublishJob(job);

    await logAuditEventV2(req, {
      action: 'social_publish_job_processed',
      targetType: 'SocialPublishJobV2',
      targetId: job._id,
      status: runResult.success ? 'success' : 'failed',
      details: { provider: job.provider, error: runResult.error || null },
    });

    const refreshed = await SocialPublishJobV2.findById(job._id);
    return res.json({ success: runResult.success, data: refreshed, error: runResult.error || null });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const retryPublishJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await SocialPublishJobV2.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Publish job not found' });
    }

    const isOwner = job.owner.toString() === req.user._id.toString();
    const canManage = req.user.role === 'admin' || req.user.role === 'team_leader';
    if (!isOwner && !canManage) {
      return res.status(403).json({ success: false, message: 'Not allowed to retry this job' });
    }

    job.status = 'queued';
    job.nextRetryAt = new Date();
    job.completedAt = null;
    job.lastError = null;
    await job.save();

    await logAuditEventV2(req, {
      action: 'social_publish_job_retried',
      targetType: 'SocialPublishJobV2',
      targetId: job._id,
      details: { provider: job.provider },
    });

    return res.json({ success: true, data: job });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const processDuePublishJobs = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can process due jobs' });
    }

    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));

    const dueJobs = await SocialPublishJobV2.find({
      status: 'queued',
      nextRetryAt: { $lte: new Date() },
    })
      .sort({ nextRetryAt: 1 })
      .limit(limit);

    const outcomes = [];

    for (const job of dueJobs) {
      const result = await runPublishJob(job);
      outcomes.push({ jobId: job._id, success: result.success, error: result.error || null });
    }

    await logAuditEventV2(req, {
      action: 'social_publish_due_jobs_processed',
      targetType: 'SocialPublishJobV2',
      details: { processed: outcomes.length },
    });

    return res.json({ success: true, count: outcomes.length, data: outcomes });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const getModerationPosts = async (req, res) => {
  try {
    const { status = 'all', owner = null } = req.query;
    const filter = {};

    if (status !== 'all') {
      filter.moderationStatus = status;
    }

    if (owner && mongoose.Types.ObjectId.isValid(owner)) {
      filter.author = owner;
    }

    const posts = await SocialPost.find(filter)
      .populate('author', 'name email role profileImage')
      .populate('moderatedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ success: true, count: posts.length, data: posts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const moderatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { action, reason = null } = req.body;

    const post = await SocialPost.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (action === 'flag') post.moderationStatus = 'flagged';
    if (action === 'unflag') post.moderationStatus = 'clean';
    if (action === 'hide') post.moderationStatus = 'hidden';
    if (action === 'unhide') post.moderationStatus = 'clean';
    if (action === 'remove') post.moderationStatus = 'removed';
    if (action === 'restore') post.moderationStatus = 'clean';

    post.moderationReason = reason ? String(reason).trim() : null;
    post.moderatedBy = req.user._id;
    post.moderatedAt = new Date();

    await post.save();

    await logAuditEventV2(req, {
      action: 'social_post_moderated',
      targetType: 'SocialPostV2',
      targetId: post._id,
      details: { moderationAction: action, moderationStatus: post.moderationStatus, reason: post.moderationReason },
    });

    return res.json({ success: true, data: post });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
