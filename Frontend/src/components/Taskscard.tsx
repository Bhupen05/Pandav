import type { TaskInput } from './Tasksadd'
import { canRequestCompletion, canStart, editedLabel, isWaitingForTeammates, progressOf } from '../utils/taskProgress'

interface ExtendedTask extends TaskInput {
  rejectionReason?: string
  rejectedBy?: { _id: string; name: string; email: string }
  rejectedAt?: string
}

type Props = {
  tasks: ExtendedTask[]
  onEdit?: (index: number) => void
  onDelete?: (index: number) => void
  onStatusChange?: (index: number, next: TaskInput['status']) => void
  isAdmin?: boolean
  // Whether the viewer may edit and delete this task (admins, and the leader
  // of everyone on it). Defaults to isAdmin.
  canManage?: (task: ExtendedTask) => boolean
  // Decides which actions the viewer gets on their own part of a task
  currentUserId?: string
}

const assigneeName = (assignee: TaskInput['assignedTo'][number]) =>
  typeof assignee === 'string' ? 'Unknown' : assignee.name || 'Unknown'

const assigneeId = (assignee: TaskInput['assignedTo'][number]) =>
  typeof assignee === 'string' ? assignee : assignee._id

function formatDate(date?: string) {
  if (!date) return null
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString()
}

function statusClasses(status: TaskInput['status']) {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800'
    case 'in-progress':
      return 'bg-blue-100 text-blue-800'
    case 'completed':
      return 'bg-emerald-100 text-emerald-800'
    case 'completion-requested':
      return 'bg-purple-100 text-purple-800'
    case 'cancelled':
      return 'bg-neutral-200 text-neutral-700'
    default:
      return 'bg-neutral-100 text-neutral-700'
  }
}

function priorityClasses(priority?: TaskInput['priority']) {
  switch (priority) {
    case 'low':
      return 'bg-neutral-100 text-neutral-700'
    case 'medium':
      return 'bg-blue-100 text-blue-800'
    case 'high':
      return 'bg-orange-100 text-orange-800'
    case 'urgent':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-neutral-100 text-neutral-700'
  }
}

function priorityIcon(priority?: TaskInput['priority']) {
  switch (priority) {
    case 'urgent':
      return '🔥'
    case 'high':
      return '⚡'
    case 'medium':
      return '▶️'
    case 'low':
      return '📌'
    default:
      return '📌'
  }
}

function statusIcon(status: TaskInput['status']) {
  switch (status) {
    case 'pending':
      return '⏳'
    case 'in-progress':
      return '🔄'
    case 'completed':
      return '✅'
    case 'completion-requested':
      return '🔔'
    case 'cancelled':
      return '❌'
    default:
      return '📋'
  }
}

