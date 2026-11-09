import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authAPI } from '../api/authAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/useAuth'
import { getDashboardRouteForRole } from '../utils/roleRedirect'
import AuthCard from '../components/shell/AuthCard'
import { errorBoxClass, linkClass, primaryButtonClass, secondaryButtonClass, successBoxClass } from '../components/shell/formStyles'

type Result =
  | { state: 'checking' }
  | { state: 'confirmed'; email?: string }
  | { state: 'failed'; message: string }

// The page behind the link in the "confirm your email address" email
export default function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { user, isAuthenticated, loading: checkingSession, refreshUser } = useAuth()

  const [result, setResult] = useState<Result>(token ? { state: 'checking' } : { state: 'failed', message: 'This link is incomplete. Open the link from your email again.' })
  const [resending, setResending] = useState(false)
  const [resendNotice, setResendNotice] = useState<{ text: string; ok: boolean } | null>(null)
  // A link works once: in development, React runs effects twice, which would use it up
  const startedRef = useRef(false)

  useEffect(() => {
    if (!token || startedRef.current) return
    startedRef.current = true
    authAPI
      .verifyEmail(token)
      .then(({ email }) => {
        setResult({ state: 'confirmed', email })
        // A signed-in user's account now says "confirmed"
        void refreshUser().catch(() => undefined)
      })
      .catch((err) => setResult({ state: 'failed', message: getErrorMessage(err, 'Could not confirm your address. Please try again.') }))
  }, [token, refreshUser])

  const resend = async () => {
    setResending(true)
    setResendNotice(null)
    try {
      setResendNotice({ text: (await authAPI.resendVerification()) ?? 'We have sent you a new link.', ok: true })
    } catch (err) {
      setResendNotice({ text: getErrorMessage(err, 'Could not send the link. Please try again.'), ok: false })
    } finally {
      setResending(false)
    }
  }

  const home = isAuthenticated ? getDashboardRouteForRole(user?.role) : '/login'

  return (
    <AuthCard title="Confirm your email">
      {result.state === 'checking' && (
        <div role="status" className="flex items-center justify-center gap-3 py-4 text-sm text-neutral-600">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          Confirming your address...
        </div>
      )}

      {result.state === 'confirmed' && (
        <div className="space-y-4">
          <div role="status" className={successBoxClass}>
            Your email address{result.email ? ` (${result.email})` : ''} is confirmed.
          </div>
          <Link to={home} className={`w-full ${primaryButtonClass}`}>
            {isAuthenticated ? 'Go to dashboard' : 'Continue to sign in'}
          </Link>
        </div>
      )}

      {result.state === 'failed' && (
        <div className="space-y-4">
          <div role="alert" className={errorBoxClass}>{result.message}</div>

          {isAuthenticated ? (
            <div className="space-y-2">
              <p className="text-sm text-neutral-700">You are signed in, so we can send a new link to {user?.email}.</p>
              <button type="button" onClick={resend} disabled={resending || checkingSession} className={`w-full ${secondaryButtonClass}`}>
                {resending ? 'Sending...' : 'Send me a new link'}
              </button>
              {resendNotice && (
                <p role={resendNotice.ok ? 'status' : 'alert'} className={`text-sm ${resendNotice.ok ? 'text-emerald-800' : 'text-red-700'}`}>
                  {resendNotice.text}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-700">
              <Link to="/login" className={linkClass}>Sign in</Link> to ask for a new link.
            </p>
          )}
        </div>
      )}
    </AuthCard>
  )
}
