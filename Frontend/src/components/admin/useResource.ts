import { useCallback, useEffect, useState } from 'react'

export type Loader<T> = (signal: AbortSignal) => Promise<T>

type Result<T> = {
  loader: Loader<T>
  token: number
  data?: T
  hasData: boolean
  error?: unknown
}

// Loads `loader` and reloads it whenever it changes (callers wrap it in
// useCallback with the values it depends on) or `reload()` is called.
// A newer request cancels the one before it, so a slow answer for an old
// loader (another person, older filters) can never replace a newer one.
// While reloading the same loader, the previous data stays on screen.
export function useResource<T>(loader: Loader<T> | null) {
  const [token, setToken] = useState(0)
  const [result, setResult] = useState<Result<T> | null>(null)

  useEffect(() => {
    if (!loader) return
    const controller = new AbortController()
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ loader, token, data, hasData: true })
      },
      (error) => {
        if (controller.signal.aborted) return
        setResult((previous) => ({
          loader,
          token,
          error,
          // A failed refresh keeps what was already shown
          data: previous?.loader === loader ? previous.data : undefined,
          hasData: previous?.loader === loader ? previous.hasData : false,
        }))
      },
    )
    return () => controller.abort()
  }, [loader, token])

  const current = result && result.loader === loader ? result : null
  const reload = useCallback(() => setToken((value) => value + 1), [])

  // Changes the loaded data in place, for example after an action
  const update = useCallback(
    (change: (data: T) => T) =>
      setResult((previous) => (previous?.hasData ? { ...previous, data: change(previous.data as T) } : previous)),
    [],
  )

  return {
    data: current?.hasData ? (current.data as T) : undefined,
    error: current && current.token === token ? current.error : undefined,
    loading: Boolean(loader) && (!current || current.token !== token),
    reload,
    update,
  }
}
