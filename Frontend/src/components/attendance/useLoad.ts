import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { describeError } from './labels'

interface Result<T> {
  key: string
  data?: T
  error?: string
}

// No result yet, so the first render counts as loading
const NOTHING = '\u0000'

// Loads something when `key` changes (page, filters...). The previous result
// stays in `data` while the next one loads, so lists don't flash empty.
// `reload` loads again and shows the spinner; `refresh` and `refreshMs` load
// quietly (a failed quiet load keeps what is on screen). Both resolve once the
// new result is in, so an action can wait for it.
export function useLoad<T>(load: () => Promise<T>, key: string, { refreshMs }: { refreshMs?: number } = {}) {
  const [result, setResult] = useState<Result<T>>({ key: NOTHING })
  const [tick, setTick] = useState(0)
  const [reloading, setReloading] = useState(false)
  const quiet = useRef(false)
  const waiting = useRef<Array<() => void>>([])
  const run = useEffectEvent(load)

  useEffect(() => {
    let active = true
    const wasQuiet = quiet.current
    quiet.current = false
    const settle = () => {
      setReloading(false)
      waiting.current.splice(0).forEach((resolve) => resolve())
    }
    run().then(
      (data) => {
        if (!active) return
        setResult({ key, data })
        settle()
      },
      (error) => {
        if (!active) return
        setResult((previous) =>
          wasQuiet && previous.key === key && previous.data !== undefined
            ? previous
            : { key, data: previous.data, error: describeError(error, 'Could not load this. Please try again.') },
        )
        settle()
      },
    )
    return () => {
      active = false
    }
  }, [key, tick])

  useEffect(() => {
    if (!refreshMs) return
    const timer = setInterval(() => {
      quiet.current = true
      setTick((value) => value + 1)
    }, refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs])

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve)
        setReloading(true)
        setTick((value) => value + 1)
      }),
    [],
  )

  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve)
        quiet.current = true
        setTick((value) => value + 1)
      }),
    [],
  )

  return {
    data: result.data,
    error: result.error,
    loading: result.key !== key || reloading,
    reload,
    refresh,
  }
}
