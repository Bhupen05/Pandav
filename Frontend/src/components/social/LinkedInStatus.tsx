import { useId, useState, type ReactNode } from 'react'
import { CalendarClock, ExternalLink, Linkedin, LoaderCircle, RotateCcw, Send, X } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorText, externalLink, formatDateTime } from './format'
import { useBusy } from './hooks'
import { BusyButton } from './ui'
import { inputClass, linkButton, secondaryButton, smallButton } from './styles'
import type { SocialPost } from './types'

// What a post's LinkedIn line needs, and what its actions change
export type LinkedInState = Pick<SocialPost, 'publishResults' | 'autoPublish' | 'publishAt' | 'queuedJobs'>
type Post = Pick<SocialPost, '_id' | 'approvalStatus' | 'moderationStatus' | 'targets'> & LinkedInState

const pickState = (post: SocialPost): LinkedInState => ({
  publishResults: post.publishResults,
  autoPublish: post.autoPublish,
  publishAt: post.publishAt,
  queuedJobs: post.queuedJobs,
})

const toLocalInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Where a post stands with LinkedIn, and what its publisher can do about it:
// post it now, schedule it, move or cancel the time, or try again
export default function LinkedInStatus({
  post,
  canPublish,
  onChange,
}: {
  post: Post
  // The caller may publish this post (its author, an admin, or its author's leader)
  canPublish: boolean
  onChange: (postId: string, state: LinkedInState) => void
}) {
  const { notify } = useFeedback()
  const { busy, run } = useBusy()
  const id = useId()
  const [picking, setPicking] = useState(false)
  const [pickedAt, setPickedAt] = useState('')

  if (!post.targets.linkedin) return null

  const result = post.publishResults?.linkedin
  const job = post.queuedJobs?.linkedin
  const live = !['hidden', 'removed'].includes(post.moderationStatus)
  const decided = ['none', 'approved'].includes(post.approvalStatus)
  const canAct = canPublish && live && decided && result?.status !== 'published'

  const act = (key: string, action: () => Promise<{ data?: SocialPost } | undefined>, done?: (post: SocialPost) => string) =>
    run(key, async () => {
      try {
        const response = await action()
        if (response?.data) {
          onChange(post._id, pickState(response.data))
          const message = done?.(response.data)
          if (message) notify(message, response.data.publishResults?.linkedin?.status === 'failed' ? 'error' : 'success')
        }
        setPicking(false)
      } catch (error) {
        notify(errorText(error, 'That didn’t work. Try again.'), 'error')
      }
    })

  const postNow = () =>
    act('now', () => socialV2API.schedulePost(post._id, null), (updated) => {
      const outcome = updated.publishResults?.linkedin
      return outcome?.status === 'published' ? 'Posted on LinkedIn.' : `LinkedIn didn’t take it: ${outcome?.message ?? 'no reason given'}`
    })

  const schedule = () => {
    const at = new Date(pickedAt)
    if (!pickedAt || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      notify('Choose a time that is still to come.', 'error')
      return
    }
    void act('schedule', () => socialV2API.schedulePost(post._id, at.toISOString()), (updated) =>
      `It goes to LinkedIn on ${formatDateTime(updated.publishAt)}.`)
  }

  const cancel = () =>
    act('cancel', () => socialV2API.unschedulePost(post._id), () => 'It won’t go to LinkedIn by itself now.')

  const openPicker = (from?: string | null) => {
    setPickedAt(toLocalInput(from ? new Date(from) : new Date(Date.now() + 60 * 60 * 1000)))
    setPicking(true)
  }

  let icon = <Linkedin className="h-4 w-4" aria-hidden="true" />
  let line: ReactNode
  let tone = 'border-slate-200 bg-slate-50 text-slate-700'
  const link = externalLink('linkedin', result?.externalId)

  if (result?.status === 'published') {
    tone = 'border-emerald-200 bg-emerald-50 text-emerald-900'
    line = (
      <>
        On LinkedIn{result.publishedAt ? ` since ${formatDateTime(result.publishedAt)}` : ''}.
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className={`${linkButton} ml-2 inline-flex items-center gap-1 text-emerald-800`}>
            View on LinkedIn <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </>
    )
  } else if (job?.status === 'processing') {
    icon = <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
    line = 'Posting to LinkedIn…'
  } else if (post.approvalStatus === 'pending') {
    tone = 'border-amber-200 bg-amber-50 text-amber-900'
    line = post.autoPublish
      ? post.publishAt
        ? `Goes to LinkedIn on ${formatDateTime(post.publishAt)}, once approved.`
        : 'Goes to LinkedIn once approved.'
      : 'Waiting for approval before it can go to LinkedIn.'
  } else if (post.approvalStatus === 'rejected') {
    tone = 'border-rose-200 bg-rose-50 text-rose-800'
    line = 'Not approved for LinkedIn.'
  } else if (!live) {
    line = 'It can’t go to LinkedIn while it is hidden or removed.'
  } else if (job && job.attempts > 0) {
    tone = 'border-rose-200 bg-rose-50 text-rose-800'
    line = `LinkedIn didn’t take it: ${job.lastError ?? 'no reason given'}. Pandav tries again ${job.nextRetryAt ? `at ${formatDateTime(job.nextRetryAt)}` : 'soon'}.`
  } else if (job) {
    tone = 'border-sky-200 bg-sky-50 text-sky-900'
    icon = <CalendarClock className="h-4 w-4" aria-hidden="true" />
    line = `Scheduled for LinkedIn: ${formatDateTime(job.nextRetryAt)}.`
  } else if (result?.status === 'failed') {
    tone = 'border-rose-200 bg-rose-50 text-rose-800'
    line = `Couldn’t post it to LinkedIn: ${result.message ?? 'no reason given'}`
  } else {
    line = 'Not on LinkedIn yet.'
  }

  return (
    <div className={`mt-4 rounded-[22px] border px-4 py-3 text-sm ${tone}`}>
      <p className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 break-words">{line}</span>
      </p>

      {canAct && job?.status !== 'processing' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BusyButton
            busy={busy.now}
            busyLabel="Posting…"
            onClick={() => void postNow()}
            icon={job && job.attempts > 0 ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
            className={`${secondaryButton} ${smallButton}`}
          >
            {result?.status === 'failed' || (job && job.attempts > 0) ? 'Try again now' : 'Post now'}
          </BusyButton>
          {!picking ? (
            <button type="button" onClick={() => openPicker(job?.attempts === 0 ? job.nextRetryAt : null)} className={`${secondaryButton} ${smallButton}`}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              {job ? 'Change time' : 'Schedule'}
            </button>
          ) : null}
          {job ? (
            <BusyButton busy={busy.cancel} onClick={() => void cancel()} icon={<X className="h-3.5 w-3.5" aria-hidden="true" />} className={`${secondaryButton} ${smallButton}`}>
              {job.attempts > 0 ? 'Stop trying' : 'Cancel schedule'}
            </BusyButton>
          ) : null}
        </div>
      ) : null}

      {canAct && picking ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${id}-at`} className="mb-1 block text-xs font-semibold">Post on LinkedIn at</label>
            <input
              id={`${id}-at`}
              type="datetime-local"
              value={pickedAt}
              min={toLocalInput(new Date())}
              onChange={(event) => setPickedAt(event.target.value)}
              className={`${inputClass} rounded-xl bg-white px-3 py-2`}
            />
          </div>
          <BusyButton busy={busy.schedule} onClick={schedule} className={`${secondaryButton} ${smallButton}`}>
            Save time
          </BusyButton>
          <button type="button" onClick={() => setPicking(false)} className={`${linkButton} px-1`}>
            Never mind
          </button>
        </div>
      ) : null}
    </div>
  )
}
