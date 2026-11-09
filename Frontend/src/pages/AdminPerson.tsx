import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Pencil, ScrollText } from 'lucide-react'
import { adminAPI, type AdminUser, type AttendanceRow, type MonthSummary, type TaskRow, type TaskSummary } from '../api/adminAPI'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import { AdminHeader, Avatar, Badge, ErrorNotice, Loadable, Pager, Spinner } from '../components/admin/ui'
import { Tabs, TabPanel, type TabItem } from '../components/admin/Tabs'
import { Modal } from '../components/admin/Modal'
import { PersonActionButtons } from '../components/admin/PersonActionButtons'
import { PersonBadges } from '../components/admin/PersonBadges'
import { usePersonActions } from '../components/admin/usePersonActions'
import { useResource } from '../components/admin/useResource'
import { useBusy } from '../components/admin/useBusy'
import { dayKey, errorText, formatDateTime, formatDay, formatHours, formatTime } from '../components/admin/format'
import {
  approvalLabel,
  approvalTone,
  dayTypeLabel,
  dayTypeTone,
  priorityLabel,
  priorityTone,
  taskStatusLabel,
  taskStatusTone,
} from '../components/admin/labels'
import { BTN, FIELD, LABEL } from '../components/admin/buttons'

type Tab = 'overview' | 'tasks' | 'attendance'
const TAB_KEYS: Tab[] = ['overview', 'tasks', 'attendance']
const TABLE_PAGE = 15

// Switching to another person starts a fresh page, so nothing of the
// previous person stays on screen and their late answers are dropped
export default function AdminPerson() {
  const { id = '' } = useParams()
  return <PersonView key={id} id={id} />
}

