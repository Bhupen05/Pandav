import { useCallback, useRef, useState } from 'react'

// How many items of a long list to show: `initial`, then `initial` more per click
export function useShowMore(initial: number) {
  const [limit, setLimit] = useState(initial)
  const more = useCallback(() => setLimit((current) => current + initial), [initial])
  const less = useCallback(() => setLimit(initial), [initial])
  return { limit, initial, more, less }
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
