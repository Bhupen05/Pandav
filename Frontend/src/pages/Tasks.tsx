import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ClipboardList, Flame, RefreshCw, Search, SlidersHorizontal, Plus, CalendarClock } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import Taskscard from '../components/Taskscard'
import Tasksadd from '../components/Tasksadd'
import Pagination from '../components/Pagination'
import TaskDetail from '../components/tasks/TaskDetail'
import AssigneePicker from '../components/tasks/AssigneePicker'
import { InlineError, Spinner } from '../components/tasks/ui'
import { PRIORITY_LABEL, STATUS_LABEL } from '../components/tasks/taskFormat'
import { useTaskActions } from '../components/tasks/useTaskActions'
import { PAGE_SIZES, SORT_OPTIONS, useTaskFilters } from '../components/tasks/useTaskFilters'
import { useTaskList } from '../components/tasks/useTaskList'
import { usePeopleLoader } from '../components/tasks/usePeopleLoader'
import { useViewer } from '../components/tasks/useViewer'
import { TASK_PRIORITIES, TASK_STATUSES, type AssigneeOption, type Task, type TaskStatus } from '../components/tasks/types'

const FIELD =
  'h-10 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10'

// How each status pill looks while it is the chosen one
const PILL_ACTIVE: Record<string, string> = {
  all: 'bg-neutral-900 text-white shadow-lg',
  pending: 'bg-amber-600 text-white shadow-lg shadow-amber-200',
  'in-progress': 'bg-blue-600 text-white shadow-lg shadow-blue-200',
  'completion-requested': 'bg-purple-600 text-white shadow-lg shadow-purple-200',
  completed: 'bg-emerald-600 text-white shadow-lg shadow-emerald-200',
  cancelled: 'bg-neutral-700 text-white shadow-lg',
}

