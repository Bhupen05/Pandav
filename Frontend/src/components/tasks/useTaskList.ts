import { useCallback, useEffect, useRef, useState } from 'react'
import { taskAPI } from '../../api/taskAPI'
import { getErrorMessage } from '../../api/axios'
import type { Paging, Task, TaskQuery, TaskSummary } from './types'

const REFRESH_EVERY_MS = 60_000
// Focus and visibility events often arrive together: reload once
const MIN_GAP_MS = 5_000

type Stored = {
  tasks: Task[]
  paging: Paging | null
  // Counts over the same tasks (every status), for the status pills and the hero
  summary: TaskSummary | null
  // Nothing to show yet: the first load
  loading: boolean
  // The list couldn't be loaded
  error: string | null
  // A background refresh failed: the rows shown are older than they look
  stale: boolean
  summaryFailed: boolean
  // The query the rows belong to
  loadedKey: string | null
}

export type TaskListState = Omit<Stored, 'loadedKey'> & {
  // A new page or filter is loading over the rows already shown
  refreshing: boolean
}

const INITIAL: Stored = {
  tasks: [],
  paging: null,
  summary: null,
  loading: true,
  error: null,
  stale: false,
  summaryFailed: false,
  loadedKey: null,
}

// The current page of tasks and the counts beside it, for `query`. Reloads when
// the query changes, every minute, and when the tab comes back into view.
export function useTaskList(query: TaskQuery) {
  const key = JSON.stringify(query)
  const [state, setState] = useState<Stored>(INITIAL)
  const requestId = useRef(0)
  const lastLoad = useRef(0)
  // The filters the counts were last read for: paging and sorting don't change them
  const summaryFor = useRef('')

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current
      const current = JSON.parse(key) as TaskQuery
      lastLoad.current = Date.now()

      const { q, priority, assignedTo, team, overdue, dueFrom, dueTo } = current
      const countsKey = JSON.stringify({ q, priority, assignedTo, team, overdue, dueFrom, dueTo })
      const recount = silent || countsKey !== summaryFor.current

      // One failing request must not take the other down with it
      const [list, summary] = await Promise.allSettled([
        taskAPI.listTasks(current),
        recount ? taskAPI.getSummary(current) : Promise.resolve(null),
      ])
      if (id !== requestId.current) return
      if (summary.status === 'fulfilled' && summary.value) summaryFor.current = countsKey

      setState((previous) => {
        if (list.status === 'rejected') {
          const message = getErrorMessage(list.reason, "The tasks couldn't be loaded.")
          // A failed background refresh keeps what is on screen; a failed new page or filter does not
          return silent && previous.tasks.length > 0
            ? { ...previous, stale: true }
            : { ...previous, tasks: [], paging: null, loading: false, error: message, stale: false, loadedKey: key }
        }
        return {
          tasks: Array.isArray(list.value.data) ? list.value.data : [],
          paging: list.value.pagination ?? null,
          summary: summary.status === 'fulfilled' && summary.value ? summary.value.data : previous.summary,
          loading: false,
          error: null,
          stale: false,
          summaryFailed: summary.status === 'rejected',
          loadedKey: key,
        }
      })
    },
    [key],
  )

  useEffect(() => {
    // Starts just after the render, so React's double run in development sends one request, not two
    const first = setTimeout(() => load(), 0)
    const reload = () => {
      if (!document.hidden && Date.now() - lastLoad.current >= MIN_GAP_MS) load(true)
    }
    const timer = setInterval(() => {
      if (!document.hidden) load(true)
    }, REFRESH_EVERY_MS)
    document.addEventListener('visibilitychange', reload)
    window.addEventListener('focus', reload)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', reload)
      window.removeEventListener('focus', reload)
    }
  }, [load])

  // Loads again. Silent keeps the rows as they are meanwhile; otherwise the
  // list shows that it is loading (or the spinner, if there are no rows).
  const reload = useCallback(
    (silent = false) => {
      if (!silent) setState((previous) => ({ ...previous, error: null, loading: previous.tasks.length === 0, loadedKey: null }))
      return load(silent)
    },
    [load],
  )

  const { loadedKey, ...shown } = state
  return { ...shown, refreshing: !state.loading && !state.error && loadedKey !== key, reload }
}
