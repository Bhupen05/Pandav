import api, { type ApiError } from './axios'
import type { TaskInput } from '../components/Tasksadd'
import type {
  AssigneeOption,
  LeaderboardRow,
  Paging,
  Recurrence,
  Task,
  TaskAttachment,
  TaskComment,
  TaskQuery,
  TaskStatus,
  TaskSummary,
} from '../components/tasks/types'

// Tasks, their comments, files and checklists (Backend/Doc/Tasks.md), plus the
// few other endpoints the Tasks page, the task form and the user dashboard read

type Envelope<T> = { success: boolean; message?: string; data: T }
export type TaskList = Envelope<Task[]> & { count?: number; pagination?: Paging }

// Query filters for GET /tasks; regular users only ever get their own tasks
export interface TaskFilters {
  status?: TaskInput['status']
  priority?: TaskInput['priority']
  assignedTo?: string
}

// What the task form sends on create and edit
export type TaskPayload = {
  title?: string
  description?: string
  startDate?: string
  dueDate?: string
  estimatedDays?: number
  priority?: TaskInput['priority']
  status?: TaskStatus
  assignedTo?: string[]
  tags?: string[]
  notes?: string
  checklist?: Array<{ _id?: string; text: string }> | null
  recurrence?: Pick<Recurrence, 'frequency' | 'interval' | 'until'> | null
}

type FeedPost = {
  _id: string
  title?: string
  content: string
  author?: { _id: string; name: string; profileImage?: string }
  likes?: string[]
  comments?: unknown[]
  createdAt: string
}

type PersonalTodo = {
  _id: string
  title: string
  description?: string
  status: 'todo' | 'in_progress' | 'completed'
  createdAt: string
}

type MyTeam = {
  _id: string
  name: string
  isActive?: boolean
  leaders: Array<{ _id: string; name: string; email?: string; isActive?: boolean }>
  members: Array<{ _id: string; name: string; email?: string; isActive?: boolean }>
}

// The query string for a list: overdue is sent as 'true', empty values not at all
const listParams = (query: TaskQuery | TaskFilters = {}) => {
  const params: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    params[key] = value === true ? 'true' : (value as string | number)
  }
  return params
}

// A download's error body arrives as a Blob; read the server's message out of it
const blobError = async (error: unknown): Promise<ApiError> => {
  const apiError = (error ?? {}) as ApiError
  if (apiError.data instanceof Blob) {
    try {
      const body = JSON.parse(await apiError.data.text())
      if (body?.message) return { ...apiError, message: body.message }
    } catch {
      // Not JSON: keep the generic message
    }
  }
  return apiError
}

