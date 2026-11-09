import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../../api/axios'
import { dangerButtonClass, errorBoxClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from './formStyles'

// Asks for the account password (and, when two-step sign-in is on, a code from
// the authenticator app or a backup code) before a sensitive action. Native
// <dialog>: Escape closes it and focus stays inside. A refusal from the server
// is shown inside the dialog, which stays open.
export default function PasswordCodeDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  needsCode,
  onSubmit,
  onClose,
}: {
  title: string
  message?: string
  confirmLabel: string
  danger?: boolean
  needsCode: boolean
  // Rejects with the server's error to keep the dialog open
  onSubmit: (password: string, code: string) => Promise<void>
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const passwordId = useId()
  const codeId = useId()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element && !element.open) element.showModal()
    return () => {
      if (element?.open) element.close()
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password, code)
    } catch (err) {
      setError(getErrorMessage(err, 'That did not work. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h2 id={titleId} className="text-lg font-bold text-neutral-900">{title}</h2>
          {message && <p className="mt-1 text-sm text-neutral-600">{message}</p>}
        </div>

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

        {needsCode && (
          <div>
            <label htmlFor={codeId} className={labelClass}>Code from your authenticator app, or a backup code</label>
            <input
              id={codeId}
              type="text"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className={`flex-1 ${secondaryButtonClass}`}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={`flex-1 ${danger ? dangerButtonClass : primaryButtonClass}`}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
