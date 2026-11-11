import api, { apiBaseUrl } from './axios'

type TargetPayload = {
  pandav?: boolean
  linkedin?: boolean
  github?: boolean
}

type Visibility = 'public' | 'team' | 'connections'

type PostPayload = {
  title?: string
  content: string
  visibility?: Visibility
  tags?: string[]
  mediaUrls?: string[]
  targets?: TargetPayload
  // Uploaded images (uploadImage), in the order they show
  images?: Array<{ id: string; altText?: string }>
  // Post it to LinkedIn without pressing publish: at publishAt (ISO), or now
  autoPublish?: boolean
  publishAt?: string | null
}

// Only the fields sent change; `title: null` removes the title
type PostUpdatePayload = {
  title?: string | null
  content?: string
  visibility?: Visibility
  tags?: string[]
  mediaUrls?: string[]
}

type PersonalTaskPayload = {
  title: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
  dueDate?: string | null
  autoGenerateLinkedInPost?: boolean
}

type PersonalTaskUpdate = Partial<PersonalTaskPayload> & { status?: 'todo' | 'in_progress' | 'completed' }

export type Provider = 'linkedin' | 'github'

export type ModerationAction = 'flag' | 'unflag' | 'hide' | 'unhide' | 'remove' | 'restore'

// Which reported chat messages to list: those nobody has dealt with, those an admin marked as handled, or both
export type ReportStatus = 'open' | 'resolved' | 'all'

