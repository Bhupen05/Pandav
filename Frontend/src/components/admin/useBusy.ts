import { useCallback, useRef, useState } from 'react'

// Tracks actions in flight by key, so their buttons are disabled and a
// second click while the first is still working does nothing
export function useBusy() {
  const running = useRef(new Set<string>())
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set())

  const run = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (running.current.has(key)) return undefined
    running.current.add(key)
    setKeys(new Set(running.current))
    try {
      return await action()
    } finally {
      running.current.delete(key)
      setKeys(new Set(running.current))
    }
  }, [])

  const isBusy = useCallback((key: string) => keys.has(key), [keys])
  const anyBusy = keys.size > 0

  return { run, isBusy, anyBusy }
}
