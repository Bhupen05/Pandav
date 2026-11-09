import { useEffect, useId, useState, type FormEvent } from 'react'
import { authAPI } from '../../api/authAPI'
import { getErrorMessage } from '../../api/axios'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import PasswordCodeDialog from './PasswordCodeDialog'
import {
  errorBoxClass,
  infoBoxClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  successBoxClass,
} from './formStyles'

type Stage =
  | { name: 'idle' }
  | { name: 'password' }
  | { name: 'scan'; secret: string; otpauthUrl: string }
  // The backup codes, shown only this once
  | { name: 'codes'; codes: string[]; renewed: boolean }

type Confirming = 'disable' | 'backup-codes' | null

// Draws the otpauth address as a QR code. The qrcode package is loaded only
// now; a load that fails (a flaky connection) is tried again before giving up.
function QrCode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Changes when "Try again" is pressed
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const draw = async () => {
      for (let tries = 0; tries < 3; tries += 1) {
        try {
          const { toDataURL } = await import('qrcode')
          const url = await toDataURL(value, { width: 200, margin: 1 })
          if (active) setSrc(url)
          return
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 700))
        }
      }
      if (active) setFailed(true)
    }
    void draw()
    return () => {
      active = false
    }
  }, [value, attempt])

  if (failed) {
    return (
      <div className="max-w-xs text-sm text-red-700">
        <p>The QR code could not be drawn. Type the key into your app instead, or try again.</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false)
            setAttempt((count) => count + 1)
          }}
          className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          Try again
        </button>
      </div>
    )
  }
  if (!src) return <div className="flex h-[200px] w-[200px] items-center justify-center rounded-md border border-neutral-200 text-xs text-neutral-500">Drawing...</div>
  return <img src={src} alt="QR code for your authenticator app" width={200} height={200} className="rounded-md border border-neutral-200" />
}

