import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { socialV2API } from '../api/socialV2API'
import { getErrorMessage } from '../api/axios'

export type ShareDraft = { title: string; content: string }

export type ShareOffer = { taskId: string; draft: ShareDraft }

type Props = {
  offer: ShareOffer
  onClose: () => void
  // Called after the post is made, with a sentence saying where it went
  onShared: (summary: string) => void
}

type Integration = { provider: string; isConnected?: boolean; needsRelink?: boolean }

// Shown when a personal task with auto-share on is completed (or when its
// owner shares a finished one): nothing is posted until the owner reads (and
// can edit) the text and confirms. LinkedIn is never ticked for them.
export default function ShareTaskDialog({ offer, onClose, onShared }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [content, setContent] = useState(offer.draft.content)
  // 'checking' until the linked accounts are known
  const [linkedin, setLinkedin] = useState<'checking' | 'linked' | 'expired' | 'none'>('checking')
  const [toLinkedin, setToLinkedin] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState('')

  // showModal keeps focus inside the dialog and closes it on Escape
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  useEffect(() => {
    socialV2API
      .getIntegrations()
      .then((response) => {
        const list: Integration[] = Array.isArray(response?.data) ? response.data : []
        const account = list.find((item) => item.provider === 'linkedin')
        setLinkedin(!account ? 'none' : account.isConnected && !account.needsRelink ? 'linked' : 'expired')
      })
      .catch(() => setLinkedin('none'))
  }, [])

  const canUseLinkedin = linkedin === 'linked'

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (sharing) return
    setSharing(true)
    setError('')
    const withLinkedin = toLinkedin && canUseLinkedin
    try {
      const response = await socialV2API.sharePersonalTask(offer.taskId, { content: content.trim(), linkedin: withLinkedin })
      const result = response?.data
      const linkedinStatus = result?.publishResult?.linkedin?.status
      onShared(
        result?.pendingApproval
          ? 'Shared. It waits for your team leader or an admin to approve it; until then only you and admins see it. Then it appears in the feed and goes to LinkedIn.'
          : withLinkedin && linkedinStatus !== 'published'
            ? `Posted to the Pandav feed, but LinkedIn didn’t take it: ${result?.publishResult?.linkedin?.message || 'no reason given'}. Pandav tries again by itself.`
            : withLinkedin
              ? 'Posted to the Pandav feed and LinkedIn.'
              : 'Posted to the Pandav feed.',
      )
    } catch (shareError) {
      setError(getErrorMessage(shareError, 'Couldn’t share this task. Try again.'))
      setSharing(false)
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        if (!sharing) onClose()
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit}>
        <h3 id={`${id}-title`} className="text-lg font-bold text-neutral-900">Share this task?</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Everyone in Pandav will see this post. Check the text first and remove anything private.
        </p>

        <label className="mt-4 block" htmlFor={`${id}-content`}>
          <span className="mb-2 block text-sm font-medium text-neutral-700">Post</span>
        </label>
        <textarea
          id={`${id}-content`}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={7}
          maxLength={5000}
          required
          className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
        />

        <label className={`mt-3 flex items-center gap-2 text-sm ${canUseLinkedin ? 'text-neutral-700' : 'text-neutral-400'}`}>
          <input
            type="checkbox"
            checked={toLinkedin && canUseLinkedin}
            disabled={!canUseLinkedin}
            onChange={(event) => setToLinkedin(event.target.checked)}
          />
          <span>
            Also post on LinkedIn
            {linkedin === 'none' ? ' (connect LinkedIn first, in the Social Hub under Integrations)' : ''}
            {linkedin === 'expired' ? ' (your LinkedIn sign-in has expired: connect it again in the Social Hub)' : ''}
          </span>
        </label>

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sharing}
            className="flex-1 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Don't share
          </button>
          <button
            type="submit"
            disabled={sharing || !content.trim()}
            aria-busy={sharing || undefined}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {sharing ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
