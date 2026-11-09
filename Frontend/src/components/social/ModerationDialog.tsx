import { useId, useState, type FormEvent } from 'react'
import { socialV2API, type ModerationAction } from '../../api/socialV2API'
import { errorText } from './format'
import Modal from './Modal'
import { moderationActionInfo } from './moderation'
import { BusyButton } from './ui'
import { dangerButton, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from './styles'
import type { SocialPost } from './types'

const REASON_MAX = 500

// Asks for the (optional) reason, then moderates the post. Errors stay in the
// dialog, where a toast would be hidden.
export default function ModerationDialog({
  post,
  authorName,
  action,
  onClose,
  onDone,
}: {
  post: Pick<SocialPost, '_id'>
  authorName: string
  action: ModerationAction
  onClose: () => void
  // The post as the server has it now
  onDone: (post: Partial<SocialPost>) => void
}) {
  const id = useId()
  const info = moderationActionInfo[action]
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    try {
      const response = await socialV2API.moderatePost(post._id, action, reason.trim() || undefined)
      onDone((response?.data ?? {}) as Partial<SocialPost>)
    } catch (moderateError) {
      setError(errorText(moderateError, `Couldn’t ${info.label.toLowerCase()} the post. Try again.`))
      setSaving(false)
    }
  }

  return (
    <Modal title={info.title} description={`Post by ${authorName}. ${info.explain}`} onClose={onClose} busy={saving}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <label htmlFor={`${id}-reason`} className={labelClass}>Reason <span className="font-normal text-slate-500">(optional)</span></label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={`${id}-reason-hint`}
            className={`${inputClass} rounded-[24px]`}
          />
          <p id={`${id}-reason-hint`} className={hintClass}>
            Shown to the author and kept with the post; it replaces the earlier reason. {reason.length}/{REASON_MAX}
          </p>
        </div>
        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <BusyButton type="submit" busy={saving} busyLabel={`${info.label}…`} className={info.danger ? dangerButton : primaryButton}>
            {info.label}
          </BusyButton>
        </div>
      </form>
    </Modal>
  )
}