// Two-step sign-in on the profile's security tab: set up (password, QR code,
// first code, backup codes), new backup codes, and turning it off
export default function TwoFactorSection() {
  const { user, updateUser } = useAuth()
  const { notify } = useFeedback()
  const [stage, setStage] = useState<Stage>({ name: 'idle' })
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordId = useId()
  const codeId = useId()

  if (!user) return null
  const enabled = user.twoFactorEnabled

  const reset = () => {
    setStage({ name: 'idle' })
    setPassword('')
    setCode('')
    setError(null)
  }

  const start = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { secret, otpauthUrl } = await authAPI.setupTwoFactor(password)
      setPassword('')
      setCode('')
      setStage({ name: 'scan', secret, otpauthUrl })
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start the setup. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const enable = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const codes = await authAPI.enableTwoFactor(code)
      updateUser({ ...user, twoFactorEnabled: true })
      setCode('')
      setStage({ name: 'codes', codes, renewed: false })
    } catch (err) {
      setError(getErrorMessage(err, 'That code did not work. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      notify('Backup codes copied.', 'success')
    } catch {
      notify('Could not copy. Select the codes and copy them by hand, or download them.', 'error')
    }
  }

  const downloadCodes = (codes: string[]) => {
    const text = `Pandav backup codes for ${user.email}\nEach code works once.\n\n${codes.join('\n')}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'pandav-backup-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  // Both ask for the password and a code in a dialog
  const confirmed = async (pass: string, otp: string) => {
    if (confirming === 'disable') {
      await authAPI.disableTwoFactor(pass, otp)
      updateUser({ ...user, twoFactorEnabled: false })
      setConfirming(null)
      notify('Two-step sign-in is off.', 'success')
    } else {
      const codes = await authAPI.renewBackupCodes(pass, otp)
      setConfirming(null)
      setStage({ name: 'codes', codes, renewed: true })
    }
  }

  return (
    <section aria-labelledby="two-step-title" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 id="two-step-title" className="text-lg font-semibold text-neutral-900">Two-step sign-in</h2>

      {stage.name === 'codes' && (
        <div className="mt-4 space-y-4">
          <div className={successBoxClass}>
            {stage.renewed ? 'Here are your new backup codes. The old ones no longer work.' : 'Two-step sign-in is on.'}
          </div>
          <div className={infoBoxClass}>
            Keep these backup codes somewhere safe. Each one works once if you lose your phone, and they are shown only now.
          </div>
          <ul aria-label="Backup codes" className="grid grid-cols-2 gap-2 rounded-lg bg-neutral-50 p-4 font-mono text-sm text-neutral-900">
            {stage.codes.map((backupCode) => (
              <li key={backupCode}>{backupCode}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void copyCodes(stage.codes)} className={secondaryButtonClass}>Copy codes</button>
            <button type="button" onClick={() => downloadCodes(stage.codes)} className={secondaryButtonClass}>Download codes</button>
            <button type="button" onClick={reset} className={primaryButtonClass}>I have saved these codes</button>
          </div>
        </div>
      )}

      {stage.name === 'scan' && (
        <form onSubmit={enable} className="mt-4 space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
            <li>Open an authenticator app (for example Google Authenticator, Authy or 1Password).</li>
            <li>Scan this code, or type the key below into the app.</li>
            <li>Enter the 6-digit code the app shows to finish.</li>
          </ol>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <QrCode value={stage.otpauthUrl} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-neutral-600">Key to type in</p>
              <p className="mt-1 break-all rounded bg-neutral-50 px-2 py-1 font-mono text-sm text-neutral-900">{stage.secret}</p>
            </div>
          </div>

          {error && <div role="alert" className={errorBoxClass}>{error}</div>}

          <div className="max-w-xs">
            <label htmlFor={codeId} className={labelClass}>6-digit code</label>
            <input
              id={codeId}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} tracking-widest`}
              placeholder="123456"
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className={primaryButtonClass}>{busy ? 'Checking...' : 'Turn on'}</button>
            <button type="button" onClick={reset} disabled={busy} className={secondaryButtonClass}>Cancel</button>
          </div>
        </form>
      )}

      {stage.name === 'password' && (
        <form onSubmit={start} className="mt-4 max-w-sm space-y-4">
          <p className="text-sm text-neutral-600">Enter your password to start.</p>
          {error && <div role="alert" className={errorBoxClass}>{error}</div>}
          <div>
            <label htmlFor={passwordId} className={labelClass}>Your password</label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className={primaryButtonClass}>{busy ? 'Working...' : 'Continue'}</button>
            <button type="button" onClick={reset} disabled={busy} className={secondaryButtonClass}>Cancel</button>
          </div>
        </form>
      )}

      {stage.name === 'idle' && (
        <div className="mt-2">
          <p className="text-sm text-neutral-600">
            {enabled
              ? 'Two-step sign-in is on. Signing in asks for a code from your authenticator app after your password.'
              : 'Ask for a code from an authenticator app after your password, so a stolen password is not enough to get into your account.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {enabled ? (
              <>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">On</span>
                <button type="button" onClick={() => setConfirming('backup-codes')} className={secondaryButtonClass}>New backup codes</button>
                <button type="button" onClick={() => setConfirming('disable')} className={secondaryButtonClass}>Turn off</button>
              </>
            ) : (
              <button type="button" onClick={() => setStage({ name: 'password' })} className={primaryButtonClass}>Turn on two-step sign-in</button>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <PasswordCodeDialog
          title={confirming === 'disable' ? 'Turn off two-step sign-in?' : 'Get new backup codes?'}
          message={
            confirming === 'disable'
              ? 'Signing in will only ask for your password again.'
              : 'The backup codes you have now stop working.'
          }
          confirmLabel={confirming === 'disable' ? 'Turn off' : 'Get new codes'}
          danger={confirming === 'disable'}
          needsCode
          onSubmit={confirmed}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  )
}
