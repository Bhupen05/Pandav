import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '../../api/axios'

type SectionState<T> = { data: T | null; loading: boolean; error: string | null }

// One independently loading part of a page: its own loading, error and retry,
// so one failed request never blanks the rest. `load` must keep its identity
// between renders (wrap it in useCallback); a new one loads again.
export function useSection<T>(load: () => Promise<T>, enabled = true) {
  const [state, setState] = useState<SectionState<T>>({ data: null, loading: true, error: null })
  const requestId = useRef(0)

  const run = useCallback(async () => {
    const id = ++requestId.current
    try {
      const data = await load()
      if (id === requestId.current) setState({ data, loading: false, error: null })
    } catch (failure) {
      if (id === requestId.current) {
        setState((previous) => ({ data: previous.data, loading: false, error: getErrorMessage(failure, "This couldn't be loaded.") }))
      }
    }
  }, [load])

  useEffect(() => {
    if (!enabled) return
    // Starts just after the render, so React's double run in development sends one request, not two
    const first = setTimeout(run, 0)
    return () => clearTimeout(first)
  }, [enabled, run])

  // Loads again. Quiet keeps what is shown, without a loading state, until the answer comes.
  const reload = useCallback(
    (quiet = false) => {
      if (!quiet) setState((previous) => ({ ...previous, loading: true, error: null }))
      return run()
    },
    [run],
  )

  return { ...state, reload }
}
