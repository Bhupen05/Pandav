import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

// Guards the routes nested inside it: signed-in users only, and admins only
// when `admin` is set. Waits until a stored session has been confirmed with
// the server, so the decision never rests on what the browser has stored.
export default function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { isAuthenticated, isAdmin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Checking your session">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (admin && !isAdmin) {
    return <Navigate to="/user" replace />
  }

  return <Outlet />
}
