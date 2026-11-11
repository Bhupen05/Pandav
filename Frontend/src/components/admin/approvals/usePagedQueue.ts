import { useCallback, useEffect, useRef, useState } from 'react'
import type { ListResponse } from '../../../api/adminAPI'
import { errorText } from '../format'

type Fetch<T> = (page: number, signal: AbortSignal) => Promise<ListResponse<T>>

type State<T> = { data?: ListResponse<T>; error?: unknown; loading: boolean }

// `more` after `base`: the rows not already there, with the newer page's pagination
const append = <T extends { _id: string }>(base: ListResponse<T>, more: ListResponse<T>): ListResponse<T> => {
  const known = new Set(base.data.map((row) => row._id))
  return { ...more, data: [...base.data, ...more.data.filter((row) => !known.has(row._id))] }
}

// A review queue that is read a page at a time. The first page loads like any
// list; "Load more" adds the next page below it. A reload (after a decision)
// brings back as many pages as were showing, so reviewing a row far down the
// list doesn't send you back to the top. `data` is everything loaded so far,
// with the pagination of the newest page: `pagination.total` is the whole queue.
// `fetchPage` must be stable (wrap it in useCallback).
export function usePagedQueue<T extends { _id: string }>(fetchPage: Fetch<T>) {
  const [state, setState] = useState<State<T>>({ loading: true })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  // How many pages are showing, so a reload fetches them all again
  const showing = useRef(1)
  // Goes up with every reload; a "Load more" answer from before it is dropped
  const epoch = useRef(0)
  const controller = useRef<AbortController | null>(null)

  // Loads pages 1 to `count` (fewer if the queue is shorter now)
  const loadPages = useCallback(
    async (count: number) => {
      epoch.current += 1
      controller.current?.abort()
      const mine = new AbortController()
      controller.current = mine
      try {
        let merged: ListResponse<T> | undefined
        for (let page = 1; page <= count; page += 1) {
          const response = await fetchPage(page, mine.signal)
          if (mine.signal.aborted) return
          merged = merged ? append(merged, response) : response
          showing.current = page
          if (!response.pagination || page >= response.pagination.pages) break
        }
        setLoadingMore(false)
        setState({ data: merged, loading: false })
      } catch (error) {
        if (mine.signal.aborted) return
        setLoadingMore(false)
        // A failed reload keeps what was already shown
        setState((previous) => ({ data: previous.data, error, loading: false }))
      }
    },
    [fetchPage],
  )

  useEffect(() => {
    void loadPages(1)
    return () => controller.current?.abort()
  }, [loadPages])

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, error: undefined, loading: true }))
    void loadPages(showing.current)
  }, [loadPages])

  const pagination = state.data?.pagination
  const hasMore = pagination ? pagination.page < pagination.pages : false

  const loadMore = useCallback(async () => {
    const base = state.data
    if (!base?.pagination || loadingMore) return
    const next = base.pagination.page + 1
    const startedAt = epoch.current
    const signal = new AbortController().signal
    setLoadingMore(true)
    setMoreError('')
    try {
      const response = await fetchPage(next, signal)
      // A reload started meanwhile and will bring its own pages
      if (startedAt !== epoch.current) return
      showing.current = next
      setState((previous) => (previous.data ? { ...previous, data: append(previous.data, response) } : previous))
      setLoadingMore(false)
    } catch (error) {
      if (startedAt !== epoch.current) return
      setMoreError(errorText(error, "Couldn't load more."))
      setLoadingMore(false)
    }
  }, [state.data, loadingMore, fetchPage])

  return { data: state.data, error: state.error, loading: state.loading, reload, hasMore, loadMore, loadingMore, moreError }
}

export type PagedQueue<T extends { _id: string }> = ReturnType<typeof usePagedQueue<T>>
