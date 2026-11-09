import { Link } from 'react-router-dom'
import type { ListResponse, TaskRow } from '../../../api/adminAPI'
import { Badge, Loadable, Pager } from '../ui'
import { formatDateTime, formatDay } from '../format'
import { priorityLabel, priorityTone } from '../labels'
import { BTN } from '../buttons'
import type { useReview } from '../useReview'
import type { useResource } from '../useResource'
import { BulkBar, Meta, QueueItem } from './parts'
import { useSelection } from './helpers'

type Review = ReturnType<typeof useReview>

export function TaskQueue({
  resource,
  review,
  page,
  onPage,
}: {
  resource: ReturnType<typeof useResource<ListResponse<TaskRow>>>
  review: Review
  page: number
  onPage: (page: number) => void
}) {
  const rows = resource.data?.data ?? []
  const selection = useSelection(rows.map((task) => task._id))

  return (
    <Loadable
      data={resource.data}
      error={resource.error}
      loading={resource.loading}
      onRetry={resource.reload}
      errorFallback="Could not load the tasks waiting for review"
      isEmpty={(data) => data.data.length === 0}
      empty="No tasks are waiting for review."
    >
      {(data) => (
        <>
          <BulkBar
            noun="tasks on this page"
            total={data.data.length}
            selection={selection}
            busy={review.isBusy('bulk:tasks')}
            onApprove={(ids) => review.bulkTasks(ids, 'approve').then((done) => done && selection.clear())}
            onReject={(ids) => review.bulkTasks(ids, 'reject').then((done) => done && selection.clear())}
          />
          <ul className="space-y-3">
            {data.data.map((task) => {
              const busy = review.isBusy(`task:${task._id}`) || review.isBusy('bulk:tasks')
              const people = (task.assignedTo ?? []).map((person) => person.name).join(', ')
              const notes = (task.assigneeProgress ?? []).filter((entry) => entry.notes)
              const asked = task.reviewRequestedAt || task.completionRequestedAt
              return (
                <QueueItem
                  key={task._id}
                  checkbox={
                    <input
                      type="checkbox"
                      checked={selection.isSelected(task._id)}
                      onChange={() => selection.toggle(task._id)}
                      aria-label={`Select ${task.title}`}
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                  }
                  actions={
                    <>
                      <button type="button" disabled={busy} onClick={() => review.approveTask(task)} aria-label={`Approve ${task.title}`} className={`${BTN.sm} ${BTN.success}`}>
                        Approve
                      </button>
                      <button type="button" disabled={busy} onClick={() => review.rejectTask(task)} aria-label={`Reject ${task.title}`} className={`${BTN.sm} ${BTN.danger}`}>
                        Reject
                      </button>
                    </>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/tasks?task=${task._id}`} className="font-medium text-neutral-900 hover:underline">
                      {task.title}
                    </Link>
                    <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                    {task.isOverdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  <Meta>
                    {people || 'No one assigned'}
                    {typeof task.assigneeCount === 'number' && task.assigneeCount > 1 && ` · ${task.doneCount ?? 0} of ${task.assigneeCount} done`}
                    {task.dueDay && ` · Due ${formatDay(task.dueDay)}`}
                    {asked && ` · Asked for review ${formatDateTime(asked)}`}
                  </Meta>
                  {notes.map((entry, index) => (
                    <p key={index} className="mt-1 rounded-lg bg-neutral-50 px-3 py-1.5 text-sm break-words text-neutral-700">
                      <span className="text-xs text-neutral-500">
                        {typeof entry.user === 'object' && entry.user ? entry.user.name : 'Note'}:
                      </span>{' '}
                      {entry.notes}
                    </p>
                  ))}
                </QueueItem>
              )
            })}
          </ul>
          <Pager page={data.pagination?.page ?? page} pages={data.pagination?.pages ?? 1} total={data.pagination?.total} label="Task review pages" onPage={onPage} />
        </>
      )}
    </Loadable>
  )
}
