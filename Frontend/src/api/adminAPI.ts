import api, { type ApiError } from './axios'

// Everything the admin pages and the approvals inbox call. Some of these
// endpoints belong to other modules (users, tasks, attendance, Social Hub,
// contact); they are called from here so each area keeps its own API file.

export type Role = 'user' | 'team_member' | 'team_leader' | 'admin'

export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface ListResponse<T> {
  success: boolean
  count?: number
  data: T[]
  pagination?: Pagination
}

type Options = { signal?: AbortSignal }

// ── People ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  _id: string
  name: string
  email: string
  role: Role | string
  teamId?: string | null
  phone?: string
  department?: string
  profileImage?: string
  isActive: boolean
  emailVerified?: boolean
  mustChangePassword?: boolean
  twoFactor?: { enabled?: boolean }
  lastLoginAt?: string
  deletedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type UserSort = 'name' | '-name' | 'email' | '-email' | 'createdAt' | '-createdAt' | 'lastLoginAt' | '-lastLoginAt'

export interface UserQuery {
  q?: string
  role?: string
  isActive?: boolean
  includeDeleted?: boolean
  sort?: UserSort
  page?: number
  limit?: number
}

export interface UserEdit {
  name?: string
  email?: string
  phone?: string
  department?: string
  role?: 'user' | 'admin'
  isActive?: boolean
}

export interface PersonMatch {
  _id: string
  name: string
  email?: string
  role: string
  department?: string
  profileImage?: string
}

export interface TeamSummary {
  _id: string
  name: string
  isActive?: boolean
  description?: string
}

// ── Admin module ─────────────────────────────────────────────────────────────

export interface AdminStats {
  users: { total: number; active: number; byRole: Partial<Record<Role, number>> }
  teams: { total: number; frozen: number }
  tasks: { byStatus: Record<string, number>; overdue: number; awaitingReview: number }
  attendance: { checkedInToday: number; pendingReviews: number; correctionRequests: number }
  contact: { byStatus: Record<string, number> }
  social: { flagged: number; pendingApproval: number }
}

export interface AuditActor {
  _id: string
  name: string
  email: string | null
  role: string | null
  deleted: boolean
}

export interface AuditEvent {
  _id: string
  actor: AuditActor | null
  action: string
  targetType?: string | null
  targetId?: string | null
  status: 'success' | 'failed'
  ip?: string
  userAgent?: string
  details?: Record<string, unknown> | null
  createdAt: string
}

export interface AuditQuery {
  actor?: string
  action?: string
  targetType?: string
  targetId?: string
  status?: 'success' | 'failed'
  from?: string
  to?: string
  before?: string
  limit?: number
}

export interface AuditPage {
  data: AuditEvent[]
  hasMore: boolean
}

export interface ReportFigures {
  tasks: { created: number; completed: number; openOverdue: number; avgDaysToComplete: number | null }
  attendance: { present: number; late: number; halfDay: number; absent: number; leave: number; hours: number }
}

export interface ReportRow extends ReportFigures {
  team: { _id: string; name: string; isActive: boolean } | null
  members: number
}

export interface OverviewReport {
  from: string
  to: string
  rows: ReportRow[]
  totals: ReportFigures & { members: number }
}

export interface BackgroundJob {
  name: string
  everyMinutes: number
  running: boolean
  lastRunAt?: string | null
  lastResult?: unknown
  lastError?: string | null
}

export interface TaskExportFilters {
  from?: string
  to?: string
  status?: string
  team?: string
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in-progress' | 'completion-requested' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface PersonRef {
  _id: string
  name: string
  email?: string
}

export interface TaskRow {
  _id: string
  title: string
  description?: string
  status: TaskStatus
  priority?: TaskPriority
  startDate?: string
  dueDate?: string
  dueDay?: string
  isOverdue?: boolean
  assigneeCount?: number
  doneCount?: number
  assignedTo?: PersonRef[]
  createdBy?: PersonRef
  assigneeProgress?: Array<{
    user?: PersonRef | string | null
    status: string
    notes?: string
    completionRequestedAt?: string
  }>
  completionRequestedBy?: PersonRef
  completionRequestedAt?: string
  reviewRequestedAt?: string
  team?: string | null
  tags?: string[]
  notes?: string
  estimatedDays?: number
  createdAt?: string
  updatedAt?: string
}

