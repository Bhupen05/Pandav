import type { AssigneeProgress } from '../../utils/taskProgress'

// A task as the API returns it (Backend/Doc/Tasks.md, "Task fields")

export type TaskStatus = 'pending' | 'in-progress' | 'completion-requested' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type RepeatFrequency = 'daily' | 'weekly' | 'monthly'

// Populated references carry _id and name (and email on some)
export type PersonRef = { _id: string; name?: string; email?: string }

export type ChecklistItem = {
  _id: string
  text: string
  done: boolean
  doneBy?: PersonRef | null
  doneAt?: string | null
}

export type Recurrence = {
  frequency: RepeatFrequency
  interval: number
  until?: string | null
  anchorDate?: string
  seriesId?: string
  nextOccurrenceAt?: string | null
}

export type HistoryEntry = {
  _id?: string
  at: string
  by: PersonRef | null
  action: string
  details?: {
    fields?: string[]
    users?: PersonRef[]
    items?: number
    item?: string
    done?: boolean
    from?: string
    to?: string
    status?: string
    note?: string
    reason?: string
    name?: string
    repeatOf?: string
    commentId?: string
  }
}

export type Task = {
  _id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  startDate: string
  dueDate: string
  // Worked out by the server: the due day (YYYY-MM-DD) and whether it has passed
  dueDay?: string
  isOverdue?: boolean
  assigneeCount?: number
  doneCount?: number
  estimatedDays?: number
  assignedTo: Array<string | PersonRef>
  createdBy?: string | PersonRef
  team?: string | null
  tags?: string[]
  notes?: string
  assigneeProgress?: AssigneeProgress[]
  checklist?: ChecklistItem[]
  recurrence?: Recurrence | null
  rejectionReason?: string
  rejectedBy?: PersonRef
  rejectedAt?: string
  approvedBy?: PersonRef
  approvedAt?: string
  completedDate?: string
  cancelledBy?: PersonRef
  cancelledAt?: string
  cancelReason?: string
  completionRequestedBy?: PersonRef
  completionRequestedAt?: string
  reviewRequestedAt?: string
  editedBy?: string | PersonRef
  editedAt?: string
  commentCount?: number
  attachmentCount?: number
  // Only on single-task responses
  history?: HistoryEntry[]
  createdAt?: string
  updatedAt?: string
}

export type TaskSummary = {
  total: number
  byStatus: Record<TaskStatus, number>
  overdue: number
  dueSoon: number
  urgent: number
  completionRate: number
}

export type TaskComment = {
  _id: string
  task?: string
  author: PersonRef | null
  text: string
  editedAt?: string | null
  deletedAt?: string | null
  deleted: boolean
  createdAt: string
  updatedAt?: string
}

export type TaskAttachment = {
  _id: string
  task?: string
  uploadedBy: PersonRef | null
  name: string
  type: string
  size: number
  createdAt: string
}

export type LeaderboardRow = {
  _id: string
  name: string
  profileImage?: string
  totalTasks: number
  completedTasks: number
  completionRate: number
}

// Someone a task can be given to
export type AssigneeOption = { _id: string; name: string; email?: string }

export type Paging = { page: number; limit: number; total: number; pages: number }

export type TaskSort = 'createdAt' | '-createdAt' | 'dueDate' | '-dueDate' | 'priority' | '-priority' | 'title' | '-title'

// Query for GET /tasks and GET /tasks/summary
export type TaskQuery = {
  q?: string
  status?: TaskStatus
  priority?: TaskPriority
  assignedTo?: string
  team?: string
  overdue?: boolean
  dueFrom?: string
  dueTo?: string
  sort?: TaskSort
  page?: number
  limit?: number
}

export const TASK_STATUSES: TaskStatus[] = ['pending', 'in-progress', 'completion-requested', 'completed', 'cancelled']
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
export const OPEN_STATUSES: TaskStatus[] = ['pending', 'in-progress', 'completion-requested']
