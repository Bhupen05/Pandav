import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getDashboardRouteForRole } from '../utils/roleRedirect'

export default function DashboardRedirect() {
  const { isAuthenticated, user } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Navigate to={getDashboardRouteForRole(user?.role)} replace />
}

