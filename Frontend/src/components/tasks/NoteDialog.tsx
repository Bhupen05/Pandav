import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../../api/axios'

type Props = {
  title: string
  message?: string
  label: string
  confirmLabel: string
  maxLength: number
  // Sends the note; rejects with the server's error, which the dialog shows
  onSubmit: (note: string) => Promise<void>
  onClose: () => void
}

// A dialog asking for an optional note (the one thing useFeedback().prompt
// can't do: it insists on an answer and has no length limit)
export default function NoteDialog({ title, message, label, confirmLabel, maxLength, onSubmit, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const fieldId = useId()
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // showModal keeps focus inside the dialog and closes it on Escape
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError('')
    try {
      await onSubmit(note.trim())
    } catch (failure) {
      setError(getErrorMessage(failure, 'Something went wrong. Please try again.'))
      setSending(false)
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!sending) onClose()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit}>
        <h3 id={titleId} className="text-lg font-bold text-neutral-900">{title}</h3>
        {message && <p className="mt-1 text-sm text-neutral-600">{message}</p>}

        <label htmlFor={fieldId} className="mt-4 block text-sm font-medium text-neutral-700">{label}</label>
        <textarea
          id={fieldId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
          }}
          maxLength={maxLength}
          rows={4}
          className="mt-1.5 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
        />
        <p className="mt-1 text-xs text-neutral-500">{note.length}/{maxLength}</p>

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex-1 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? 'Sending…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
