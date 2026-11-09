import { useCallback, useEffect, useRef, useState } from 'react'
import { teamAPI } from '../../api/teamAPI'
import { useAuth } from '../../context/useAuth'
import { teamErrorMessage } from './format'

// A value that follows `value` once it has stayed the same for `delay` ms
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export type Loader<T> = {
  // The last result; it stays while the next one loads
  data?: T
  error: string
  loading: boolean
  reload: () => void
}

// Runs `load` when it changes (wrap it in useCallback), or when `refresh`
// changes, and keeps the newest answer, so a slow earlier request can't
// overwrite a later one
export function useLoader<T>(load: () => Promise<T>, fallback: string, refresh = 0): Loader<T> {
  const [state, setState] = useState<{ data?: T; error: string; loading: boolean }>({ error: '', loading: true })
  const latest = useRef(0)

  const run = useCallback(async () => {
    const id = ++latest.current
    setState((previous) => ({ ...previous, error: '', loading: true }))
    try {
      const data = await load()
      if (id === latest.current) setState({ data, error: '', loading: false })
    } catch (error) {
      if (id === latest.current) {
        setState((previous) => ({ ...previous, error: teamErrorMessage(error, fallback), loading: false }))
      }
    }
  }, [load, fallback])

  useEffect(() => {
    void run()
    return () => {
      latest.current += 1
    }
  }, [run, refresh])

  return { ...state, reload: () => void run() }
}

// Which actions are running, by key: a busy button is disabled, and the same
// action can't be started twice
export function useBusy() {
  const active = useRef(new Set<string>())
  const [keys, setKeys] = useState<string[]>([])

  const run = useCallback(async <T,>(key: string, work: () => Promise<T>) => {
    if (active.current.has(key)) return undefined
    active.current.add(key)
    setKeys([...active.current])
    try {
      return await work()
    } finally {
      active.current.delete(key)
      setKeys([...active.current])
    }
  }, [])

  const isBusy = useCallback((key: string) => keys.includes(key), [keys])
  return { run, isBusy, anyBusy: keys.length > 0 }
}

// Joining, leading or leaving a team changes the signed-in user's role on the
// server; this copies the new role into the session the app keeps
export function useSyncSession() {
  const { user, updateUser } = useAuth()
  return useCallback(async () => {
    try {
      const session = await teamAPI.getSessionRole()
      if (user && session.role) updateUser({ ...user, role: session.role, teamId: session.teamId })
      return session
    } catch {
      // The next page load picks the new role up
      return null
    }
  }, [user, updateUser])
}