function PersonView({ id }: { id: string }) {
  const { user: me } = useAuth()
  const navigate = useNavigate()
  const { notify } = useFeedback()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [month, setMonth] = useState(() => dayKey().slice(0, 7))
  const [taskPage, setTaskPage] = useState(1)
  const [attendancePage, setAttendancePage] = useState(1)

  const tab: Tab = TAB_KEYS.find((key) => key === params.get('tab')) ?? 'overview'
  const setTab = (next: Tab) =>
    setParams(
      (previous) => {
        const copy = new URLSearchParams(previous)
        if (next === 'overview') copy.delete('tab')
        else copy.set('tab', next)
        return copy
      },
      { replace: true },
    )

  const person = useResource(useCallback((signal: AbortSignal) => adminAPI.getUser(id, { signal }), [id]))
  const teams = useResource(useCallback((signal: AbortSignal) => adminAPI.getTeams({ signal }), []))
  const taskSummary = useResource(useCallback((signal: AbortSignal) => adminAPI.getTaskSummary({ assignedTo: id }, { signal }), [id]))
  const recentTasks = useResource(
    useCallback((signal: AbortSignal) => adminAPI.getTasks({ assignedTo: id, sort: '-createdAt', page: 1, limit: 5 }, { signal }), [id]),
  )
  const monthSummary = useResource(useCallback((signal: AbortSignal) => adminAPI.getMonthSummary(id, month, { signal }), [id, month]))
  const tasks = useResource(
    useCallback(
      (signal: AbortSignal) =>
        tab === 'tasks' ? adminAPI.getTasks({ assignedTo: id, sort: '-createdAt', page: taskPage, limit: TABLE_PAGE }, { signal }) : Promise.resolve(null),
      [id, tab, taskPage],
    ),
  )
  const attendance = useResource(
    useCallback(
      (signal: AbortSignal) =>
        tab === 'attendance' ? adminAPI.getAttendance({ user: id, page: attendancePage, limit: TABLE_PAGE }, { signal }) : Promise.resolve(null),
      [id, tab, attendancePage],
    ),
  )

  const actions = usePersonActions(
    person.reload,
    useCallback(() => navigate('/admin/users', { replace: true }), [navigate]),
  )

  if (person.error !== undefined && !person.data) {
    return (
      <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
        <AdminHeader title="Person" back={{ to: '/admin/users', label: 'Back to people' }} />
        <div className="mx-auto max-w-5xl px-4 py-6">
          <ErrorNotice error={person.error} fallback="Could not load this person" onRetry={person.reload} />
        </div>
      </div>
    )
  }

  const user = person.data
  if (!user) {
    return (
      <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
        <AdminHeader title="Person" back={{ to: '/admin/users', label: 'Back to people' }} />
        <div className="mx-auto max-w-5xl px-4 py-6">
          <Spinner label="Loading this person" />
        </div>
      </div>
    )
  }

  const team = user.teamId ? teams.data?.find((item) => item._id === user.teamId)?.name ?? 'In a team' : 'No team'
  const deleted = Boolean(user.deletedAt)

  const tabs: TabItem<Tab>[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks', count: taskSummary.data?.total ?? null },
    { key: 'attendance', label: 'Attendance' },
  ]

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <AdminHeader title={user.name} subtitle={deleted ? 'This account was deleted' : user.email} back={{ to: '/admin/users', label: 'Back to people' }} />

      <div className="mx-auto max-w-7xl px-4 py-6">
        {person.error !== undefined && (
          <div className="mb-4">
            <ErrorNotice error={person.error} fallback="Could not refresh this person" onRetry={person.reload} compact />
          </div>
        )}

        {deleted && (
          <p role="status" className="mb-4 rounded-xl border border-neutral-200 bg-neutral-100 p-4 text-sm text-neutral-700">
            This account was deleted on {formatDateTime(user.deletedAt)}. Its personal details were removed and it can no longer be used. What it did is kept
            under &quot;Deleted user&quot;.
          </p>
        )}

        <section aria-label="Profile" className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <Avatar name={user.name} image={user.profileImage} size="lg" />
              <div className="min-w-0">
                <h2 className="text-xl font-bold break-words text-neutral-900">
                  {user.name}
                  {user._id === me?._id && <span className="ml-2 text-sm font-normal text-neutral-500">(you)</span>}
                </h2>
                <p className="break-all text-sm text-neutral-500">{user.email}</p>
                <div className="mt-2">
                  <PersonBadges user={user} extra />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-center">
              <Figure label="Tasks" value={taskSummary.data?.total} loading={taskSummary.loading} />
              <Figure label="Completed" value={taskSummary.data?.byStatus.completed} loading={taskSummary.loading} tone="text-emerald-600" />
              <Figure label="Hours this month" value={monthSummary.data ? formatHours(monthSummary.data.approvedHours) : undefined} loading={monthSummary.loading} tone="text-blue-600" />
            </div>
          </div>

          <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-neutral-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Team" value={team} />
            <Detail label="Department" value={user.department} />
            <Detail label="Phone" value={user.phone} />
            <Detail label="Last sign-in" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'} />
            <Detail label="Joined" value={user.createdAt ? formatDateTime(user.createdAt) : undefined} />
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
            {!deleted && (
              <button type="button" onClick={() => setEditing(true)} className={`${BTN.sm} ${BTN.neutral}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit details
              </button>
            )}
            <PersonActionButtons user={user} actions={actions} selfId={me?._id} />
            <Link to={`/admin/audit?actor=${user._id}&actorName=${encodeURIComponent(user.name)}`} className={`${BTN.sm} ${BTN.neutral} sm:ml-auto`}>
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              What they did
            </Link>
          </div>
        </section>

        <Tabs id="person" label="About this person" tabs={tabs} value={tab} onChange={setTab} />

        <TabPanel id="person" active={tab}>
          {tab === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <TaskSummaryCard summary={taskSummary} />
              <AttendanceSummaryCard summary={monthSummary} month={month} onMonth={setMonth} />
              <section aria-label="Recent tasks" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-2">
                <h3 className="mb-3 text-lg font-semibold text-neutral-900">Recent tasks</h3>
                <Loadable
                  data={recentTasks.data}
                  error={recentTasks.error}
                  loading={recentTasks.loading}
                  onRetry={recentTasks.reload}
                  errorFallback="Could not load their tasks"
                  isEmpty={(data) => data.data.length === 0}
                  empty="No tasks assigned to this person."
                >
                  {(data) => (
                    <ul className="divide-y divide-neutral-100">
                      {data.data.map((task) => (
                        <li key={task._id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <Link to={`/tasks?task=${task._id}`} className="font-medium text-neutral-900 hover:underline">
                              {task.title}
                            </Link>
                            <p className="text-xs text-neutral-500">Due {formatDay(task.dueDay)}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
                            <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                            {task.isOverdue && <Badge tone="red">Overdue</Badge>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Loadable>
              </section>
            </div>
          )}

          {tab === 'tasks' && (
            <Loadable
              data={tasks.data ?? undefined}
              error={tasks.error}
              loading={tasks.loading}
              onRetry={tasks.reload}
              errorFallback="Could not load their tasks"
              isEmpty={(data) => data.data.length === 0}
              empty="No tasks found for this person."
            >
              {(data) => (
                <>
                  <TableBox label="Tasks">
                    <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
                      <tr>
                        <th scope="col" className="px-4 py-3">Task</th>
                        <th scope="col" className="px-4 py-3">Status</th>
                        <th scope="col" className="px-4 py-3">Priority</th>
                        <th scope="col" className="px-4 py-3">Start</th>
                        <th scope="col" className="px-4 py-3">Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {data.data.map((task: TaskRow) => (
                        <tr key={task._id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3">
                            <Link to={`/tasks?task=${task._id}`} className="font-medium text-neutral-900 hover:underline">
                              {task.title}
                            </Link>
                            {task.description && <p className="max-w-xs truncate text-xs text-neutral-500">{task.description}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{formatDay(task.startDate?.slice(0, 10))}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-neutral-700">
                            {formatDay(task.dueDay)}
                            {task.isOverdue && <Badge tone="red" className="ml-2">Overdue</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableBox>
                  <Pager
                    page={data.pagination?.page ?? taskPage}
                    pages={data.pagination?.pages ?? 1}
                    total={data.pagination?.total}
                    label="Task pages"
                    onPage={setTaskPage}
                  />
                </>
              )}
            </Loadable>
          )}

          {tab === 'attendance' && (
            <Loadable
              data={attendance.data ?? undefined}
              error={attendance.error}
              loading={attendance.loading}
              onRetry={attendance.reload}
              errorFallback="Could not load their attendance"
              isEmpty={(data) => data.data.length === 0}
              empty="No attendance records for this person."
            >
              {(data) => (
                <>
                  <TableBox label="Attendance records">
                    <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
                      <tr>
                        <th scope="col" className="px-4 py-3">Day</th>
                        <th scope="col" className="px-4 py-3">Day type</th>
                        <th scope="col" className="px-4 py-3">Approval</th>
                        <th scope="col" className="px-4 py-3">Check in</th>
                        <th scope="col" className="px-4 py-3">Check out</th>
                        <th scope="col" className="px-4 py-3">Hours</th>
                        <th scope="col" className="px-4 py-3">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {data.data.map((record: AttendanceRow) => (
                        <tr key={record._id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3 font-medium whitespace-nowrap text-neutral-900">{formatDay(record.day)}</td>
                          <td className="px-4 py-3">
                            <Badge tone={dayTypeTone(record.status)}>{dayTypeLabel(record.status)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={approvalTone(record.approvalStatus)}>{approvalLabel(record.approvalStatus)}</Badge>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{formatTime(record.checkInTime)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{formatTime(record.checkOutTime)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{record.workHours ? formatHours(record.workHours) : '—'}</td>
                          <td className="max-w-xs px-4 py-3 text-xs text-neutral-600">
                            {record.remarks && <p className="break-words">{record.remarks}</p>}
                            {record.reviewRemarks && <p className="break-words text-neutral-500">Reviewer: {record.reviewRemarks}</p>}
                            {!record.remarks && !record.reviewRemarks && '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableBox>
                  <Pager
                    page={data.pagination?.page ?? attendancePage}
                    pages={data.pagination?.pages ?? 1}
                    total={data.pagination?.total}
                    label="Attendance pages"
                    onPage={setAttendancePage}
                  />
                </>
              )}
            </Loadable>
          )}
        </TabPanel>
      </div>

      {editing && (
        <EditDetails
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            notify('Details saved.', 'success')
            person.reload()
          }}
        />
      )}
    </div>
  )
}

function Figure({ label, value, loading, tone = 'text-neutral-900' }: { label: string; value?: ReactNode; loading: boolean; tone?: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${tone}`}>{value ?? (loading ? '…' : '—')}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="break-words text-neutral-800">{value || '—'}</dd>
    </div>
  )
}

// A table that scrolls inside its own box on narrow screens
function TableBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  )
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-neutral-100" role="presentation">
      <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: ReactNode; tone: string }) {
  return (
    <div className={`rounded-xl p-4 text-center ${tone}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  )
}

function TaskSummaryCard({ summary }: { summary: ReturnType<typeof useResource<TaskSummary>> }) {
  return (
    <section aria-label="Task summary" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-neutral-900">Task summary</h3>
      <Loadable data={summary.data} error={summary.error} loading={summary.loading} onRetry={summary.reload} errorFallback="Could not load the task summary">
        {(data) => (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tile label="Pending" value={data.byStatus.pending ?? 0} tone="bg-amber-50 text-amber-800" />
              <Tile label="In progress" value={data.byStatus['in-progress'] ?? 0} tone="bg-blue-50 text-blue-800" />
              <Tile label="Awaiting review" value={data.byStatus['completion-requested'] ?? 0} tone="bg-purple-50 text-purple-800" />
              <Tile label="Completed" value={data.byStatus.completed ?? 0} tone="bg-emerald-50 text-emerald-800" />
              <Tile label="Overdue" value={data.overdue} tone="bg-red-50 text-red-800" />
              <Tile label="Cancelled" value={data.byStatus.cancelled ?? 0} tone="bg-neutral-100 text-neutral-700" />
            </div>
            {data.total - (data.byStatus.cancelled ?? 0) > 0 && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-neutral-600">
                  <span>Completed, leaving out cancelled tasks</span>
                  <span>{data.completionRate}%</span>
                </div>
                <Bar percent={data.completionRate} />
              </div>
            )}
          </>
        )}
      </Loadable>
    </section>
  )
}

function AttendanceSummaryCard({
  summary,
  month,
  onMonth,
}: {
  summary: ReturnType<typeof useResource<MonthSummary>>
  month: string
  onMonth: (month: string) => void
}) {
  return (
    <section aria-label="Attendance summary" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-neutral-900">Attendance summary</h3>
        <div className="flex items-center gap-2">
          <label htmlFor="person-month" className="text-xs text-neutral-600">
            Month
          </label>
          <input
            id="person-month"
            type="month"
            value={month}
            max={dayKey().slice(0, 7)}
            onChange={(event) => event.target.value && onMonth(event.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
        </div>
      </div>
      <Loadable data={summary.data} error={summary.error} loading={summary.loading} onRetry={summary.reload} errorFallback="Could not load the attendance summary">
        {(data) => {
          // Approved days only. Leave is excused, so it stays out of the rate.
          const attended = data.days.present + data.days.late + data.days.halfDay
          const counted = attended + data.days.absent
          const rate = counted > 0 ? Math.round((attended / counted) * 100) : null
          return (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Tile label="Present" value={data.days.present} tone="bg-sky-50 text-sky-800" />
                <Tile label="Late" value={data.days.late} tone="bg-orange-50 text-orange-800" />
                <Tile label="Half day" value={data.days.halfDay} tone="bg-indigo-50 text-indigo-800" />
                <Tile label="Absent" value={data.days.absent} tone="bg-rose-50 text-rose-800" />
                <Tile label="Leave" value={data.days.leave} tone="bg-violet-50 text-violet-800" />
                <Tile label="Approved hours" value={formatHours(data.approvedHours)} tone="bg-blue-50 text-blue-800" />
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-neutral-600">
                  <span>Attendance rate (approved days, leave left out)</span>
                  <span>{rate === null ? '—' : `${rate}%`}</span>
                </div>
                {rate === null ? <p className="text-xs text-neutral-500">No approved working days this month yet.</p> : <Bar percent={rate} />}
              </div>
              {(data.pendingCount > 0 || data.rejectedCount > 0) && (
                <p className="mt-3 text-xs text-neutral-500">
                  {data.pendingCount > 0 && `${data.pendingCount} awaiting approval (${formatHours(data.pendingHours)}). `}
                  {data.rejectedCount > 0 && `${data.rejectedCount} rejected.`}
                </p>
              )}
            </>
          )
        }}
      </Loadable>
    </section>
  )
}

function EditDetails({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [department, setDepartment] = useState(user.department ?? '')
  const [error, setError] = useState<unknown>(undefined)
  const { run, isBusy } = useBusy()

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const changes: Record<string, string> = {}
    if (name.trim() !== user.name) changes.name = name.trim()
    if (email.trim() !== user.email) changes.email = email.trim()
    if (phone.trim() !== (user.phone ?? '')) changes.phone = phone.trim()
    if (department.trim() !== (user.department ?? '')) changes.department = department.trim()
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    setError(undefined)
    await run('save', async () => {
      try {
        await adminAPI.updateUser(user._id, changes)
        onSaved()
      } catch (saveError) {
        setError(saveError)
      }
    })
  }

  return (
    <Modal title={`Edit ${user.name}`} description="Changing the email address marks it as not confirmed, and they are asked to confirm the new one." onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="edit-name" className={LABEL}>Name</label>
          <input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} required className={FIELD} />
        </div>
        <div>
          <label htmlFor="edit-email" className={LABEL}>Email</label>
          <input id="edit-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className={FIELD} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-phone" className={LABEL}>Phone</label>
            <input id="edit-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={FIELD} />
          </div>
          <div>
            <label htmlFor="edit-department" className={LABEL}>Department</label>
            <input id="edit-department" value={department} onChange={(event) => setDepartment(event.target.value)} className={FIELD} />
          </div>
        </div>
        {error !== undefined && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorText(error, 'Could not save these details')}
          </p>
        )}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className={`${BTN.md} ${BTN.neutral} flex-1`}>
            Cancel
          </button>
          <button type="submit" disabled={isBusy('save')} className={`${BTN.md} ${BTN.success} flex-1`}>
            {isBusy('save') ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
