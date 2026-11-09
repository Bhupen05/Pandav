import { useId, useState, type ReactNode } from 'react'
import { ExternalLink, Github, LoaderCircle, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorText, externalLink, formatDateTime } from './format'
import { useBusy } from './hooks'
import type { PatchPost } from './postState'
import { BusyButton } from './ui'
import { hintClass, inputClass, labelClass, linkButton, darkButton, smallButton } from './styles'
import type { QueuedJob, SocialPost } from './types'

// Where a post stands with GitHub (it is opened there as an issue), and, for
// its publisher, the button that queues that. Once the issue exists, or a job
// is already waiting, there is nothing left to press.
export default function GitHubStatus({
  post,
  canPublish,
  onChange,
}: {
  post: SocialPost
  // The caller may publish this post (its author, an admin, or its author's leader)
  canPublish: boolean
  onChange: PatchPost
}) {
  const { notify } = useFeedback()
  const { busy, run } = useBusy()
  const id = useId()
  const [repo, setRepo] = useState('')
  const [error, setError] = useState('')

  if (!post.targets.github) return null

  const result = post.publishResults?.github
  const job = post.queuedJobs?.github
  const published = result?.status === 'published'
  const live = !['hidden', 'removed'].includes(post.moderationStatus)
  const decided = ['none', 'approved'].includes(post.approvalStatus)
  const canQueue = canPublish && live && decided && !published && !job
  const link = externalLink('github', result?.externalId)

  let line: ReactNode
  let tone = 'border-slate-200 bg-slate-50 text-slate-700'
  let icon = <Github className="h-4 w-4" aria-hidden="true" />

  if (published) {
    tone = 'border-emerald-200 bg-emerald-50 text-emerald-900'
    line = (
      <>
        Opened as a GitHub issue{result?.publishedAt ? ` on ${formatDateTime(result.publishedAt)}` : ''}.
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className={`${linkButton} ml-2 inline-flex items-center gap-1 text-emerald-800`}>
            View issue <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </>
    )
  } else if (job?.status === 'processing') {
    icon = <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
    line = 'Opening the GitHub issue…'
  } else if (post.approvalStatus === 'pending') {
    tone = 'border-amber-200 bg-amber-50 text-amber-900'
    line = 'Waiting for approval before it can go to GitHub.'
  } else if (post.approvalStatus === 'rejected') {
    tone = 'border-rose-200 bg-rose-50 text-rose-800'
    line = 'Not approved for GitHub.'
  } else if (!live) {
    line = 'It can’t go to GitHub while it is hidden or removed.'
  } else if (job && job.attempts > 0) {
    tone = 'border-rose-200 bg-rose-50 text-rose-800'
    line = `GitHub didn’t take it: ${job.lastError ?? 'no reason given'}. Pandav tries again ${job.nextRetryAt ? `at ${formatDateTime(job.nextRetryAt)}` : 'soon'}.`
  } else if (job) {
    tone = 'border-sky-200 bg-sky-50 text-sky-900'
    line = (
      <>
        Queued: the issue is opened within a minute.
        <Link to="/publish-jobs" className={`${linkButton} ml-2`}>See it in Publishing</Link>
      </>
    )
  } else if (result?.status === 'failed') {
    tone = 'border-rose-200 bg-rose-50 text-rose-800'
    line = `Couldn’t open the issue: ${result.message ?? 'no reason given'}`
  } else {
    line = 'Not on GitHub yet.'
  }

  const queue = () =>
    run('queue', async () => {
      setError('')
      try {
        const response = await socialV2API.createPublishJobs(post._id, {
          targets: { github: true },
          githubRepo: repo.trim() || null,
        })
        const created = (Array.isArray(response?.data) ? response.data : []).find(
          (item: { provider?: string }) => item.provider === 'github',
        )
        if (created) {
          const queued: QueuedJob = {
            _id: created._id,
            status: created.status === 'processing' ? 'processing' : 'queued',
            attempts: created.attempts ?? 0,
            maxAttempts: created.maxAttempts ?? 3,
            nextRetryAt: created.nextRetryAt ?? null,
            lastError: created.lastError ?? null,
          }
          onChange(post._id, (old) => ({ ...old, queuedJobs: { ...old.queuedJobs, github: queued } }))
        }
        notify('Queued. The GitHub issue is opened within a minute.', 'success')
      } catch (queueError) {
        setError(errorText(queueError, 'Couldn’t queue it for GitHub. Try again.'))
      }
    })

  return (
    <div className={`mt-4 rounded-[22px] border px-4 py-3 text-sm ${tone}`}>
      <p className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 break-words">{line}</span>
      </p>

      {canQueue ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void queue()
          }}
        >
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor={`${id}-repo`} className={`${labelClass} mb-1 text-xs`}>GitHub repository</label>
            <input
              id={`${id}-repo`}
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="owner/name"
              autoComplete="off"
              aria-describedby={`${id}-repo-hint`}
              className={`${inputClass} rounded-xl bg-white px-3 py-2`}
            />
          </div>
          <BusyButton
            type="submit"
            busy={busy.queue}
            busyLabel="Queuing…"
            icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
            className={`${darkButton} ${smallButton} py-2.5`}
          >
            Publish to GitHub
          </BusyButton>
          <p id={`${id}-repo-hint`} className={`${hintClass} basis-full`}>
            The issue is opened as the author. Leave the repository empty to use the default one, if there is one.
          </p>
          {error ? <p role="alert" className="basis-full text-sm text-rose-700">{error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}