export interface TaskQuery {
  q?: string
  status?: string
  priority?: string
  assignedTo?: string
  overdue?: boolean
  sort?: string
  page?: number
  limit?: number
}

export interface TaskSummary {
  total: number
  byStatus: Record<string, number>
  overdue: number
  dueSoon: number
  urgent: number
  completionRate: number
}

export interface BulkResult {
  id: string
  ok: boolean
  status: number
  message?: string
}

// ── Attendance ───────────────────────────────────────────────────────────────

export type DayType = 'present' | 'absent' | 'late' | 'half-day' | 'leave'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface AttendanceRow {
  _id: string
  user: { _id: string; name: string; email?: string; department?: string; profileImage?: string }
  team?: { _id: string; name: string } | null
  date: string
  day: string
  status: DayType
  approvalStatus: ApprovalStatus
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
  remarks?: string
  reviewRemarks?: string
  approvedBy?: PersonRef | null
  reviewedAt?: string
  leaveType?: string | null
  leaveRequestId?: string | null
  missedCheckout?: boolean
  correctionRequest?: { checkOutTime: string; remarks?: string; requestedAt?: string } | null
}

export interface AttendanceQuery {
  user?: string
  approvalStatus?: ApprovalStatus
  reviewable?: boolean
  hasCorrection?: boolean
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

export interface MonthSummary {
  user: string
  month: string
  days: { present: number; late: number; halfDay: number; absent: number; leave: number }
  approvedHours: number
  pendingHours: number
  pendingCount: number
  rejectedCount: number
}

export interface LeaveRequest {
  leaveRequestId: string
  user: PersonRef
  team?: { _id: string; name: string } | null
  leaveType: string
  leaveTypeLabel?: string
  startDate: string
  endDate: string
  days: number
  halfDay: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'mixed'
  counts: { pending: number; approved: number; rejected: number }
  remarks?: string
  reviewRemarks?: string
  createdAt?: string
}

// ── Social Hub ───────────────────────────────────────────────────────────────

export interface SocialPostRow {
  _id: string
  author?: { _id: string; name: string; role?: string; email?: string } | null
  title?: string
  content: string
  tags?: string[]
  visibility?: string
  targets?: { pandav?: boolean; linkedin?: boolean; github?: boolean }
  approvalStatus?: string
  moderationStatus?: 'clean' | 'flagged' | 'hidden' | 'removed'
  moderationReason?: string | null
  createdAt: string
}

// ── Contact inbox ────────────────────────────────────────────────────────────

export type ContactStatus = 'new' | 'in-progress' | 'resolved' | 'closed'
export type ContactSort = 'newest' | 'oldest' | 'updated' | 'name'

export interface ContactReply {
  _id: string
  by?: { _id: string; name: string; email?: string | null } | null
  message: string
  at: string
  sent: boolean
}

export interface ContactMessage {
  _id: string
  name: string
  email: string
  phone?: string
  subject: string
  message: string
  status: ContactStatus
  resolvedBy?: { _id: string; name: string; email?: string | null } | null
  resolvedAt?: string
  replies?: ContactReply[]
  createdAt: string
  updatedAt?: string
}

export interface ContactQuery {
  status?: ContactStatus
  q?: string
  sort?: ContactSort
  page?: number
  limit?: number
}

export interface ContactStats {
  total: number
  byStatus: Record<ContactStatus, number>
}

export interface ServerConfig {
  mailEnabled: boolean
  emailVerificationRequired?: boolean
  passwordMinLength?: number
}

// Query parameters without empty values
const clean = <T extends object>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== null))

// The file name the server chose, from Content-Disposition
const fileNameFrom = (header: unknown, fallback: string) => {
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // fall through to the plain name
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : fallback
}

