import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  validateProviderParam,
  validateCreatePost,
  validateUpdatePost,
  validatePostFromTask,
  validatePostComment,
  validateConnectionRequest,
  validateConnectionResponse,
  validateNetworkMessage,
  validatePersonalTaskCreate,
  validatePersonalTaskUpdate,
  validateIntegrationsLink,
  validatePublishRequest,
  validateOAuthCallback,
  validateCreatePublishJobs,
  validateModerationUpdate,
} from '../middleware/validateV2.js';
import {
  socialWriteRateLimiter,
  directMessageRateLimiter,
  socialIntegrationRateLimiter,
} from '../middleware/rateLimitV2.js';
import {
  createPost,
  generatePostFromPersonalTask,
  getFeed,
  getPost,
  getMyPosts,
  getPendingApprovalPosts,
  updatePost,
  deletePost,
  toggleLike,
  addComment,
  deleteComment,
  requestConnection,
  respondConnection,
  removeConnection,
  getConnections,
  sendNetworkMessage,
  getNetworkMessages,
  discoverUsers,
  approvePost,
  createPersonalTask,
  getPersonalTasks,
  updatePersonalTask,
  togglePersonalTaskComplete,
  sharePersonalTask,
  deletePersonalTask,
  linkProviderAccount,
  getSocialIntegrations,
  unlinkProviderAccount,
  getProviderProfile,
  fetchProviderPosts,
  publishPostToTargets,
  getProviderOAuthStart,
  completeProviderOAuth,
  createPublishJobs,
  getPublishJobs,
  processPublishJob,
  retryPublishJob,
  processDuePublishJobs,
  getModerationPosts,
  moderatePost,
} from '../controllers/socialV2Controller.js';

const router = express.Router();

router.use(protect);

router.get('/feed', getFeed);
router.get('/posts/me', getMyPosts);
router.get('/posts/pending-approval', authorize('admin', 'team_leader'), getPendingApprovalPosts);
router.post('/posts', socialWriteRateLimiter, validateCreatePost, createPost);
router.post('/posts/from-task/:taskId', socialWriteRateLimiter, validatePostFromTask, generatePostFromPersonalTask);
router.get('/posts/:postId', getPost);
router.patch('/posts/:postId', socialWriteRateLimiter, validateUpdatePost, updatePost);
router.delete('/posts/:postId', socialWriteRateLimiter, deletePost);
router.post('/posts/:postId/like', socialWriteRateLimiter, toggleLike);
router.post('/posts/:postId/comments', socialWriteRateLimiter, validatePostComment, addComment);
router.delete('/posts/:postId/comments/:commentId', socialWriteRateLimiter, deleteComment);
router.post('/posts/:postId/publish', socialWriteRateLimiter, validatePublishRequest, publishPostToTargets);
router.patch('/posts/:postId/approve', socialWriteRateLimiter, authorize('admin', 'team_leader'), approvePost);

router.post('/posts/:postId/publish/jobs', socialWriteRateLimiter, validateCreatePublishJobs, createPublishJobs);
router.get('/publish-jobs', getPublishJobs);
router.post('/publish-jobs/:jobId/process', socialWriteRateLimiter, processPublishJob);
router.post('/publish-jobs/:jobId/retry', socialWriteRateLimiter, retryPublishJob);
router.post('/publish-jobs/process-due', socialWriteRateLimiter, processDuePublishJobs);

router.get('/moderation/posts', authorize('admin'), getModerationPosts);
router.patch('/moderation/posts/:postId', socialWriteRateLimiter, authorize('admin'), validateModerationUpdate, moderatePost);

router.get('/users/discover', discoverUsers);

router.post('/connections/request', socialWriteRateLimiter, validateConnectionRequest, requestConnection);
router.patch('/connections/:connectionId/respond', socialWriteRateLimiter, validateConnectionResponse, respondConnection);
router.delete('/connections/:connectionId', socialWriteRateLimiter, removeConnection);
router.get('/connections', getConnections);

router.post('/messages', directMessageRateLimiter, validateNetworkMessage, sendNetworkMessage);
router.get('/messages/:userId', getNetworkMessages);

router.post('/personal-tasks', socialWriteRateLimiter, validatePersonalTaskCreate, createPersonalTask);
router.get('/personal-tasks', getPersonalTasks);
router.patch('/personal-tasks/:taskId', socialWriteRateLimiter, validatePersonalTaskUpdate, updatePersonalTask);
router.patch('/personal-tasks/:taskId/toggle-complete', socialWriteRateLimiter, togglePersonalTaskComplete);
router.post('/personal-tasks/:taskId/share', socialWriteRateLimiter, sharePersonalTask);
router.delete('/personal-tasks/:taskId', socialWriteRateLimiter, deletePersonalTask);

router.post('/integrations/:provider/link', socialIntegrationRateLimiter, validateProviderParam, validateIntegrationsLink, linkProviderAccount);
router.get('/integrations', getSocialIntegrations);
router.delete('/integrations/:provider', socialIntegrationRateLimiter, validateProviderParam, unlinkProviderAccount);
router.get('/integrations/:provider/profile', validateProviderParam, getProviderProfile);
router.get('/integrations/:provider/posts', validateProviderParam, fetchProviderPosts);

router.get('/integrations/:provider/oauth/start', socialIntegrationRateLimiter, validateProviderParam, getProviderOAuthStart);
router.post('/integrations/:provider/oauth/callback', socialIntegrationRateLimiter, validateProviderParam, validateOAuthCallback, completeProviderOAuth);

export default router;
