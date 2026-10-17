import { useEffect, useRef, useState, type FormEvent } from 'react'
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

type Integration = { provider: string; isConnected?: boolean }

// Shown when a personal task with auto-share on is completed: nothing is
// posted until the owner reads (and can edit) the text and confirms
export default function ShareTaskDialog({ offer, onClose, onShared }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [content, setContent] = useState(offer.draft.content)
  const [linkedinLinked, setLinkedinLinked] = useState(false)
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
        const linked = list.some((item) => item.provider === 'linkedin' && item.isConnected)
        setLinkedinLinked(linked)
        setToLinkedin(linked)
      })
      .catch(() => setLinkedinLinked(false))
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSharing(true)
    setError('')
    try {
      const response = await socialV2API.sharePersonalTask(offer.taskId, { content: content.trim(), linkedin: toLinkedin })
      const result = response?.data
      const linkedinStatus = result?.publishResult?.linkedin?.status
      onShared(
        result?.pendingApproval
          ? 'Posted to the Pandav feed. The LinkedIn post waits for your team leader to approve it.'
          : toLinkedin && linkedinStatus !== 'published'
            ? `Posted to the Pandav feed, but LinkedIn refused it: ${result?.publishResult?.linkedin?.message || 'unknown error'}`
            : toLinkedin
              ? 'Posted to the Pandav feed and LinkedIn.'
              : 'Posted to the Pandav feed.',
      )
    } catch (shareError) {
      setError(getErrorMessage(shareError, 'Unable to share this task'))
      setSharing(false)
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="share-task-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit}>
        <h3 id="share-task-title" className="text-lg font-bold text-neutral-900">Share this task?</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Everyone in Pandav will see this post. Check the text first and remove anything private.
        </p>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-neutral-700">Post</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={7}
            maxLength={5000}
            required
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
          />
        </label>

        <label className={`mt-3 flex items-center gap-2 text-sm ${linkedinLinked ? 'text-neutral-700' : 'text-neutral-400'}`}>
          <input
            type="checkbox"
            checked={toLinkedin}
            disabled={!linkedinLinked}
            onChange={(event) => setToLinkedin(event.target.checked)}
          />
          Also post on LinkedIn{linkedinLinked ? '' : ' (link your LinkedIn account in the Social Hub first)'}
        </label>

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Don't share
          </button>
          <button
            type="submit"
            disabled={sharing || !content.trim()}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {sharing ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
