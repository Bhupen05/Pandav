import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { authAPI } from '../api/authAPI'
import { SESSION_ENDED_KEY, getErrorCode, getErrorMessage } from '../api/axios'
import { CHANGE_PASSWORD_ROUTE, getDashboardRouteForRole, internalPath } from '../utils/roleRedirect'
import { useAuthConfig } from '../utils/useAuthConfig'
import AuthCard from '../components/shell/AuthCard'
import {
  errorBoxClass,
  infoBoxClass,
  inputClass,
  labelClass,
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
  successBoxClass,
} from '../components/shell/formStyles'

const wasSessionEnded = () => {
  try {
    return sessionStorage.getItem(SESSION_ENDED_KEY) === '1'
  } catch {
    return false
  }
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showForgotHelp, setShowForgotHelp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resendNotice, setResendNotice] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [loading, setLoading] = useState(false)
  // Second step: set once the password was right and the account has two-step sign-in on
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  // Whether the previous session ended on its own (read once, then forgotten)
  const [sessionEnded] = useState(wasSessionEnded)

  const { login, completeTwoFactor, user, loading: checkingSession } = useAuth()
  const { mailEnabled } = useAuthConfig()
  const navigate = useNavigate()
  // `message` is set by the register page after a successful sign-up, `from`
  // by a protected page that sent the visitor here to sign in
  const { message: notice, from } = (useLocation().state as { message?: string; from?: string } | null) ?? {}
  // Set while this page signs the user in itself, which then chooses where to go
  const signingInRef = useRef(false)

  useEffect(() => {
    try {
      sessionStorage.removeItem(SESSION_ENDED_KEY)
    } catch {
      // Storage can be blocked
    }
  }, [])

  // Someone who is already signed in has no use for this page
  useEffect(() => {
    if (checkingSession || !user || signingInRef.current) return
    navigate(user.mustChangePassword ? CHANGE_PASSWORD_ROUTE : getDashboardRouteForRole(user.role), { replace: true })
  }, [checkingSession, user, navigate])

  const goHome = (user: { role: string; mustChangePassword: boolean }) => {
    const returnTo = internalPath(from)
    const canReturn = returnTo && (user.role === 'admin' || !returnTo.startsWith('/admin'))
    navigate(user.mustChangePassword ? CHANGE_PASSWORD_ROUTE : canReturn ? returnTo : getDashboardRouteForRole(user.role), { replace: true })
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }

    setError(null)
    setUnverified(false)
    setResendNotice(null)
    setLoading(true)
    signingInRef.current = true

    try {
      const result = await login(email.trim(), password, remember)
      if (result.user) {
        goHome(result.user)
        return
      }
      // Right password; the account asks for a second step
      signingInRef.current = false
      setTicket(result.twoFactorTicket)
      setCode('')
      setUseBackupCode(false)
      setLoading(false)
    } catch (err) {
      signingInRef.current = false
      if (getErrorCode(err) === 'EMAIL_NOT_VERIFIED') setUnverified(true)
      setError(getErrorMessage(err, 'Login failed. Please check your credentials and try again.'))
      setLoading(false)
    }
  }

  const onSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || !ticket) return

    if (!code.trim()) {
      setError(useBackupCode ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.')
      return
    }

    setError(null)
    setLoading(true)
    signingInRef.current = true

    try {
      goHome(await completeTwoFactor(ticket, code))
    } catch (err) {
      signingInRef.current = false
      const message = getErrorMessage(err, 'That code did not work. Please try again.')
      // The ticket lasts 5 minutes: after that the password has to be entered again
      if (/timed out/i.test(message)) {
        setTicket(null)
        setPassword('')
      }
      setError(message)
      setLoading(false)
    }
  }

  const resendLink = async () => {
    setResending(true)
    setResendNotice(null)
    try {
      setResendNotice((await authAPI.resendVerification(email)) ?? 'We have sent you a new link.')
    } catch (err) {
      setResendNotice(getErrorMessage(err, 'Could not send the link. Please try again.'))
    } finally {
      setResending(false)
    }
  }

  const backToPassword = () => {
    setTicket(null)
    setCode('')
    setPassword('')
    setError(null)
  }

  const banners = (
    <>
      {sessionEnded && !error && !notice && (
        <div role="status" className={`mb-4 ${infoBoxClass}`}>Your session ended. Please sign in again.</div>
      )}

      {notice && !error && (
        <div role="status" className={`mb-4 ${successBoxClass}`}>{notice}</div>
      )}

      {error && (
        <div role="alert" className={`mb-4 ${errorBoxClass}`}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </>
  )

  if (ticket) {
    return (
      <AuthCard title="Two-step sign-in" subtitle={useBackupCode ? 'Enter one of your backup codes' : 'Enter the code from your authenticator app'}>
        {banners}

        <form onSubmit={onSubmitCode} className="space-y-4">
          <div>
            <label htmlFor="code" className={labelClass}>
              {useBackupCode ? 'Backup code' : '6-digit code'}
            </label>
            <input
              id="code"
              key={useBackupCode ? 'backup' : 'app'}
              type="text"
              inputMode={useBackupCode ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className={`${inputClass} tracking-widest`}
              placeholder={useBackupCode ? 'xxxxx-xxxxx' : '123456'}
            />
          </div>

          <button type="submit" disabled={loading} className={`w-full ${primaryButtonClass}`}>
            {loading ? 'Checking...' : 'Verify and sign in'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setUseBackupCode((value) => !value)
                setCode('')
                setError(null)
              }}
              className={linkClass}
            >
              {useBackupCode ? 'Use the app code instead' : 'Use a backup code'}
            </button>
            <button type="button" onClick={backToPassword} className="text-neutral-600 hover:text-neutral-900 hover:underline">
              Back to sign in
            </button>
          </div>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your account"
      footer={
        <>
          Don't have an account? <Link to="/register" className={linkClass}>Sign up</Link>
        </>
      }
    >
      {banners}

      {unverified && (
        <div className={`mb-4 space-y-2 ${infoBoxClass}`}>
          <p>We sent a link to {email.trim() || 'your address'} when you signed up. Open it to confirm that the address is yours, then sign in.</p>
          <button type="button" onClick={resendLink} disabled={resending} className={secondaryButtonClass}>
            {resending ? 'Sending...' : 'Send the link again'}
          </button>
          {resendNotice && <p role="status">{resendNotice}</p>}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
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
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password text' : 'Show password text'}
              className="rounded text-xs text-neutral-600 hover:text-neutral-900"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
            placeholder="••••••••"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 rounded border-neutral-300 accent-emerald-600"
            />
            Remember me
          </label>
          {mailEnabled ? (
            <Link to="/forgot-password" className="text-sm text-neutral-700 hover:text-neutral-900 hover:underline">
              Forgot password?
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setShowForgotHelp((v) => !v)}
              aria-expanded={showForgotHelp}
              className="text-sm text-neutral-700 hover:text-neutral-900 hover:underline"
            >
              Forgot password?
            </button>
          )}
        </div>

        {!mailEnabled && showForgotHelp && (
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            Ask your admin to reset it. They can set a new password for you from the People page.
          </p>
        )}

        <button type="submit" disabled={loading} className={`w-full ${primaryButtonClass}`}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  )
}

export default Login
