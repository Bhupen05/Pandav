import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { TASK_PRIORITIES, TASK_STATUSES, type TaskQuery, type TaskSort } from './types'

export const PAGE_SIZES = [10, 25, 50, 100]

export const SORT_OPTIONS: Array<{ value: TaskSort; label: string }> = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'dueDate', label: 'Due soonest' },
  { value: '-dueDate', label: 'Due latest' },
  { value: '-priority', label: 'Highest priority' },
  { value: 'priority', label: 'Lowest priority' },
  { value: 'title', label: 'Title A to Z' },
  { value: '-title', label: 'Title Z to A' },
]

export type FilterKey = 'q' | 'status' | 'priority' | 'assignedTo' | 'team' | 'overdue' | 'dueFrom' | 'dueTo' | 'sort' | 'page' | 'limit'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const pick = <T extends string>(value: string | null, allowed: readonly T[]) => (value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined)

// The Tasks page's filters, sort and page live in the address (?status=&q=&page=...),
// so a link, a reload or the Back button brings the same list back. ?task=<id> is
// the task opened in the panel (the link in notifications).
export function useTaskFilters() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const text = params.toString()

  const query = useMemo<TaskQuery & { page: number; limit: number; sort: TaskSort }>(() => {
    const read = new URLSearchParams(text)
    const page = Number.parseInt(read.get('page') || '', 10)
    const limit = Number.parseInt(read.get('limit') || '', 10)
    const day = (key: string) => (DAY.test(read.get(key) || '') ? (read.get(key) as string) : undefined)
    return {
      q: read.get('q')?.trim() || undefined,
      status: pick(read.get('status'), TASK_STATUSES),
      priority: pick(read.get('priority'), TASK_PRIORITIES),
      assignedTo: read.get('assignedTo') || undefined,
      team: read.get('team') || undefined,
      overdue: read.get('overdue') === 'true' ? true : undefined,
      dueFrom: day('dueFrom'),
      dueTo: day('dueTo'),
      sort: pick(read.get('sort'), SORT_OPTIONS.map((option) => option.value)) ?? '-createdAt',
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: PAGE_SIZES.includes(limit) ? limit : 10,
    }
  }, [text])

  const taskId = useMemo(() => new URLSearchParams(text).get('task'), [text])

  // Changes filters; the list goes back to page 1 unless a page is given
  const setFilters = useCallback(
    (patch: Partial<Record<FilterKey, string | undefined>>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const clearFilters = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams()
        // Keep what isn't a filter: the open task and how the list is laid out
        for (const key of ['task', 'limit', 'sort']) {
          const value = current.get(key)
          if (value) next.set(key, value)
        }
        return next
      },
      { replace: true },
    )
  }, [setParams])

  // Opening a task adds a history entry, so Back closes it again
  const openTask = useCallback(
    (id: string) => {
      const next = new URLSearchParams(text)
      next.set('task', id)
      navigate({ search: `?${next.toString()}` }, { state: { fromList: true } })
    },
    [navigate, text],
  )

  const closeTask = useCallback(() => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) {
      navigate(-1)
      return
    }
    const next = new URLSearchParams(text)
    next.delete('task')
    const search = next.toString()
    navigate({ search: search ? `?${search}` : '' }, { replace: true })
  }, [location.state, navigate, text])

  const activeCount = [query.q, query.status, query.priority, query.assignedTo, query.team, query.overdue, query.dueFrom, query.dueTo].filter(Boolean).length

  return { query, taskId, activeCount, setFilters, clearFilters, openTask, closeTask }
}
