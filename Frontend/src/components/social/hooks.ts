import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from './format'

// How many items of a long list to show: `initial`, then `initial` more per click
export function useShowMore(initial: number) {
  const [limit, setLimit] = useState(initial)
  const more = useCallback(() => setLimit((current) => current + initial), [initial])
  const less = useCallback(() => setLimit(initial), [initial])
  return { limit, initial, more, less }
}

// The time, refreshed now and then (reading the clock while rendering isn't pure)
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

// Keys of the actions running right now, so their buttons can show it and
// can't be pressed twice
export function useBusy() {
  const running = useRef(new Set<string>())
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (running.current.has(key)) return undefined
    running.current.add(key)
    setBusy((current) => ({ ...current, [key]: true }))
    try {
      return await action()
    } finally {
      running.current.delete(key)
      setBusy((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }, [])
  return { busy, run }
}

// One section's data: loads when the view opens (and again when `key`
// changes), keeps what it has while it reloads, and reports its own error so
// a failed request only breaks its own section. `enabled: false` waits.
export function useResource<T>(
  load: () => Promise<T>,
  fallback: string,
  initial: T,
  { enabled = true, key }: { enabled?: boolean; key?: string | number } = {},
) {
  const [data, setData] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const latest = useRef(load)
  const ticket = useRef(0)

  useEffect(() => {
    latest.current = load
  })

  const reload = useCallback(async () => {
    const mine = ++ticket.current
    setLoading(true)
    setError('')
    try {
      const result = await latest.current()
      if (mine !== ticket.current) return
      setData(result)
      setLoaded(true)
    } catch (loadError) {
      if (mine === ticket.current) setError(errorText(loadError, fallback))
    } finally {
      if (mine === ticket.current) setLoading(false)
    }
  }, [fallback])

  useEffect(() => {
    if (!enabled) return
    void reload()
    // A late answer from a view that has gone, or from an older key, is ignored
    return () => {
      ticket.current += 1
    }
  }, [enabled, key, reload])

  return { data, setData, loaded, loading, error, reload }
}
