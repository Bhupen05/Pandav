import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../../api/authAPI'
import { getErrorMessage } from '../../api/axios'
import { userAPI } from '../../api/userAPI'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import { getDashboardRouteForRole } from '../../utils/roleRedirect'
import { useAuthConfig } from '../../utils/useAuthConfig'
import PasswordCodeDialog from './PasswordCodeDialog'
import TwoFactorSection from './TwoFactorSection'
import { dangerButtonClass, errorBoxClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from './formStyles'

// Change password: the same form when an admin reset the password and a new one is required
function ChangePassword() {
  const { user, updateUser } = useAuth()
  const { notify } = useFeedback()
  const navigate = useNavigate()
  const { passwordMinLength } = useAuthConfig()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const forced = user?.mustChangePassword === true
  const type = showPasswords ? 'text' : 'password'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !user) return
    setError(null)

    if (next.length < passwordMinLength) {
      setError(`The new password must be at least ${passwordMinLength} characters long.`)
      return
    }
    if (next !== confirm) {
      setError('The new passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const updated = await authAPI.updatePassword({ currentPassword: current, newPassword: next })
      updateUser(updated)
      setCurrent('')
      setNext('')
      setConfirm('')
      notify('Password changed. Your other devices were signed out.', 'success')
      // The required change is done: on to the app
      if (forced) navigate(getDashboardRouteForRole(updated.role), { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, 'Could not change the password. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="change-password-title" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 id="change-password-title" className="text-lg font-semibold text-neutral-900">
        {forced ? 'Choose a new password' : 'Change password'}
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        {forced
          ? 'Enter the password an admin gave you, then choose your own.'
          : 'Changing it signs you out on your other devices.'}
      </p>

      <form onSubmit={submit} className="mt-4 max-w-md space-y-4">
        {error && <div role="alert" className={errorBoxClass}>{error}</div>}

        <div>
          <label htmlFor="current-password" className={labelClass}>{forced ? 'Password from your admin' : 'Current password'}</label>
          <input
            id="current-password"
            type={type}
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="new-password" className={labelClass}>New password</label>
          <input
            id="new-password"
            type={type}
            autoComplete="new-password"
            required
            minLength={passwordMinLength}
            aria-describedby="new-password-hint"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputClass}
          />
          <p id="new-password-hint" className="mt-1 text-xs text-neutral-600">At least {passwordMinLength} characters.</p>
        </div>
        <div>
          <label htmlFor="confirm-new-password" className={labelClass}>Confirm new password</label>
          <input
            id="confirm-new-password"
            type={type}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(e) => setShowPasswords(e.target.checked)}
            className="size-4 rounded border-neutral-300 accent-emerald-600"
          />
          Show passwords
        </label>

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving...' : 'Change password'}
        </button>
      </form>
    </section>
  )
}

// Everything on the security tab. While a new password is required only the
// change-password form shows: nothing else works until it is done.
export default function ProfileSecurity() {
  const { user, logoutAll } = useAuth()
  const { confirm, notify } = useFeedback()
  const [deleting, setDeleting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  if (!user) return null

  const signOutEverywhere = async () => {
    const ok = await confirm({
      title: 'Sign out everywhere?',
      message: 'Every browser and device signed in to your account, this one too, will have to sign in again.',
      confirmLabel: 'Sign out everywhere',
      danger: true,
    })
    if (!ok) return
    setSigningOut(true)
    try {
      await logoutAll()
      // A fresh page load, like signing out: nothing of this account stays in memory
      window.location.replace('/')
    } catch (err) {
      notify(getErrorMessage(err, 'Could not sign you out everywhere. Please try again.'), 'error')
      setSigningOut(false)
    }
  }

  const deleteAccount = async (password: string, code: string) => {
    await userAPI.deleteMe(password, user.twoFactorEnabled ? code : undefined)
    window.location.replace('/')
  }

  return (
    <div className="space-y-6">
      <ChangePassword />

      {!user.mustChangePassword && (
        <>
          <TwoFactorSection />

          <section aria-labelledby="sessions-title" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 id="sessions-title" className="text-lg font-semibold text-neutral-900">Sign out everywhere</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Lost a device, or signed in on a computer that is not yours? This ends every session of your account, in every browser.
            </p>
            <button type="button" onClick={() => void signOutEverywhere()} disabled={signingOut} className={`mt-4 ${secondaryButtonClass}`}>
              {signingOut ? 'Signing out...' : 'Sign out everywhere'}
            </button>
          </section>

          <section aria-labelledby="delete-title" className="rounded-xl border border-red-200 bg-white p-6 shadow-sm">
            <h2 id="delete-title" className="text-lg font-semibold text-red-700">Delete my account</h2>
            <p className="mt-1 text-sm text-neutral-600">
              This removes your attendance, messages, posts and personal tasks for good, and takes you off your open tasks. It cannot be undone.
              You cannot delete your account while you are the only leader of a team or the only admin: make someone else leader or admin first.
            </p>
            <button type="button" onClick={() => setDeleting(true)} className={`mt-4 ${dangerButtonClass}`}>
              Delete my account
            </button>
          </section>

          {deleting && (
            <PasswordCodeDialog
              title="Delete your account?"
              message="This cannot be undone. Enter your password to confirm."
              confirmLabel="Delete my account"
              danger
              needsCode={user.twoFactorEnabled}
              onSubmit={deleteAccount}
              onClose={() => setDeleting(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
