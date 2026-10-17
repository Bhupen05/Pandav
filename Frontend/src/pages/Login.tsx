import { useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { getErrorMessage } from '../api/axios'
import { getDashboardRouteForRole } from '../utils/roleRedirect'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showForgotHelp, setShowForgotHelp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { login } = useAuth()
  const navigate = useNavigate()
  // `message` is set by the register page after a successful sign-up, `from`
  // by a protected page that sent the visitor here to sign in
  const { message: notice, from } = (useLocation().state as { message?: string; from?: string } | null) ?? {}

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }
    
    setError(null)
    setLoading(true)
    
    try {
      const user = await login(email.trim(), password, remember)
      const home = getDashboardRouteForRole(user.role)
      const canReturn = from && (user.role === 'admin' || !from.startsWith('/admin'))
      navigate(canReturn ? from : home, { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, 'Login failed. Please check your credentials and try again.'))
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-neutral-900">Welcome back</h1>
        <p className="mb-6 text-sm text-neutral-600">Sign in to your account</p>

        {notice && !error && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-800">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-neutral-800">
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-xs text-neutral-600 hover:text-neutral-900"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="••••••••"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 rounded border"
              />
              Remember me
            </label>
            <button
              type="button"
              onClick={() => setShowForgotHelp((v) => !v)}
              className="text-sm text-neutral-700 hover:text-neutral-900"
            >
              Forgot password?
            </button>
          </div>

          {showForgotHelp && (
            <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Ask your admin to reset it. They can set a new password for you from the Admin Panel's Users tab.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-600">
          Don't have an account? <Link to="/register" className="font-medium text-emerald-600 hover:text-emerald-700">Sign up</Link>
        </p>
      </div>
    </div>
  )
}

export default Login
