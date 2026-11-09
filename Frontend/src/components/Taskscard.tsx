import { CalendarDays, Check, Clock, MessageSquare, Paperclip, Pencil, ListChecks, TriangleAlert } from 'lucide-react'
import { canRequestCompletion, canStart, editedLabel, isAssignee, isWaitingForTeammates, progressOf } from '../utils/taskProgress'
import { dueDayOf, formatDay, personId, personName } from './tasks/taskFormat'
import { canManageTask, canReviewTask, type Viewer } from './tasks/taskRights'
import type { Task } from './tasks/types'
import { PriorityBadge, StatusBadge } from './tasks/ui'

type Props = {
  tasks: Task[]
  viewer: Viewer
  // The task an action is running on: its buttons are disabled meanwhile
  busyId?: string | null
  onOpen: (task: Task) => void
  onEdit?: (task: Task) => void
  onDelete?: (task: Task) => void
  onStart?: (task: Task) => void
  onRequestCompletion?: (task: Task) => void
  onApprove?: (task: Task) => void
  onReject?: (task: Task) => void
}

const ACTION = 'rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'

// The tasks as a grid of cards, each opening the task's details
export default function Taskscard({ tasks, viewer, busyId, onOpen, onEdit, onDelete, onStart, onRequestCompletion, onApprove, onReject }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task) => {
        const manageable = canManageTask(task, viewer)
        const reviewable = canReviewTask(task, viewer)
        const edited = editedLabel(task)
        const busy = busyId === task._id
        const showStart = canStart(task, viewer.id)
        const showRequest = canRequestCompletion(task, viewer.id)
        const checklist = task.checklist || []
        const ticked = checklist.filter((item) => item.done).length

        return (
          <article
            key={task._id}
            className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${
              task.rejectionReason ? 'border-red-200 bg-red-50' : 'border-neutral-200'
            }`}
          >
            <div className="mb-3 flex items-start gap-3">
              <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-blue-600 text-white shadow-sm">
                <ListChecks className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="mb-1 text-base font-semibold text-neutral-900">
                  <button
                    type="button"
                    onClick={() => onOpen(task)}
                    className="line-clamp-2 w-full text-left wrap-break-word hover:underline focus-visible:underline"
                  >
                    {task.title}
                  </button>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                  {task.isOverdue && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                      <TriangleAlert aria-hidden="true" className="h-3 w-3" />
                      Overdue
                    </span>
                  )}
                </div>
              </div>
            </div>

            {task.description && <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-neutral-600">{task.description}</p>}

            {task.rejectionReason && (
              <div className="mb-4 rounded-lg border border-red-300 bg-red-100 p-3">
                <p className="text-sm font-semibold text-red-900">Sent back for more work</p>
                <p className="mt-1 line-clamp-3 wrap-break-word text-sm text-red-800">
                  <span className="font-medium">Reason:</span> {task.rejectionReason}
                </p>
                {task.rejectedBy && <p className="mt-1 text-xs text-red-700">By {personName(task.rejectedBy)}</p>}
              </div>
            )}

            <div className="mb-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="font-medium">
                  <span className="sr-only">Starts </span>
                  {formatDay(task.startDate, 'short')}
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> due </span>
                  {formatDay(dueDayOf(task), 'short')}
                </span>
              </div>
              {edited && (
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  {edited}
                </div>
              )}
              {task.assignedTo.length > 1 && (
                <ul className="flex flex-wrap items-center gap-1.5" aria-label="People on this task">
                  {task.assignedTo.map((assignee) => {
                    const id = personId(assignee) || ''
                    const done = ['completion-requested', 'completed'].includes(progressOf(task, id))
                    return (
                      <li
                        key={id}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                          done ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {done ? <Check aria-hidden="true" className="h-3 w-3" /> : <Clock aria-hidden="true" className="h-3 w-3" />}
                        {personName(assignee, 'Unknown')}
                        <span className="sr-only">{done ? ' (finished their part)' : ' (still working)'}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {task.tags && task.tags.length > 0 && (
                <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
                  {task.tags.map((tag) => (
                    <li key={tag} className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                      #{tag}
                    </li>
                  ))}
                </ul>
              )}
              {(checklist.length > 0 || !!task.commentCount || !!task.attachmentCount) && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                  {checklist.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <ListChecks aria-hidden="true" className="h-3.5 w-3.5" />
                      {ticked}/{checklist.length}
                      <span className="sr-only"> checklist items done</span>
                    </span>
                  )}
                  {!!task.commentCount && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                      {task.commentCount}
                      <span className="sr-only"> comments</span>
                    </span>
                  )}
                  {!!task.attachmentCount && (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
                      {task.attachmentCount}
                      <span className="sr-only"> files</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
              {showStart && onStart && (
                <button type="button" disabled={busy} onClick={() => onStart(task)} className={`${ACTION} bg-blue-600 text-white hover:bg-blue-700`}>
                  Start
                </button>
              )}
              {showRequest && onRequestCompletion && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRequestCompletion(task)}
                  className={`${ACTION} text-white ${task.rejectionReason ? 'bg-orange-600 hover:bg-orange-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                >
                  {task.rejectionReason ? 'Request again' : 'Request completion'}
                </button>
              )}
              {isWaitingForTeammates(task, viewer.id) && (
                <span className="text-xs font-medium text-purple-700">Your part is done. Waiting for the others.</span>
              )}
              {task.status === 'completion-requested' && !reviewable && (
                <span className="text-xs font-medium text-purple-700">Waiting for review</span>
              )}
              {task.status === 'completed' && isAssignee(task, viewer.id) && (
                <span className="text-xs font-medium text-emerald-700">Completed</span>
              )}
              {reviewable && onApprove && (
                <button type="button" disabled={busy} onClick={() => onApprove(task)} className={`${ACTION} bg-emerald-600 text-white hover:bg-emerald-700`}>
                  Approve
                </button>
              )}
              {reviewable && onReject && (
                <button type="button" disabled={busy} onClick={() => onReject(task)} className={`${ACTION} border border-red-500 text-red-600 hover:bg-red-50`}>
                  Reject
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpen(task)}
                aria-label={`Details of ${task.title}`}
                className={`${ACTION} border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}
              >
                Details
              </button>
              {manageable && onEdit && (
                <button type="button" disabled={busy} onClick={() => onEdit(task)} className={`${ACTION} border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}>
                  Edit
                </button>
              )}
              {manageable && onDelete && (
                <button type="button" disabled={busy} onClick={() => onDelete(task)} className={`${ACTION} border border-red-300 text-red-600 hover:bg-red-50`}>
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
