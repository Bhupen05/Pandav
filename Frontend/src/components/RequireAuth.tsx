import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { CHANGE_PASSWORD_ROUTE, getDashboardRouteForRole } from '../utils/roleRedirect'

// How long the session check may take before the visitor is told why
const SLOW_CHECK_MS = 5000

// The spinner while the server confirms the session. A server that was asleep
// can take up to a minute, so after a few seconds it says so.
function CheckingSession() {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_CHECK_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center" role="status" aria-label="Checking your session">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      {slow && <p className="max-w-xs text-sm text-slate-600">Waking the server, this can take up to a minute...</p>}
    </div>
  )
}

// Guards the routes nested inside it: signed-in users only, and admins only
// when `admin` is set. Waits until a stored session has been confirmed with
// the server, so the decision never rests on what the browser has stored.
// Someone whose password an admin reset can only reach the profile's
// security tab until they have chosen a new one.
export default function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { isAuthenticated, isAdmin, loading, user } = useAuth()
  const location = useLocation()

  if (loading) return <CheckingSession />

  if (!isAuthenticated) {
    // Keep the whole address, so signing in returns to e.g. /tasks?task=<id>
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (user?.mustChangePassword) {
    const onSecurityTab = location.pathname === '/profile' && new URLSearchParams(location.search).get('tab') === 'security'
    if (!onSecurityTab) return <Navigate to={CHANGE_PASSWORD_ROUTE} replace />
  }

  if (admin && !isAdmin) {
    return <Navigate to={getDashboardRouteForRole(user?.role)} replace />
  }

  return <Outlet />
}
