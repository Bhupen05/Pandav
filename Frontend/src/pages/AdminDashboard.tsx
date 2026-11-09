import { useCallback, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CalendarCheck,
  ClipboardList,
  Inbox,
  ListChecks,
  Mail,
  RefreshCw,
  ScrollText,
  BarChart3,
  ShieldAlert,
  Users,
  UsersRound,
} from 'lucide-react'
import { adminAPI, type AdminStats, type AttendanceRow, type ListResponse, type TaskRow } from '../api/adminAPI'
import { useAuth } from '../context/useAuth'
import { Avatar, Badge, ErrorNotice, Loadable, StatTile } from '../components/admin/ui'
import { Tabs, TabPanel, type TabItem } from '../components/admin/Tabs'
import { PersonBadges } from '../components/admin/PersonBadges'
import { useResource } from '../components/admin/useResource'
import { useReview, type ReviewArea } from '../components/admin/useReview'
import { formatDateTime, formatDay, formatTime } from '../components/admin/format'
import { TASK_STATUS_LABELS, dayTypeLabel, dayTypeTone, priorityLabel, priorityTone } from '../components/admin/labels'
import { BTN } from '../components/admin/buttons'

type Tab = 'overview' | 'tasks' | 'attendance' | 'users' | 'moderation'
const TAB_KEYS: Tab[] = ['overview', 'tasks', 'attendance', 'users', 'moderation']

// Attendance records waiting for a decision that aren't days of a leave request
const waitingRecords = (rows: AttendanceRow[] = []) => rows.filter((row) => !row.leaveRequestId)

// What "Approvals" counts, everywhere on this page and in the inbox: tasks
// waiting for review, attendance records and leave requests waiting for a
// decision, asked-for corrections, and posts waiting for approval
const approvalCount = (stats: AdminStats | undefined, attendance: number | null, leave: number | null) =>
  stats && attendance !== null && leave !== null
    ? stats.tasks.awaitingReview + attendance + leave + stats.attendance.correctionRequests + stats.social.pendingApproval
    : null

