// Each assignee tracks their own part of a task (matches the backend Task model)
export type ProgressStatus = 'not-started' | 'in-progress' | 'completion-requested' | 'completed'

export type AssigneeProgress = {
  user: string | { _id: string }
  status: ProgressStatus
  completionRequestedAt?: string
}

type TaskWithProgress = {
  status: string
  assigneeProgress?: AssigneeProgress[]
}

// The given user's progress on a task. Tasks from before progress was tracked
// per assignee fall back to the task's own status.
export const progressOf = (task: TaskWithProgress, userId?: string): ProgressStatus => {
  const entry = task.assigneeProgress?.find(
    (p) => (typeof p.user === 'string' ? p.user : p.user._id) === userId
  )
  if (entry) return entry.status

  switch (task.status) {
    case 'in-progress':
      return 'in-progress'
    case 'completion-requested':
      return 'completion-requested'
    case 'completed':
      return 'completed'
    default:
      return 'not-started'
  }
}

// What the user can do on the task right now
export const canStart = (task: TaskWithProgress, userId?: string) =>
  ['pending', 'in-progress'].includes(task.status) && progressOf(task, userId) === 'not-started'

export const canRequestCompletion = (task: TaskWithProgress, userId?: string) =>
  ['pending', 'in-progress'].includes(task.status) &&
  ['not-started', 'in-progress'].includes(progressOf(task, userId))

// Finished their part, but teammates haven't yet
export const isWaitingForTeammates = (task: TaskWithProgress, userId?: string) =>
  task.status === 'in-progress' && progressOf(task, userId) === 'completion-requested'
