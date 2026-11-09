import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authAPI } from '../api/authAPI'
import { getErrorMessage } from '../api/axios'
import { useAuthConfig } from '../utils/useAuthConfig'
import AuthCard from '../components/shell/AuthCard'
import { errorBoxClass, infoBoxClass, inputClass, labelClass, linkClass, primaryButtonClass, successBoxClass } from '../components/shell/formStyles'

const DEFAULT_ANSWER = "If an account uses that address, we've emailed it a link to choose a new password. The link works for 1 hour."

// Asks for an address and says the same thing whether or not it has an account
export default function ForgotPassword() {
  const { mailEnabled, ready } = useAuthConfig()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setAnswer((await authAPI.forgotPassword(email)) || DEFAULT_ANSWER)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not send the link. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const backToSignIn = (
    <>
      Remembered it? <Link to="/login" className={linkClass}>Back to sign in</Link>
    </>
  )

  if (ready && !mailEnabled) {
    return (
      <AuthCard title="Forgot password" footer={backToSignIn}>
        <div className={infoBoxClass}>
          Resetting a password by email is not set up here. Ask your admin to reset it: they can set a new password for you from the People page.
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Forgot password" subtitle="We will email you a link to choose a new one" footer={backToSignIn}>
      {answer ? (
        <div role="status" className={successBoxClass}>{answer}</div>
      ) : (
        <>
          {error && <div role="alert" className={`mb-4 ${errorBoxClass}`}>{error}</div>}
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className={labelClass}>Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>
            <button type="submit" disabled={busy || !ready} className={`w-full ${primaryButtonClass}`}>
              {busy ? 'Sending...' : 'Send the link'}
            </button>
          </form>
        </>
      )}
    </AuthCard>
  )
}
