import { Link } from 'react-router-dom'
import { dayIn, formatDateTime, formatDay, formatTime, plural, SERVER_TIME_ZONE } from './format'
import { attendanceReviewable, type TeamReviews } from './reviews'
import type { AttendanceRecord, TeamTask } from './types'
import { EmptyBlock, ErrorBlock, FrozenBanner, LoadingBlock } from './ui'

// One review queue as the dashboard loads it
export type Queue<T> = {
  items: T[]
  // How many are waiting (for a frozen team, counted from the team's lists)
  count: number | undefined
  error: string
  loading: boolean
  reload: () => void
}

type Props = {
  peopleCount: number
  taskTotal: number | undefined
  tasks: Queue<TeamTask>
  attendance: Queue<AttendanceRecord>
  // A leader of a team that isn't frozen
  canAct: boolean
  frozen: boolean
  reviews: TeamReviews
}

const show = (count: number | undefined) => (count === undefined ? '—' : count)

export default function OverviewPanel({ peopleCount, taskTotal, tasks, attendance, canAct, frozen, reviews }: Props) {
  const today = dayIn(SERVER_TIME_ZONE)
  const cards = [
    { label: 'Team Members', value: show(peopleCount), tone: 'text-blue-600' },
    { label: 'Total Tasks', value: show(taskTotal), tone: 'text-indigo-600' },
    {
      label: frozen ? 'Tasks waiting for an admin' : 'Tasks awaiting approval',
      value: show(tasks.count),
      tone: 'text-purple-600',
    },
    {
      label: frozen ? 'Attendance waiting for an admin' : 'Attendance to review',
      value: show(attendance.count),
      tone: 'text-yellow-600',
    },
  ]

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <li key={card.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`mt-1 text-3xl font-bold ${card.tone}`}>{card.value}</p>
          </li>
        ))}
      </ul>

      {frozen ? (
        <FrozenBanner>
          {plural(tasks.count ?? 0, 'task')} and {plural(attendance.count ?? 0, 'attendance record')} are waiting for an admin to
          review. Nothing can be approved here until the team is unfrozen.
        </FrozenBanner>
      ) : (
        <>
          <section aria-labelledby="overview-tasks-heading" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 id="overview-tasks-heading" className="mb-3 font-semibold text-gray-800">
              Tasks Awaiting Your Approval
            </h2>
            {tasks.error ? (
              <ErrorBlock message={tasks.error} onRetry={tasks.reload} retrying={tasks.loading} />
            ) : tasks.loading && tasks.count === undefined ? (
              <LoadingBlock label="Loading tasks…" />
            ) : tasks.items.length === 0 ? (
              <EmptyBlock>Nothing is waiting for your approval.</EmptyBlock>
            ) : (
              <ul className="space-y-3">
                {tasks.items.map((task) => (
                  <li key={task._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-purple-50 p-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link to={`/tasks?task=${task._id}`} className="font-medium text-gray-900 hover:underline">
                        {task.title}
                      </Link>
                      <p className="text-xs text-gray-600">
                        Requested by {task.completionRequestedBy?.name ?? task.assignedTo[0]?.name ?? 'someone'}
                        {task.completionRequestedAt || task.reviewRequestedAt
                          ? ` · ${formatDateTime(task.completionRequestedAt ?? task.reviewRequestedAt)}`
                          : ''}
                        {(task.assigneeCount ?? 0) > 1 ? ` · ${task.doneCount ?? 0} of ${task.assigneeCount} finished` : ''}
                      </p>
                    </div>
                    {canAct && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void reviews.approveTask(task)}
                          disabled={reviews.isTaskBusy(task)}
                          aria-label={`Approve ${task.title}`}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {reviews.isTaskBusy(task) ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void reviews.rejectTask(task)}
                          disabled={reviews.isTaskBusy(task)}
                          aria-label={`Reject ${task.title}`}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="overview-attendance-heading" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 id="overview-attendance-heading" className="mb-3 font-semibold text-gray-800">
              Attendance Requests
            </h2>
            {attendance.error ? (
              <ErrorBlock message={attendance.error} onRetry={attendance.reload} retrying={attendance.loading} />
            ) : attendance.loading && attendance.count === undefined ? (
              <LoadingBlock label="Loading attendance…" />
            ) : attendance.items.length === 0 ? (
              <EmptyBlock>No attendance is waiting for your approval.</EmptyBlock>
            ) : (
              <ul className="space-y-3">
                {attendance.items.map((record) => {
                  const ready = attendanceReviewable(record, today)
                  const name = record.user?.name ?? 'Former member'
                  const day = formatDay(record.day ?? record.date)
                  return (
                    <li key={record._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-yellow-50 p-3">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="font-medium text-gray-900">{name}</p>
                        <p className="text-xs text-gray-600">
                          {day}
                          {record.checkInTime ? ` · In ${formatTime(record.checkInTime)}` : ''}
                          {record.checkOutTime ? ` · Out ${formatTime(record.checkOutTime)}` : ''}
                          {record.remarks ? ` · “${record.remarks}”` : ''}
                        </p>
                      </div>
                      {ready && canAct ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void reviews.approveAttendance(record)}
                            disabled={reviews.isAttendanceBusy(record)}
                            aria-label={`Approve attendance of ${name} on ${day}`}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {reviews.isAttendanceBusy(record) ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void reviews.rejectAttendance(record)}
                            disabled={reviews.isAttendanceBusy(record)}
                            aria-label={`Reject attendance of ${name} on ${day}`}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">Not checked out yet</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