export default function Tasks() {
  const { notify } = useFeedback()
  const { user, isAdmin } = useAuth()
  const viewer = useViewer()
  const { query, taskId, activeCount, setFilters, clearFilters, openTask, closeTask } = useTaskFilters()
  const list = useTaskList(query)
  const { reload } = list
  const canCreateTasks = isAdmin || viewer.isLeader
  const loadPeople = usePeopleLoader(isAdmin)

  const searchId = useId()
  const priorityId = useId()
  const sortId = useId()
  const assigneeId = useId()
  const assigneeLabelId = useId()
  const teamId = useId()
  const fromId = useId()
  const toId = useId()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  // Goes up after an edit so an open task panel reads the task again
  const [detailRefresh, setDetailRefresh] = useState(0)
  const [showMore, setShowMore] = useState(Boolean(query.assignedTo || query.team || query.dueFrom || query.dueTo))
  const [pickedAssignee, setPickedAssignee] = useState<AssigneeOption | null>(null)

  // The search box shows what is typed at once; the list follows a moment after typing stops
  const [search, setSearch] = useState(query.q ?? '')
  const [searchInUrl, setSearchInUrl] = useState(query.q ?? '')
  if ((query.q ?? '') !== searchInUrl) {
    // The address changed on its own (Back, a link, "Clear filters"): show it
    setSearchInUrl(query.q ?? '')
    setSearch(query.q ?? '')
  }
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(debounce.current), [])

  const typeSearch = (value: string) => {
    setSearch(value)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setFilters({ q: value.trim() || undefined }), 350)
  }
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    clearTimeout(debounce.current)
    setFilters({ q: search.trim() || undefined })
  }

  // Deleting the last task of the last page leaves that page empty: go back one
  const { paging, tasks, loading, refreshing } = list
  useEffect(() => {
    if (!loading && !refreshing && paging && tasks.length === 0 && paging.total > 0 && query.page > paging.pages) {
      setFilters({ page: String(paging.pages) })
    }
  }, [loading, refreshing, paging, tasks.length, query.page, setFilters])

  const refreshList = useCallback(() => reload(true), [reload])

  // Actions on a card: results come as toasts, then the page and counts reload
  const actions = useTaskActions({
    report: notify,
    onChanged: refreshList,
    onDeleted: refreshList,
  })

  const summary = list.summary
  const total = summary?.total
  const completed = summary?.byStatus.completed ?? 0
  const counted = summary ? summary.total - (summary.byStatus.cancelled ?? 0) : 0
  const percent = summary?.completionRate ?? 0
  const firstName = user?.name?.split(' ')[0] || 'User'

  const heading = isAdmin ? 'All Tasks' : viewer.isLeader ? 'Team tasks' : 'My Tasks'
  const pills: Array<{ key: 'all' | TaskStatus; label: string; count?: number }> = [
    { key: 'all', label: 'All', count: total },
    ...TASK_STATUSES.map((status) => ({ key: status, label: STATUS_LABEL[status], count: summary?.byStatus[status] })),
  ]

  const teamOptions = Object.entries(viewer.teamNames)
  const hasFilters = activeCount > 0
  // Also while the page after a delete's last row is being fetched (see the effect above)
  const showSpinner =
    list.loading || (list.refreshing && tasks.length === 0 && !list.error) || (!!paging && paging.total > 0 && tasks.length === 0)

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      {/* Hero Header */}
      <div className="bg-linear-to-r from-blue-600 to-emerald-600 text-white">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <ClipboardList className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold md:text-3xl">{heading}</h1>
                <p className="text-sm text-white/90">Welcome back, {firstName}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`${percent} percent done`}>
                <svg aria-hidden="true" className="h-20 w-20 -rotate-90 transform">
                  <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="6" fill="none" className="text-white/25" />
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={`${percent * 2.262} 226.2`}
                    className="text-white transition-all duration-500"
                  />
                </svg>
                <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold">{percent}%</span>
                </div>
              </div>
              <div className="text-sm">
                <p className="text-white/90">Progress</p>
                <p className="font-semibold">{summary ? `${completed} of ${counted} done` : 'Counting…'}</p>
              </div>
            </div>
          </div>

          {summary && (summary.overdue > 0 || summary.urgent > 0 || summary.dueSoon > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {summary.overdue > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters({ overdue: query.overdue ? undefined : 'true' })}
                  aria-pressed={!!query.overdue}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    query.overdue ? 'bg-white text-red-700' : 'bg-red-600/80 text-white hover:bg-red-600'
                  }`}
                >
                  <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                  {summary.overdue} overdue
                </button>
              )}
              {summary.dueSoon > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-white">
                  <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
                  {summary.dueSoon} due soon
                </span>
              )}
              {summary.urgent > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-600/90 px-3 py-1 text-xs font-semibold text-white">
                  <Flame aria-hidden="true" className="h-3.5 w-3.5" />
                  {summary.urgent} urgent
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Search, filters and actions */}
        <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form role="search" onSubmit={submitSearch} className="relative flex-1">
              <label htmlFor={searchId} className="sr-only">Search tasks</label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(event) => typeSearch(event.target.value)}
                placeholder="Search title, description or tags"
                maxLength={100}
                className="w-full rounded-xl border-0 bg-neutral-100 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:bg-neutral-50 focus:ring-2 focus:ring-neutral-900"
              />
            </form>
            {canCreateTasks && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90 hover:shadow-xl"
              >
                <Plus aria-hidden="true" className="h-5 w-5" />
                New Task
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor={priorityId} className="mb-1 block text-xs font-medium text-neutral-600">Priority</label>
              <select id={priorityId} value={query.priority ?? ''} onChange={(event) => setFilters({ priority: event.target.value || undefined })} className={FIELD}>
                <option value="">Any priority</option>
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABEL[priority]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={sortId} className="mb-1 block text-xs font-medium text-neutral-600">Sort by</label>
              <select id={sortId} value={query.sort} onChange={(event) => setFilters({ sort: event.target.value })} className={FIELD}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex h-10 cursor-pointer items-center gap-2 text-sm font-medium text-neutral-700">
                <input
                  type="checkbox"
                  checked={!!query.overdue}
                  onChange={(event) => setFilters({ overdue: event.target.checked ? 'true' : undefined })}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Overdue only
              </label>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setShowMore((value) => !value)}
                aria-expanded={showMore}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                More filters
              </button>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
                >
                  Clear filters ({activeCount})
                </button>
              )}
            </div>
          </div>

          {showMore && (
            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
              {(isAdmin || viewer.isLeader) && (
                <div>
                  <span id={assigneeLabelId} className="mb-1 block text-xs font-medium text-neutral-600">Assigned to</span>
                  <AssigneePicker
                    id={assigneeId}
                    labelId={assigneeLabelId}
                    single
                    value={
                      query.assignedTo
                        ? [pickedAssignee?._id === query.assignedTo ? pickedAssignee : { _id: query.assignedTo, name: 'Selected person' }]
                        : []
                    }
                    onChange={(next) => {
                      setPickedAssignee(next[0] ?? null)
                      setFilters({ assignedTo: next[0]?._id })
                    }}
                    load={loadPeople}
                    placeholder="Anyone"
                  />
                </div>
              )}
              {isAdmin && teamOptions.length > 0 && (
                <div>
                  <label htmlFor={teamId} className="mb-1 block text-xs font-medium text-neutral-600">Team</label>
                  <select id={teamId} value={query.team ?? ''} onChange={(event) => setFilters({ team: event.target.value || undefined })} className={FIELD}>
                    <option value="">Any team</option>
                    {teamOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor={fromId} className="mb-1 block text-xs font-medium text-neutral-600">Due from</label>
                <input id={fromId} type="date" value={query.dueFrom ?? ''} max={query.dueTo} onChange={(event) => setFilters({ dueFrom: event.target.value || undefined })} className={FIELD} />
              </div>
              <div>
                <label htmlFor={toId} className="mb-1 block text-xs font-medium text-neutral-600">Due to</label>
                <input id={toId} type="date" value={query.dueTo ?? ''} min={query.dueFrom} onChange={(event) => setFilters({ dueTo: event.target.value || undefined })} className={FIELD} />
              </div>
            </div>
          )}
        </div>

        {/* Status filter pills, with counts */}
        <div role="group" aria-label="Filter by status" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {pills.map((pill) => {
            const active = (query.status ?? 'all') === pill.key
            return (
              <button
                key={pill.key}
                type="button"
                onClick={() => setFilters({ status: pill.key === 'all' ? undefined : pill.key })}
                aria-pressed={active}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  active ? PILL_ACTIVE[pill.key] : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {pill.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/25' : 'bg-neutral-100'}`}>{pill.count ?? '–'}</span>
              </button>
            )
          })}
        </div>

        {list.summaryFailed && (
          <p role="status" className="mb-4 text-sm text-neutral-600">The counts couldn't be loaded, but the list below is up to date.</p>
        )}

        {list.stale && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            The list couldn't be refreshed, so it may be out of date.
            <button type="button" onClick={() => reload(true)} className="font-medium underline">Try again</button>
          </div>
        )}

        {showSpinner ? (
          <Spinner label="Loading tasks…" />
        ) : list.error ? (
          <InlineError title="Tasks didn't load" message={list.error} onRetry={() => reload()} />
        ) : tasks.length === 0 ? (
          hasFilters ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 bg-white px-4 py-16 text-center">
              <h2 className="mb-2 text-lg font-semibold text-neutral-900">No tasks match</h2>
              <p className="mb-6 max-w-sm text-sm text-neutral-600">
                Nothing fits the search and filters you chose. Try different words, or clear the filters to see everything.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 bg-white px-4 py-16 text-center">
              <h2 className="mb-2 text-lg font-semibold text-neutral-900">No tasks yet</h2>
              <p className="max-w-sm text-sm text-neutral-600">
                {canCreateTasks
                  ? 'Nothing has been created yet. Use New Task to give someone their first task.'
                  : "Nothing has been assigned to you yet. New tasks from your team leader or an admin will show up here."}
              </p>
            </div>
          )
        ) : (
          <div className="animate-fade-in">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-neutral-600">
                <span className="font-semibold text-neutral-900">{paging?.total ?? tasks.length}</span>{' '}
                {query.status ? `${STATUS_LABEL[query.status].toLowerCase()} ` : ''}
                {(paging?.total ?? tasks.length) === 1 ? 'task' : 'tasks'}
              </p>
              <button
                type="button"
                onClick={() => reload()}
                disabled={list.refreshing}
                className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-60"
              >
                <RefreshCw aria-hidden="true" className={`h-4 w-4 ${list.refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            <div aria-busy={list.refreshing} className={list.refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <Taskscard
                tasks={tasks}
                viewer={viewer}
                busyId={actions.busyId}
                onOpen={(task) => openTask(task._id)}
                onEdit={setEditing}
                onDelete={actions.remove}
                onStart={actions.start}
                onRequestCompletion={actions.requestCompletion}
                onApprove={actions.approve}
                onReject={actions.reject}
              />
            </div>

            <div className="mt-6 border-t border-neutral-200 pt-4">
              <Pagination
                currentPage={paging?.page ?? query.page}
                totalPages={paging?.pages ?? 1}
                totalItems={paging?.total ?? tasks.length}
                itemsPerPage={paging?.limit ?? query.limit}
                disabled={list.refreshing}
                onPageChange={(page) => setFilters({ page: page > 1 ? String(page) : undefined })}
                onItemsPerPageChange={(size) => setFilters({ limit: PAGE_SIZES.includes(size) && size !== 10 ? String(size) : undefined })}
              />
            </div>
          </div>
        )}
      </div>

      {/* A task opened from its card, or from a link such as /tasks?task=<id> */}
      {taskId && (
        <TaskDetail
          key={taskId}
          taskId={taskId}
          viewer={viewer}
          refreshKey={detailRefresh}
          onClose={closeTask}
          onEdit={setEditing}
          onChanged={refreshList}
          onDeleted={() => {
            notify('Task deleted.', 'success')
            closeTask()
            refreshList()
          }}
        />
      )}

      {/* New and Edit task form */}
      <Tasksadd
        isOpen={creating || !!editing}
        task={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onCreate={() => {
          refreshList()
          setDetailRefresh((count) => count + 1)
        }}
      />

      {actions.dialogs}
    </div>
  )
}
