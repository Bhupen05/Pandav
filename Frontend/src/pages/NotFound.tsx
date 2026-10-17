import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export default function NotFound() {
  const { isAuthenticated, isAdmin } = useAuth()
  const home = !isAuthenticated ? '/' : isAdmin ? '/admin' : '/user'

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-emerald-600">404</p>
      <h1 className="mt-2 text-2xl font-bold text-neutral-900 md:text-3xl">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-neutral-600">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Link
        to={home}
        className="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
      >
        {isAuthenticated ? 'Back to dashboard' : 'Back to home'}
      </Link>
    </div>
  )
}