export const socialV2API = {
  // Newest posts first. Pass the `next` cursor of the previous page
  // ({ before, beforeId }) to load the posts before it.
  getFeed: async (before?: string, beforeId?: string) =>
    (await api.get('/social/feed', { params: { before, beforeId: before ? beforeId : undefined } })).data,
  getMyPosts: async () => (await api.get('/social/posts/me')).data,
  getPost: async (postId: string) => (await api.get(`/social/posts/${postId}`)).data,
  getPendingApprovalPosts: async () => (await api.get('/social/posts/pending-approval')).data,
  createPost: async (payload: PostPayload) => (await api.post('/social/posts', payload)).data,
  updatePost: async (postId: string, payload: PostUpdatePayload) =>
    (await api.patch(`/social/posts/${postId}`, payload)).data,
  deletePost: async (postId: string) => (await api.delete(`/social/posts/${postId}`)).data,
  likePost: async (postId: string) => (await api.post(`/social/posts/${postId}/like`)).data,
  addComment: async (postId: string, text: string) =>
    (await api.post(`/social/posts/${postId}/comments`, { text })).data,
  deleteComment: async (postId: string, commentId: string) =>
    (await api.delete(`/social/posts/${postId}/comments/${commentId}`)).data,
  // An image for a post that isn't created yet: PNG, JPEG or GIF, base64
  uploadImage: async (payload: { type: string; data: string; altText?: string }) =>
    (await api.post('/social/images', payload)).data,
  deleteImage: async (imageId: string) => (await api.delete(`/social/images/${imageId}`)).data,
  // Sends the post to LinkedIn at publishAt, or now when it is null; or stops that
  schedulePost: async (postId: string, publishAt: string | null) =>
    (await api.put(`/social/posts/${postId}/schedule`, { publishAt })).data,
  unschedulePost: async (postId: string) => (await api.delete(`/social/posts/${postId}/schedule`)).data,
  publishPost: async (postId: string, payload: { targets?: TargetPayload; githubRepo?: string | null }) =>
    (await api.post(`/social/posts/${postId}/publish`, payload)).data,
  approvePost: async (postId: string, action: 'approved' | 'rejected') =>
    (await api.patch(`/social/posts/${postId}/approve`, { action })).data,

  getPersonalTasks: async () => (await api.get('/social/personal-tasks')).data,
  createPersonalTask: async (payload: PersonalTaskPayload) =>
    (await api.post('/social/personal-tasks', payload)).data,
  updatePersonalTask: async (taskId: string, payload: PersonalTaskUpdate) =>
    (await api.patch(`/social/personal-tasks/${taskId}`, payload)).data,
  togglePersonalTask: async (taskId: string) =>
    (await api.patch(`/social/personal-tasks/${taskId}/toggle-complete`)).data,
  // Posts a completed task after its owner reviewed the draft
  sharePersonalTask: async (taskId: string, payload: { content?: string; linkedin?: boolean }) =>
    (await api.post(`/social/personal-tasks/${taskId}/share`, payload)).data,
  deletePersonalTask: async (taskId: string) =>
    (await api.delete(`/social/personal-tasks/${taskId}`)).data,

  // Without a query: teammates to connect with. A query needs 2 characters or more.
  discoverUsers: async (query = '') =>
    (await api.get('/social/users/discover', { params: { q: query.trim() || undefined } })).data,
  getConnections: async () => (await api.get('/social/connections')).data,
  requestConnection: async (userId: string) =>
    (await api.post('/social/connections/request', { userId })).data,
  respondConnection: async (connectionId: string, action: 'accepted' | 'rejected') =>
    (await api.patch(`/social/connections/${connectionId}/respond`, { action })).data,
  // Withdraws a request you sent, or removes an accepted connection
  deleteConnection: async (connectionId: string) =>
    (await api.delete(`/social/connections/${connectionId}`)).data,

  getIntegrations: async () => (await api.get('/social/integrations')).data,
  linkProvider: async (
    provider: Provider,
    payload: { accessToken: string; refreshToken?: string; tokenExpiresAt?: string; scopes?: string[] },
  ) => (await api.post(`/social/integrations/${provider}/link`, payload)).data,
  unlinkProvider: async (provider: Provider) => (await api.delete(`/social/integrations/${provider}`)).data,
  getProviderProfile: async (provider: Provider) =>
    (await api.get(`/social/integrations/${provider}/profile`)).data,
  getProviderPosts: async (provider: Provider) =>
    (await api.get(`/social/integrations/${provider}/posts`)).data,
  startProviderOAuth: async (provider: Provider) =>
    (await api.get(`/social/integrations/${provider}/oauth/start`)).data,
  finishProviderOAuth: async (provider: Provider, payload: { code: string; state: string }) =>
    (await api.post(`/social/integrations/${provider}/oauth/callback`, payload)).data,

  getPublishJobs: async (filters: { status?: string; provider?: string } = {}) =>
    (await api.get('/social/publish-jobs', {
      params: { status: filters.status || undefined, provider: filters.provider || undefined },
    })).data,
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

  // Finds people by name (admins: by name or email too); needs 2 characters
  searchPeople: async (q: string, signal?: AbortSignal) =>
    (await api.get('/users/search', { params: { q }, signal })).data,

  getModerationPosts: async (status = 'all', owner?: string) =>
    (await api.get('/social/moderation/posts', { params: { status, owner: owner || undefined } })).data,
  // Leaving `reason` out clears the earlier reason
  moderatePost: async (postId: string, action: ModerationAction | string, reason?: string) =>
    (await api.patch(`/social/moderation/posts/${postId}`, reason ? { action, reason } : { action })).data,

  // Reported chat messages, for the Moderation page (admins). Pass the last
  // row's lastReportedAt and _id to load the next page.
  getReportedMessages: async (status: ReportStatus = 'open', cursor?: { before: string; beforeId: string }) =>
    (await api.get('/chat/reports', { params: { status, ...cursor } })).data,
  // Marks a reported message's reports as handled, or opens them again
  resolveReportedMessage: async (messageId: string, action: 'resolve' | 'reopen', note?: string) =>
    (await api.patch(`/chat/reports/${messageId}`, note ? { action, note } : { action })).data,
  deleteTeamMessage: async (teamId: string, messageId: string) =>
    (await api.delete(`/chat/teams/${teamId}/messages/${messageId}`)).data,
}

// Where the browser loads a post's image from (with the session cookie)
export const socialImageUrl = (imageId: string) => `${apiBaseUrl}/social/images/${imageId}`