export default function AdminDashboard() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()

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

  // Every part loads and refreshes on its own: an action reloads only what it changed
  const stats = useResource(useCallback((signal: AbortSignal) => adminAPI.getStats({ signal }), []))
  const toReview = useResource(useCallback((signal: AbortSignal) => adminAPI.getTasksToReview({ page: 1, limit: 5 }, { signal }), []))
  const overdue = useResource(
    useCallback((signal: AbortSignal) => adminAPI.getTasks({ overdue: true, sort: 'dueDate', page: 1, limit: 5 }, { signal }), []),
  )
  const waiting = useResource(
    useCallback((signal: AbortSignal) => adminAPI.getAttendance({ approvalStatus: 'pending', reviewable: true, page: 1, limit: 200 }, { signal }), []),
  )
  const leaveWaiting = useResource(useCallback((signal: AbortSignal) => adminAPI.getLeaveRequests({ status: 'pending', page: 1, limit: 1 }, { signal }), []))
  const recentPeople = useResource(
    useCallback(
      (signal: AbortSignal) => (tab === 'users' ? adminAPI.getUsers({ sort: '-createdAt', page: 1, limit: 8 }, { signal }) : Promise.resolve(null)),
      [tab],
    ),
  )

  const reloadStats = stats.reload
  const reloadToReview = toReview.reload
  const reloadOverdue = overdue.reload
  const reloadWaiting = waiting.reload
  const reloadLeave = leaveWaiting.reload
  const review = useReview(
    useCallback(
      (area: ReviewArea) => {
        if (area === 'tasks') {
          reloadToReview()
          reloadOverdue()
        }
        if (area === 'attendance') reloadWaiting()
        if (area === 'leave') reloadLeave()
        reloadStats()
      },
      [reloadToReview, reloadOverdue, reloadWaiting, reloadLeave, reloadStats],
    ),
  )

  const refreshAll = () => {
    stats.reload()
    toReview.reload()
    overdue.reload()
    waiting.reload()
    leaveWaiting.reload()
    recentPeople.reload()
  }

  const figures = stats.data
  const waitingList = waitingRecords(waiting.data?.data)
  const waitingCount = waiting.data ? waitingList.length : null
  const leaveCount = leaveWaiting.data ? leaveWaiting.data.pagination?.total ?? leaveWaiting.data.data.length : null
  const approvals = approvalCount(figures, waitingCount, leaveCount)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const taskTotal = figures ? Object.values(figures.tasks.byStatus).reduce((sum, n) => sum + n, 0) : null
  const cancelled = figures?.tasks.byStatus.cancelled ?? 0
  const open = figures ? taskTotal! - (figures.tasks.byStatus.completed ?? 0) - cancelled : null
  const rate = figures && taskTotal! - cancelled > 0 ? Math.round(((figures.tasks.byStatus.completed ?? 0) / (taskTotal! - cancelled)) * 100) : figures ? 0 : null

  const tabs: TabItem<Tab>[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks', count: open },
    { key: 'attendance', label: 'Attendance', count: waitingCount },
    { key: 'users', label: 'Users', count: figures ? figures.users.total : null },
    { key: 'moderation', label: 'Moderation', count: figures ? figures.social.flagged : null },
  ]

  return (
    <div className="min-h-screen bg-neutral-50 p-4 sm:p-6">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 md:text-3xl">
            {greeting}, {user?.name?.split(' ')[0] || 'Admin'}
          </h1>
          <p className="mt-1 text-neutral-600">Here&apos;s what&apos;s happening with your team today</p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className={`${BTN.md} ${BTN.neutral} self-start`}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </header>

      {stats.error !== undefined && (
        <div className="mb-6">
          <ErrorNotice error={stats.error} fallback="Could not load the headline figures" onRetry={stats.reload} />
        </div>
      )}

      <section aria-label="Headline figures" className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total tasks" value={taskTotal ?? '…'} />
        <StatTile label="Open tasks" value={open ?? '…'} tone="text-amber-600" hint={figures ? `${figures.tasks.overdue} overdue` : undefined} />
        <StatTile label="Completion rate" value={rate === null ? '…' : `${rate}%`} tone="text-emerald-600" />
        <StatTile label="Pending approvals" value={approvals ?? '…'} tone="text-purple-600" to="/approvals" hint="Tasks, attendance, corrections, posts" />
        <StatTile
          label="Active people"
          value={
            figures ? (
              <>
                {figures.users.active}
                <span className="text-sm text-neutral-400">/{figures.users.total}</span>
              </>
            ) : (
              '…'
            )
          }
          tone="text-blue-600"
          to="/admin/users"
        />
        <StatTile label="Checked in today" value={figures?.attendance.checkedInToday ?? '…'} tone="text-cyan-600" to="/admin/attendance" />
      </section>

      <section aria-label="Quick actions" className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <QuickAction to="/approvals" icon={<ListChecks />} label="Approvals" badge={approvals} tone="bg-red-500" />
          <QuickAction to="/admin/users" icon={<Users />} label="People" />
          <QuickAction to="/admin/teams" icon={<UsersRound />} label="Teams" />
          <QuickAction to="/tasks" icon={<ClipboardList />} label="All tasks" />
          <QuickAction to="/admin/attendance" icon={<CalendarCheck />} label="Team attendance" />
          <QuickAction to="/admin/messages" icon={<Inbox />} label="Messages" badge={figures?.contact.byStatus.new ?? null} tone="bg-purple-500" hint="new" />
          <QuickAction to="/admin/moderation" icon={<ShieldAlert />} label="Moderation" badge={figures?.social.flagged ?? null} tone="bg-orange-500" hint="flagged" />
          <QuickAction to="/admin/audit" icon={<ScrollText />} label="Audit log" />
          <QuickAction to="/admin/reports" icon={<BarChart3 />} label="Reports" className="col-span-2 sm:col-span-1" />
        </div>
      </section>

      <Tabs id="admin-dashboard" label="Dashboard sections" tabs={tabs} value={tab} onChange={setTab} />

      <TabPanel id="admin-dashboard" active={tab}>
        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <OverdueCard resource={overdue} total={figures?.tasks.overdue} />
              <CompletionRequests resource={toReview} review={review} total={figures?.tasks.awaitingReview} />
            </div>
            <div className="space-y-6">
              <AttendanceRequests resource={waiting} rows={waitingList.slice(0, 5)} review={review} total={waitingCount ?? undefined} />
              <Card title="Messages">
                <p className="text-sm text-neutral-700">
                  {figures
                    ? figures.contact.byStatus.new > 0
                      ? `${figures.contact.byStatus.new} new ${figures.contact.byStatus.new === 1 ? 'message' : 'messages'} from the contact form.`
                      : 'No new messages from the contact form.'
                    : 'Loading...'}
                </p>
                <Link to="/admin/messages" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Open messages
                </Link>
              </Card>
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <div className="space-y-6">
            <Card title="Tasks by status" action={<Link to="/tasks" className="text-sm font-medium text-emerald-700 hover:underline">Open all tasks</Link>}>
              {figures ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {Object.entries(TASK_STATUS_LABELS).map(([status, label]) => (
                    <div key={status} className="rounded-lg bg-neutral-50 p-3 text-center">
                      <p className="text-2xl font-semibold text-neutral-900">{figures.tasks.byStatus[status] ?? 0}</p>
                      <p className="text-xs text-neutral-600">{label}</p>
                    </div>
                  ))}
                  <div className="rounded-lg bg-red-50 p-3 text-center">
                    <p className="text-2xl font-semibold text-red-700">{figures.tasks.overdue}</p>
                    <p className="text-xs text-red-800">Overdue</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-neutral-500">{stats.error !== undefined ? 'The figures did not load.' : 'Loading...'}</p>
              )}
            </Card>
            <OverdueCard resource={overdue} total={figures?.tasks.overdue} />
            <CompletionRequests resource={toReview} review={review} total={figures?.tasks.awaitingReview} />
          </div>
        )}

        {tab === 'attendance' && (
          <AttendanceRequests
            resource={waiting}
            rows={waitingList.slice(0, 10)}
            review={review}
            total={waitingCount ?? undefined}
            wide
          />
        )}

        {tab === 'users' && (
          <div className="space-y-6">
            {figures && (
              <Card title="People by role">
                <div className="flex flex-wrap gap-6 text-sm text-neutral-700">
                  <span className="text-emerald-700">{figures.users.active} active</span>
                  <span className="text-neutral-600">{figures.users.total - figures.users.active} inactive</span>
                  {(['admin', 'team_leader', 'team_member', 'user'] as const).map((role) => (
                    <span key={role}>
                      {figures.users.byRole[role] ?? 0} {{ admin: 'admins', team_leader: 'team leaders', team_member: 'team members', user: 'users' }[role]}
                    </span>
                  ))}
                </div>
              </Card>
            )}
            <Card title="Newest accounts" action={<Link to="/admin/users" className="text-sm font-medium text-emerald-700 hover:underline">Manage people</Link>}>
              <Loadable
                data={recentPeople.data ?? undefined}
                error={recentPeople.error}
                loading={recentPeople.loading}
                onRetry={recentPeople.reload}
                errorFallback="Could not load the people list"
                isEmpty={(data) => data.data.length === 0}
                empty="There are no accounts yet."
              >
                {(data) => (
                  <ul className="divide-y divide-neutral-100">
                    {data.data.map((person) => (
                      <li key={person._id} className="flex flex-wrap items-center gap-3 py-3">
                        <Avatar name={person.name} image={person.profileImage} size="sm" />
                        <div className="min-w-0 flex-1">
                          <Link to={`/admin/users/${person._id}`} className="font-medium text-neutral-900 hover:underline">
                            {person.name}
                          </Link>
                          <p className="truncate text-xs text-neutral-500">{person.email}</p>
                        </div>
                        <PersonBadges user={person} />
                      </li>
                    ))}
                  </ul>
                )}
              </Loadable>
              {totalOf(recentPeople.data) > 8 && (
                <p className="mt-3 text-xs text-neutral-500">
                  Showing the newest 8 of {totalOf(recentPeople.data)}. <Link to="/admin/users" className="font-medium text-emerald-700 hover:underline">See everyone</Link>
                </p>
              )}
            </Card>
          </div>
        )}

        {tab === 'moderation' && (
          <Card title="Social Hub">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile label="Flagged posts" value={figures?.social.flagged ?? '…'} tone="text-orange-600" to="/admin/moderation" hint="Review them on the Moderation page" />
              <StatTile label="Posts waiting for approval" value={figures?.social.pendingApproval ?? '…'} tone="text-purple-600" to="/approvals?tab=posts" hint="Decide them in Approvals" />
            </div>
          </Card>
        )}
      </TabPanel>
    </div>
  )
}