// Downloads a CSV export. The error body of a failed download is a Blob too,
// so its message is read out of it.
const download = async (path: string, params: object, fallbackName: string) => {
  try {
    const response = await api.get(path, { params: clean(params), responseType: 'blob' })
    const url = URL.createObjectURL(response.data as Blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileNameFrom(response.headers['content-disposition'], fallbackName)
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    const apiError = error as ApiError
    if (apiError?.data instanceof Blob) {
      let message = apiError.message
      try {
        const parsed = JSON.parse(await apiError.data.text())
        if (parsed?.message) message = parsed.message
      } catch {
        // not JSON: keep the generic message
      }
      throw { ...apiError, message } as ApiError
    }
    throw error
  }
}

export const adminAPI = {
  // ── Admin module ──
  getStats: async ({ signal }: Options = {}): Promise<AdminStats> =>
    (await api.get('/admin/stats', { signal })).data.data,

  getAudit: async (query: AuditQuery, { signal }: Options = {}): Promise<AuditPage> => {
    const response = await api.get('/admin/audit', { params: clean(query), signal })
    return { data: response.data.data ?? [], hasMore: Boolean(response.data.hasMore) }
  },

  getAuditActions: async ({ signal }: Options = {}): Promise<string[]> =>
    (await api.get('/admin/audit/actions', { signal })).data.data ?? [],

  getOverviewReport: async (query: { from?: string; to?: string; team?: string }, { signal }: Options = {}): Promise<OverviewReport> =>
    (await api.get('/admin/reports/overview', { params: clean(query), signal })).data.data,

  getJobs: async ({ signal }: Options = {}): Promise<BackgroundJob[]> =>
    (await api.get('/admin/jobs', { signal })).data.data ?? [],

  runJob: async (name: string): Promise<unknown> =>
    (await api.post(`/admin/jobs/${encodeURIComponent(name)}/run`)).data.data,

  exportUsers: () => download('/admin/export/users', {}, 'pandav-users.csv'),

  exportTasks: (filters: TaskExportFilters) => download('/admin/export/tasks', filters, 'pandav-tasks.csv'),

  // ── People ──
  getUsers: async (query: UserQuery, { signal }: Options = {}): Promise<ListResponse<AdminUser>> =>
    (await api.get('/users', { params: clean(query), signal })).data,

  getUser: async (id: string, { signal }: Options = {}): Promise<AdminUser> =>
    (await api.get(`/users/${id}`, { signal })).data.data,

  // Admins search names and email addresses; at least 2 characters
  searchPeople: async (q: string, { signal }: Options = {}): Promise<PersonMatch[]> =>
    (await api.get('/users/search', { params: { q }, signal })).data.data ?? [],

  updateUser: async (id: string, data: UserEdit): Promise<AdminUser> =>
    (await api.put(`/users/${id}`, data)).data.data,

  toggleActive: async (id: string): Promise<{ data: AdminUser; message?: string }> =>
    (await api.put(`/users/${id}/toggle-active`)).data,

  resetPassword: async (id: string, newPassword: string): Promise<{ message?: string }> =>
    (await api.put(`/users/${id}/reset-password`, { newPassword })).data,

  resetTwoFactor: async (id: string): Promise<{ message?: string }> =>
    (await api.post(`/users/${id}/2fa/reset`)).data,

  deleteUser: async (id: string): Promise<{ message?: string }> =>
    (await api.delete(`/users/${id}`)).data,

  getTeams: async ({ signal }: Options = {}): Promise<TeamSummary[]> =>
    (await api.get('/teams', { signal })).data.data ?? [],

  // ── Tasks ──
  getTasks: async (query: TaskQuery, { signal }: Options = {}): Promise<ListResponse<TaskRow>> =>
    (await api.get('/tasks', { params: clean(query), signal })).data,

  getTaskSummary: async (query: Omit<TaskQuery, 'page' | 'limit' | 'sort' | 'status'>, { signal }: Options = {}): Promise<TaskSummary> =>
    (await api.get('/tasks/summary', { params: clean(query), signal })).data.data,

  getTasksToReview: async (query: { page?: number; limit?: number } = {}, { signal }: Options = {}): Promise<ListResponse<TaskRow>> =>
    (await api.get('/tasks/pending-approval', { params: clean(query), signal })).data,

  approveTask: async (id: string) => (await api.put(`/tasks/${id}/approve`)).data,

  rejectTask: async (id: string, rejectionReason?: string) =>
    (await api.put(`/tasks/${id}/reject`, rejectionReason ? { rejectionReason } : {})).data,

  bulkReviewTasks: async (ids: string[], action: 'approve' | 'reject', rejectionReason?: string): Promise<{ message?: string; data: BulkResult[] }> =>
    (await api.post('/tasks/bulk-review', { ids, action, ...(rejectionReason ? { rejectionReason } : {}) })).data,

  deleteTask: async (id: string) => (await api.delete(`/tasks/${id}`)).data,

  // ── Attendance ──
  getAttendance: async (query: AttendanceQuery, { signal }: Options = {}): Promise<ListResponse<AttendanceRow>> =>
    (await api.get('/attendance', { params: clean(query), signal })).data,

  getMonthSummary: async (user: string, month: string, { signal }: Options = {}): Promise<MonthSummary> =>
    (await api.get('/attendance/summary', { params: { user, month }, signal })).data.data,

  approveAttendance: async (id: string, reviewRemarks?: string) =>
    (await api.put(`/attendance/${id}/approve`, reviewRemarks ? { reviewRemarks } : {})).data,

  rejectAttendance: async (id: string, reviewRemarks?: string) =>
    (await api.put(`/attendance/${id}/disapprove`, reviewRemarks ? { reviewRemarks } : {})).data,

  bulkReviewAttendance: async (
    ids: string[],
    action: 'approve' | 'reject',
    reviewRemarks?: string,
  ): Promise<{ message?: string; data: { results: BulkResult[]; succeeded: number; failed: number } }> =>
    (await api.post('/attendance/bulk-review', { ids, action, ...(reviewRemarks ? { reviewRemarks } : {}) })).data,

  // Applies a correction (checkOutTime) or declines it (correctionRequest: null)
  updateAttendance: async (id: string, data: { checkOutTime?: string; correctionRequest?: null }) =>
    (await api.put(`/attendance/${id}`, data)).data,

  getLeaveRequests: async (query: { status?: string; page?: number; limit?: number }, { signal }: Options = {}): Promise<ListResponse<LeaveRequest>> =>
    (await api.get('/attendance/leave', { params: clean(query), signal })).data,

  approveLeave: async (leaveRequestId: string, reviewRemarks?: string) =>
    (await api.put(`/attendance/leave/${leaveRequestId}/approve`, reviewRemarks ? { reviewRemarks } : {})).data,

  rejectLeave: async (leaveRequestId: string, reviewRemarks?: string) =>
    (await api.put(`/attendance/leave/${leaveRequestId}/reject`, reviewRemarks ? { reviewRemarks } : {})).data,

  // ── Social Hub ──
  getPostsToApprove: async ({ signal }: Options = {}): Promise<SocialPostRow[]> =>
    (await api.get('/social/posts/pending-approval', { signal })).data.data ?? [],

  decidePost: async (postId: string, action: 'approved' | 'rejected') =>
    (await api.patch(`/social/posts/${postId}/approve`, { action })).data,

  getFlaggedPosts: async ({ signal }: Options = {}): Promise<SocialPostRow[]> =>
    (await api.get('/social/moderation/posts', { params: { status: 'flagged' }, signal })).data.data ?? [],

  moderatePost: async (postId: string, action: 'unflag' | 'hide' | 'remove', reason?: string) =>
    (await api.patch(`/social/moderation/posts/${postId}`, { action, ...(reason ? { reason } : {}) })).data,

  // ── Contact inbox ──
  getContacts: async (query: ContactQuery, { signal }: Options = {}): Promise<ListResponse<ContactMessage>> =>
    (await api.get('/contact', { params: clean(query), signal })).data,

  getContactStats: async ({ signal }: Options = {}): Promise<ContactStats> =>
    (await api.get('/contact/stats', { signal })).data.data,

  setContactStatus: async (id: string, status: ContactStatus): Promise<ContactMessage> =>
    (await api.put(`/contact/${id}`, { status })).data.data,

  replyToContact: async (id: string, message: string): Promise<ContactMessage> =>
    (await api.post(`/contact/${id}/reply`, { message })).data.data,

  deleteContact: async (id: string) => (await api.delete(`/contact/${id}`)).data,

  // Whether this server can send email
  getServerConfig: async ({ signal }: Options = {}): Promise<ServerConfig> =>
    (await api.get('/auth/config', { signal })).data.data,
}