export const taskAPI = {
  // ─── Tasks ──────────────────────────────────────────────────────────────

  // The tasks the caller may see. Without page, every match comes back.
  getTasks: async (filters?: TaskQuery | TaskFilters) => {
    const response = await api.get('/tasks', { params: listParams(filters) })
    return response.data
  },

  // One page of tasks, with the total in pagination
  listTasks: async (query: TaskQuery): Promise<TaskList> =>
    (await api.get('/tasks', { params: listParams({ page: 1, ...query }) })).data,

  // Counts over the same tasks as the list (status, sort and paging ignored)
  getSummary: async (query: TaskQuery = {}): Promise<Envelope<TaskSummary>> => {
    const { q, priority, assignedTo, team, overdue, dueFrom, dueTo } = query
    return (await api.get('/tasks/summary', { params: listParams({ q, priority, assignedTo, team, overdue, dueFrom, dueTo }) })).data
  },

  // One task, with its activity history
  getTask: async (id: string): Promise<Envelope<Task>> => (await api.get(`/tasks/${id}`)).data,

  createTask: async (data: TaskPayload | TaskInput): Promise<Envelope<Task>> => (await api.post('/tasks', data)).data,

  // Managers change the details; an assignee sends { status: 'in-progress' } to start their part
  updateTask: async (id: string, data: Partial<TaskInput> | TaskPayload): Promise<Envelope<Task>> =>
    (await api.put(`/tasks/${id}`, data)).data,

  deleteTask: async (id: string): Promise<{ success: boolean; message?: string }> =>
    (await api.delete(`/tasks/${id}`)).data,

  cancelTask: async (id: string, reason?: string): Promise<Envelope<Task>> =>
    (await api.post(`/tasks/${id}/cancel`, reason ? { reason } : {})).data,

  // Without a status the server picks: in progress for a completed task, pending for a cancelled one
  reopenTask: async (id: string, status?: 'pending' | 'in-progress'): Promise<Envelope<Task>> =>
    (await api.post(`/tasks/${id}/reopen`, status ? { status } : {})).data,

  // Marks the caller's part done, with an optional note for the reviewer
  requestCompletion: async (id: string, note?: string): Promise<Envelope<Task>> =>
    (await api.post(`/tasks/${id}/request-completion`, note ? { note } : {})).data,

  // Reviewers: admins, and leaders of everyone on the task who aren't on it
  approveCompletion: async (id: string): Promise<Envelope<Task>> => (await api.put(`/tasks/${id}/approve`)).data,

  rejectCompletion: async (id: string, data?: { rejectionReason?: string }): Promise<Envelope<Task>> =>
    (await api.put(`/tasks/${id}/reject`, data || {})).data,

  // The tasks the caller can review now (admins and team leaders)
  getPendingApprovalTasks: async (query?: { page?: number; limit?: number }) => {
    const response = await api.get('/tasks/pending-approval', { params: query })
    return response.data
  },

  toggleChecklistItem: async (id: string, itemId: string, done: boolean): Promise<Envelope<Task>> =>
    (await api.patch(`/tasks/${id}/checklist/${itemId}`, { done })).data,

  // ─── Comments ───────────────────────────────────────────────────────────

  // 50 at a time, oldest first; `before` (the oldest shown) loads the 50 before it
  getComments: async (id: string, before?: string): Promise<Envelope<TaskComment[]> & { hasMore?: boolean }> =>
    (await api.get(`/tasks/${id}/comments`, { params: before ? { before } : undefined })).data,

  addComment: async (id: string, text: string): Promise<Envelope<TaskComment>> =>
    (await api.post(`/tasks/${id}/comments`, { text })).data,

  editComment: async (id: string, commentId: string, text: string): Promise<Envelope<TaskComment>> =>
    (await api.patch(`/tasks/${id}/comments/${commentId}`, { text })).data,

  deleteComment: async (id: string, commentId: string): Promise<Envelope<TaskComment>> =>
    (await api.delete(`/tasks/${id}/comments/${commentId}`)).data,

  // ─── Files ──────────────────────────────────────────────────────────────

  getAttachments: async (id: string): Promise<Envelope<TaskAttachment[]>> =>
    (await api.get(`/tasks/${id}/attachments`)).data,

  // `data` is the file as base64 (a data: URL is fine)
  addAttachment: async (id: string, file: { name: string; type: string; data: string }): Promise<Envelope<TaskAttachment>> =>
    (await api.post(`/tasks/${id}/attachments`, file, { timeout: 60000 })).data,

  // The file's bytes; errors reject with the server's message
  downloadAttachment: async (id: string, attachmentId: string): Promise<Blob> => {
    try {
      const response = await api.get(`/tasks/${id}/attachments/${attachmentId}`, { responseType: 'blob', timeout: 60000 })
      return response.data as Blob
    } catch (error) {
      throw await blobError(error)
    }
  },

  deleteAttachment: async (id: string, attachmentId: string): Promise<{ success: boolean; message?: string }> =>
    (await api.delete(`/tasks/${id}/attachments/${attachmentId}`)).data,

  // ─── Leaderboard ────────────────────────────────────────────────────────

  // The caller's team (only themselves without one); admins see everyone
  getLeaderboard: async (period: 'all' | 'month' = 'all'): Promise<Envelope<LeaderboardRow[]> & { count?: number }> =>
    (await api.get('/tasks/leaderboard', { params: period === 'month' ? { period } : undefined })).data,

  // ─── People to give tasks to ────────────────────────────────────────────

  // Admins: active accounts whose name or email contains q, by name
  searchActiveUsers: async (q = '', limit = 50): Promise<AssigneeOption[]> => {
    const response = await api.get('/users', {
      params: { isActive: true, sort: 'name', page: 1, limit, ...(q.trim() ? { q: q.trim() } : {}) },
    })
    const users: Array<{ _id: string; name: string; email?: string }> = Array.isArray(response.data?.data) ? response.data.data : []
    return users.map(({ _id, name, email }) => ({ _id, name, email }))
  },

  // The caller's team, or null outside a team (the server answers 404 then)
  getMyTeam: async (): Promise<MyTeam | null> => {
    try {
      const response = await api.get('/teams/my')
      return response.data?.data ?? null
    } catch (error) {
      if ((error as ApiError)?.status === 404) return null
      throw error
    }
  },

  // Admins: every team, for the team filter
  getTeams: async (): Promise<Array<{ _id: string; name: string; isActive?: boolean }>> => {
    const response = await api.get('/teams')
    const teams: Array<{ _id: string; name: string; isActive?: boolean }> = Array.isArray(response.data?.data) ? response.data.data : []
    return teams.map(({ _id, name, isActive }) => ({ _id, name, isActive }))
  },

  // ─── The user dashboard's Social Hub widgets ────────────────────────────

  getFeed: async (): Promise<FeedPost[]> => {
    const response = await api.get('/social/feed')
    return Array.isArray(response.data?.data) ? response.data.data : []
  },

  getPersonalTodos: async (): Promise<PersonalTodo[]> => {
    const response = await api.get('/social/personal-tasks')
    return Array.isArray(response.data?.data) ? response.data.data : []
  },

  // Completes or reopens a to-do; autoShare.suggested carries a draft to offer for sharing
  togglePersonalTodo: async (
    todoId: string,
  ): Promise<{ data?: PersonalTodo; autoShare?: { suggested?: boolean; draft?: { title: string; content: string } } | null }> =>
    (await api.patch(`/social/personal-tasks/${todoId}/toggle-complete`)).data,
}

export type { FeedPost, PersonalTodo, MyTeam }