const totalOf = (data: { pagination?: { total: number } } | null | undefined) => data?.pagination?.total ?? 0

function QuickAction({
  to,
  icon,
  label,
  badge,
  tone = 'bg-red-500',
  hint,
  className = '',
}: {
  to: string
  icon: ReactNode
  label: string
  badge?: number | null
  tone?: string
  hint?: string
  className?: string
}) {
  const showBadge = typeof badge === 'number' && badge > 0
  return (
    <Link
      to={to}
      className={`relative flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-4 text-center transition-colors hover:bg-neutral-50 ${className}`}
    >
      <span className="text-neutral-600 [&>svg]:h-6 [&>svg]:w-6" aria-hidden="true">
        {icon}
      </span>
      <span className="text-sm text-neutral-700">{label}</span>
      {showBadge && (
        <span className={`absolute -top-1 -right-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs text-white ${tone}`}>
          {badge}
          <span className="sr-only">{hint ? ` ${hint}` : ' waiting'}</span>
        </span>
      )}
    </Link>
  )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

type Review = ReturnType<typeof useReview>

function OverdueCard({ resource, total }: { resource: ReturnType<typeof useResource<ListResponse<TaskRow>>>; total?: number }) {
  return (
    <section aria-label="Overdue tasks" className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
      <h3 className="mb-3 text-lg font-semibold text-red-800">Overdue tasks{typeof total === 'number' ? ` (${total})` : ''}</h3>
      <Loadable
        data={resource.data}
        error={resource.error}
        loading={resource.loading}
        onRetry={resource.reload}
        errorFallback="Could not load the overdue tasks"
        isEmpty={(data) => data.data.length === 0}
        empty="Nothing is overdue."
      >
        {(data) => (
          <>
            <ul className="space-y-2">
              {data.data.map((task) => (
                <li key={task._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="min-w-0">
                    <Link to={`/tasks?task=${task._id}`} className="font-medium text-neutral-900 hover:underline">
                      {task.title}
                    </Link>
                    <p className="text-xs text-red-700">
                      Due {formatDay(task.dueDay)} · {(task.assignedTo ?? []).map((person) => person.name).join(', ') || 'Unassigned'}
                    </p>
                  </div>
                  <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
                </li>
              ))}
            </ul>
            {typeof total === 'number' && total > data.data.length && (
              <Link to="/tasks" className="mt-3 inline-block text-sm font-medium text-red-800 hover:underline">
                See all {total} overdue tasks
              </Link>
            )}
          </>
        )}
      </Loadable>
    </section>
  )
}

function CompletionRequests({ resource, review, total }: { resource: ReturnType<typeof useResource<ListResponse<TaskRow>>>; review: Review; total?: number }) {
  return (
    <Card
      title={`Completion requests${typeof total === 'number' && total > 0 ? ` (${total})` : ''}`}
      action={<Link to="/approvals" className="text-sm font-medium text-emerald-700 hover:underline">Open approvals</Link>}
    >
      <Loadable
        data={resource.data}
        error={resource.error}
        loading={resource.loading}
        onRetry={resource.reload}
        errorFallback="Could not load the completion requests"
        isEmpty={(data) => data.data.length === 0}
        empty="No tasks are waiting for review."
      >
        {(data) => (
          <ul className="space-y-2">
            {data.data.map((task) => {
              const busy = review.isBusy(`task:${task._id}`)
              const asked = task.reviewRequestedAt || task.completionRequestedAt
              return (
                <li key={task._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-100 bg-purple-50 p-3">
                  <div className="min-w-0 flex-1">
                    <Link to={`/tasks?task=${task._id}`} className="block font-medium break-words text-neutral-900 hover:underline">
                      {task.title}
                    </Link>
                    <p className="text-xs text-neutral-600">
                      {(task.assignedTo ?? []).map((person) => person.name).join(', ') || 'Unassigned'}
                      {asked && ` · ${formatDateTime(asked)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => review.approveTask(task)} aria-label={`Approve ${task.title}`} className={`${BTN.sm} ${BTN.success}`}>
                      Approve
                    </button>
                    <button type="button" disabled={busy} onClick={() => review.rejectTask(task)} aria-label={`Reject ${task.title}`} className={`${BTN.sm} ${BTN.danger}`}>
                      Reject
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Loadable>
    </Card>
  )
}

function AttendanceRequests({
  resource,
  rows,
  review,
  total,
  wide = false,
}: {
  resource: ReturnType<typeof useResource<ListResponse<AttendanceRow>>>
  rows: AttendanceRow[]
  review: Review
  total?: number
  wide?: boolean
}) {
  return (
    <Card
      title={`Attendance requests${typeof total === 'number' && total > 0 ? ` (${total})` : ''}`}
      action={
        <Link to={wide ? '/admin/attendance' : '/approvals?tab=attendance'} className="text-sm font-medium text-emerald-700 hover:underline">
          {wide ? 'View full attendance' : 'Open approvals'}
        </Link>
      }
    >
      <Loadable
        data={resource.data}
        error={resource.error}
        loading={resource.loading}
        onRetry={resource.reload}
        errorFallback="Could not load the attendance requests"
        isEmpty={() => rows.length === 0}
        empty="No attendance is waiting for approval."
      >
        {() => (
          <ul className="space-y-2">
            {rows.map((row) => {
              const busy = review.isBusy(`attendance:${row._id}`)
              const name = `${row.user.name}, ${formatDay(row.day)}`
              return (
                <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">{row.user.name}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
                      {formatDay(row.day)}
                      <Badge tone={dayTypeTone(row.status)}>{dayTypeLabel(row.status)}</Badge>
                      {row.checkInTime && (
                        <span>
                          {formatTime(row.checkInTime)}
                          {row.checkOutTime ? ` to ${formatTime(row.checkOutTime)}` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => review.approveAttendance(row)} aria-label={`Approve ${name}`} className={`${BTN.sm} ${BTN.success}`}>
                      Approve
                    </button>
                    <button type="button" disabled={busy} onClick={() => review.rejectAttendance(row)} aria-label={`Reject ${name}`} className={`${BTN.sm} ${BTN.danger}`}>
                      Reject
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Loadable>
    </Card>
  )
}
