import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authAPI } from '../api/authAPI'
import { getErrorMessage } from '../api/axios'
import { useAuthConfig } from '../utils/useAuthConfig'
import AuthCard from '../components/shell/AuthCard'
import { errorBoxClass, inputClass, labelClass, linkClass, primaryButtonClass } from '../components/shell/formStyles'

// The page behind the link in the "reset your password" email
export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { passwordMinLength, mailEnabled } = useAuthConfig()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The link was refused: show how to get a new one instead of the form
  const [linkRefused, setLinkRefused] = useState<string | null>(null)

  const askForNewLink = (
    <>
      {mailEnabled ? (
        <Link to="/forgot-password" className={linkClass}>Ask for a new link</Link>
      ) : (
        <Link to="/login" className={linkClass}>Back to sign in</Link>
      )}
    </>
  )

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)

    if (password.length < passwordMinLength) {
      setError(`Password must be at least ${passwordMinLength} characters long.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await authAPI.resetPassword(token, password)
      navigate('/login', { replace: true, state: { message: 'Your password has been changed. Sign in with your new password.' } })
    } catch (err) {
      const message = getErrorMessage(err, 'Could not change the password. Please try again.')
      // A used, replaced or expired link can't be tried again; a mistake in the form can
      if (/expired|already used/i.test(message)) setLinkRefused(message)
      else setError(message)
      setBusy(false)
    }
  }

  if (!token || linkRefused) {
    return (
      <AuthCard title="Choose a new password" footer={askForNewLink}>
        <div role="alert" className={errorBoxClass}>
          {linkRefused ?? 'This link is incomplete. Open the link from your email again, or ask for a new one.'}
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Enter a new password for your account" footer={<Link to="/login" className={linkClass}>Back to sign in</Link>}>
      {error && <div role="alert" className={`mb-4 ${errorBoxClass}`}>{error}</div>}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="new-password" className="block text-sm font-medium text-neutral-800">New password</label>
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
            id="new-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={passwordMinLength}
            aria-describedby="new-password-hint"
            className={inputClass}
          />
          <p id="new-password-hint" className="mt-1 text-xs text-neutral-600">At least {passwordMinLength} characters.</p>
        </div>

        <div>
          <label htmlFor="confirm-password" className={labelClass}>Confirm new password</label>
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className={inputClass}
          />
        </div>

        <button type="submit" disabled={busy} className={`w-full ${primaryButtonClass}`}>
          {busy ? 'Saving...' : 'Change password'}
        </button>
      </form>
    </AuthCard>
  )
}
