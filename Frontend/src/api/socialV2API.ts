import api from './axios'

type TargetPayload = {
  pandav?: boolean
  linkedin?: boolean
  github?: boolean
}

type PostPayload = {
  title?: string
  content: string
  visibility?: 'public' | 'team' | 'connections'
  tags?: string[]
  mediaUrls?: string[]
  targets?: TargetPayload
}

type PersonalTaskPayload = {
  title: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
  dueDate?: string | null
  autoGenerateLinkedInPost?: boolean
}

export const socialV2API = {
  getFeed: async () => (await api.get('/social/feed')).data,
  getMyPosts: async () => (await api.get('/social/posts/me')).data,
  createPost: async (payload: PostPayload) => (await api.post('/social/posts', payload)).data,
  likePost: async (postId: string) => (await api.post(`/social/posts/${postId}/like`)).data,
  addComment: async (postId: string, text: string) =>
    (await api.post(`/social/posts/${postId}/comments`, { text })).data,
  publishPost: async (postId: string, payload: { targets?: TargetPayload; githubRepo?: string | null }) =>
    (await api.post(`/social/posts/${postId}/publish`, payload)).data,
  approvePost: async (postId: string, action: 'approved' | 'rejected') =>
    (await api.patch(`/social/posts/${postId}/approve`, { action })).data,

  getPersonalTasks: async () => (await api.get('/social/personal-tasks')).data,
  createPersonalTask: async (payload: PersonalTaskPayload) =>
    (await api.post('/social/personal-tasks', payload)).data,
  updatePersonalTask: async (taskId: string, payload: Partial<PersonalTaskPayload> & { status?: string }) =>
    (await api.patch(`/social/personal-tasks/${taskId}`, payload)).data,
  togglePersonalTask: async (taskId: string) =>
    (await api.patch(`/social/personal-tasks/${taskId}/toggle-complete`)).data,
  deletePersonalTask: async (taskId: string) =>
    (await api.delete(`/social/personal-tasks/${taskId}`)).data,

  discoverUsers: async (query = '') =>
    (await api.get('/social/users/discover', { params: { q: query } })).data,
  getConnections: async () => (await api.get('/social/connections')).data,
  requestConnection: async (userId: string) =>
    (await api.post('/social/connections/request', { userId })).data,
  respondConnection: async (connectionId: string, action: 'accepted' | 'rejected') =>
    (await api.patch(`/social/connections/${connectionId}/respond`, { action })).data,

  getIntegrations: async () => (await api.get('/social/integrations')).data,
  linkProvider: async (
    provider: 'linkedin' | 'github',
    payload: { accessToken: string; refreshToken?: string; tokenExpiresAt?: string; scopes?: string[] },
  ) => (await api.post(`/social/integrations/${provider}/link`, payload)).data,
  getProviderProfile: async (provider: 'linkedin' | 'github') =>
    (await api.get(`/social/integrations/${provider}/profile`)).data,
  getProviderPosts: async (provider: 'linkedin' | 'github') =>
    (await api.get(`/social/integrations/${provider}/posts`)).data,

  getPublishJobs: async () => (await api.get('/social/publish-jobs')).data,
  createPublishJobs: async (
    postId: string,
    payload: { targets?: TargetPayload; githubRepo?: string | null; maxAttempts?: number },
  ) => (await api.post(`/social/posts/${postId}/publish/jobs`, payload)).data,
  processPublishJob: async (jobId: string) =>
    (await api.post(`/social/publish-jobs/${jobId}/process`)).data,
  retryPublishJob: async (jobId: string) =>
    (await api.post(`/social/publish-jobs/${jobId}/retry`)).data,
  processDuePublishJobs: async (limit = 10) =>
    (await api.post('/social/publish-jobs/process-due', null, { params: { limit } })).data,

  getModerationPosts: async (status = 'all') =>
    (await api.get('/social/moderation/posts', { params: { status } })).data,
  moderatePost: async (postId: string, action: string, reason?: string) =>
    (await api.patch(`/social/moderation/posts/${postId}`, { action, reason })).data,
}