export default function Taskscard({ tasks, onStatusChange, onEdit, onDelete, isAdmin = false, canManage, currentUserId }: Props) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border bg-white p-12 text-center shadow-sm">
        <div className="mb-4 flex justify-center">
          <div className="rounded-full bg-neutral-100 p-4">
            <svg className="h-12 w-12 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-neutral-900">No tasks yet</h3>
        <p className="text-sm text-neutral-600">Create your first task to get started with your workflow!</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task, idx) => {
        const due = formatDate(task.dueDate)
        const isOverdue = due && new Date(task.dueDate!) < new Date() && task.status !== 'completed'
        const isRejected = task.rejectionReason ? true : false
        const manageable = canManage ? canManage(task) : isAdmin
        const edited = editedLabel(task)

        return (
          <article
            key={task._id ?? idx}
            className={`group rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${
              isRejected ? 'border-red-200 bg-red-50' : ''
            }`}
          >
            {/* Header */}
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-blue-600 text-white shadow-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-neutral-900 mb-1 line-clamp-2">{task.title}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${priorityClasses(task.priority)}`}>
                    <span>{priorityIcon(task.priority)}</span>
                    {task.priority || 'medium'}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(task.status)}`}>
                    <span>{statusIcon(task.status)}</span>
                    {task.status.replace('-', ' ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Description */}
            {task.description && (
              <p className="mb-4 line-clamp-2 text-sm text-neutral-600 leading-relaxed">{task.description}</p>
            )}

            {/* Rejection Alert - SHOW THIS TO USERS */}
            {isRejected && (
              <div className="mb-4 rounded-lg border border-red-300 bg-red-100 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-lg">❌</span>
                  <p className="font-semibold text-red-900">Task Rejected</p>
                </div>
                <p className="mb-2 text-sm text-red-800 leading-relaxed">
                  <span className="font-medium">Reason:</span> {task.rejectionReason}
                </p>
                {task.rejectedBy && (
                  <p className="text-xs text-red-700">
                    Rejected by <span className="font-medium">{task.rejectedBy.name}</span>
                    {task.rejectedAt && ` on ${formatDate(task.rejectedAt)}`}
                  </p>
                )}
              </div>
            )}

            {/* Metadata */}
            <div className="mb-4 space-y-2">
              {task.startDate && task.dueDate && (
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="font-medium">
                    {formatDate(task.startDate)} → {formatDate(task.dueDate)}
                  </span>
                </div>
              )}
              {edited && (
                <div className="flex items-center gap-2 text-xs text-neutral-500" title="Last change to the task's details">
                  <span>✏️</span>
                  {edited}
                </div>
              )}
              {isOverdue && (
                <div className="flex items-center gap-2 text-xs font-semibold text-red-600">
                  <span>⚠️</span>
                  Overdue
                </div>
              )}
              {task.assignedTo.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {task.assignedTo.map((assignee) => {
                    const done = ['completion-requested', 'completed'].includes(progressOf(task, assigneeId(assignee)))
                    return (
                      <span
                        key={assigneeId(assignee)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                          done ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'
                        }`}
                        title={done ? 'Finished their part' : 'Still working'}
                      >
                        {done ? '✓' : '…'} {assigneeName(assignee)}
                      </span>
                    )
                  })}
                </div>
              )}
              {task.tags && task.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {task.tags.map((t, i) => (
                    <span key={i} className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 border-t pt-3">
              {onStatusChange && (
                <>
                  {/* User actions */}
                  {!isAdmin && canStart(task, currentUserId) && (
                    <button
                      className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      onClick={() => onStatusChange(idx, 'in-progress')}
                    >
                      ▶️ Start Task
                    </button>
                  )}
                  {!isAdmin && !canStart(task, currentUserId) && canRequestCompletion(task, currentUserId) && (
                    <button
                      className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors ${
                        isRejected ? 'bg-orange-600 hover:bg-orange-700' : 'bg-purple-600 hover:bg-purple-700'
                      }`}
                      onClick={() => onStatusChange(idx, 'completion-requested')}
                    >
                      {isRejected ? '🔄 Request Again' : '🔔 Request Completion'}
                    </button>
                  )}
                  {!isAdmin && isWaitingForTeammates(task, currentUserId) && (
                    <span className="flex-1 text-center text-xs text-purple-600 font-medium py-2">
                      ✓ Your part is done. Waiting for teammates
                    </span>
                  )}
                  {!isAdmin && task.status === 'completion-requested' && (
                    <span className="flex-1 text-center text-xs text-purple-600 font-medium py-2">
                      ⏳ Awaiting Admin Approval
                    </span>
                  )}
                  {!isAdmin && task.status === 'completed' && (
                    <span className="flex-1 text-center text-xs text-emerald-600 font-medium py-2">
                      ✅ Completed
                    </span>
                  )}
                  {!isAdmin && task.status === 'cancelled' && (
                    <span className="flex-1 text-center text-xs text-neutral-500 font-medium py-2">
                      ❌ Cancelled
                    </span>
                  )}

                  {/* Admin actions */}
                  {isAdmin && task.status === 'completion-requested' && (
                    <>
                      <button
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                        onClick={() => onStatusChange(idx, 'completed')}
                      >
                        ✓ Approve
                      </button>
                      <button
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold border border-red-500 text-red-600 hover:bg-red-50 transition-colors"
                        onClick={() => onStatusChange(idx, 'in-progress')}
                      >
                        ✗ Reject
                      </button>
                    </>
                  )}
                </>
              )}
              {manageable && onEdit && (
                <button
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
                  onClick={() => onEdit(idx)}
                >
                  Edit
                </button>
              )}
              {manageable && onDelete && (
                <button
                  className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  onClick={() => onDelete(idx)}
                >
                  Delete
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

