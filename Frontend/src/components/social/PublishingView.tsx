import { useId, useState } from 'react'
import { ExternalLink, Github, Linkedin, Play, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { socialV2API } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import {
  errorText,
  excerpt,
  externalLink,
  formatDateTime,
  jobStatusLabel,
  jobTone,
  listOf,
  personOf,
  plural,
  providerLabel,
} from './format'
import { useBusy, useNow, useResource, useShowMore } from './hooks'
import { Badge, BusyButton, EmptyState, ErrorState, LoadingState, SectionCard, ShowMore } from './ui'
import { inputClass, labelClass, linkButton, darkButton, secondaryButton, smallButton } from './styles'
import type { JobStatus, PublishJob, Provider } from './types'

const STATUSES: JobStatus[] = ['queued', 'processing', 'completed', 'failed']

const postOf = (job: PublishJob) => (job.post && typeof job.post === 'object' ? job.post : null)

// What the server returns after running or retrying a job leaves out the
// post and people; keep the ones the list already has
const refreshed = (old: PublishJob, fresh: Partial<PublishJob>): PublishJob => ({
  ...old,
  ...fresh,
  post: old.post,
  owner: old.owner,
  queuedBy: old.queuedBy ?? fresh.queuedBy,
})

function JobCard({
  job,
  isAdmin,
  now,
  onChange,
}: {
  job: PublishJob
  isAdmin: boolean
  now: number
  onChange: (jobId: string, next: PublishJob) => void
}) {
  const { notify } = useFeedback()
  const { busy, run } = useBusy()
  const post = postOf(job)
  const owner = personOf(job.owner)
  const queuedBy = personOf(job.queuedBy)
  const Icon = job.provider === 'linkedin' ? Linkedin : Github
  const link = externalLink(job.provider, job.result?.externalId)
  const dueAt = job.nextRetryAt ? new Date(job.nextRetryAt).getTime() : 0
  // Anyone may run a queued job once it is due; only an admin before that
  const canProcess = job.status === 'queued' && (isAdmin || dueAt <= now)
  const waiting = job.status === 'queued' && !canProcess
  const title = post?.title || excerpt(post?.content, 70) || 'A post that was deleted'

  const runNow = () =>
    run('process', async () => {
      try {
        const response = await socialV2API.processPublishJob(job._id)
        const fresh = response?.data as PublishJob | undefined
        if (fresh) onChange(job._id, refreshed(job, fresh))
        if (response?.success === false || response?.error) {
          notify(`It didn’t go through: ${response?.error ?? 'no reason given'}`, 'error')
        } else {
          notify(response?.message || (fresh?.status === 'completed' ? `Published to ${providerLabel[job.provider]}.` : 'Done.'), 'success')
        }
      } catch (error) {
        notify(errorText(error, 'Couldn’t run the job.'), 'error')
      }
    })

  const retry = () =>
    run('retry', async () => {
      try {
        const response = await socialV2API.retryPublishJob(job._id)
        const fresh = response?.data as PublishJob | undefined
        if (fresh) onChange(job._id, refreshed(job, fresh))
        notify('It is queued to run again.', 'success')
      } catch (error) {
        notify(errorText(error, 'Couldn’t retry the job.'), 'error')
      }
    })

  return (
    <li className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {providerLabel[job.provider]}
            </span>
            <Badge className={jobTone[job.status]}>{jobStatusLabel[job.status]}</Badge>
          </div>
          <p className="mt-1 break-words text-sm text-slate-700">
            {post?._id ? (
              <Link to={`/social?post=${post._id}`} className={linkButton}>{title}</Link>
            ) : (
              title
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canProcess ? (
            <BusyButton
              busy={busy.process}
              busyLabel="Running…"
              onClick={() => void runNow()}
              icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
              className={`${darkButton} ${smallButton}`}
              aria-label={`Run the ${providerLabel[job.provider]} job for ${title} now`}
            >
              {isAdmin && dueAt > now ? 'Run now' : 'Process'}
            </BusyButton>
          ) : null}
          {job.status === 'failed' ? (
            <BusyButton
              busy={busy.retry}
              busyLabel="Retrying…"
              onClick={() => void retry()}
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              className={`${secondaryButton} ${smallButton}`}
              aria-label={`Retry the ${providerLabel[job.provider]} job for ${title}`}
            >
              Retry
            </BusyButton>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
        {owner ? (
          <div className="flex gap-1.5"><dt className="text-slate-500">Posted as</dt><dd className="font-semibold">{owner.name}</dd></div>
        ) : null}
        {queuedBy ? (
          <div className="flex gap-1.5"><dt className="text-slate-500">Queued by</dt><dd className="font-semibold">{queuedBy.name}</dd></div>
        ) : null}
        <div className="flex gap-1.5"><dt className="text-slate-500">Attempts</dt><dd className="font-semibold">{job.attempts} of {job.maxAttempts}</dd></div>
        {job.payload?.githubRepo ? (
          <div className="flex gap-1.5"><dt className="text-slate-500">Repository</dt><dd className="break-all font-semibold">{job.payload.githubRepo}</dd></div>
        ) : null}
        {job.status === 'queued' && job.nextRetryAt ? (
          <div className="flex gap-1.5">
            <dt className="text-slate-500">{job.attempts > 0 ? 'Next retry' : 'Due'}</dt>
            <dd className="font-semibold">{formatDateTime(job.nextRetryAt)}</dd>
          </div>
        ) : null}
        {job.startedAt && job.status !== 'queued' ? (
          <div className="flex gap-1.5"><dt className="text-slate-500">Started</dt><dd className="font-semibold">{formatDateTime(job.startedAt)}</dd></div>
        ) : null}
        {job.completedAt ? (
          <div className="flex gap-1.5">
            <dt className="text-slate-500">{job.status === 'failed' ? 'Gave up' : 'Finished'}</dt>
            <dd className="font-semibold">{formatDateTime(job.completedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {job.lastError ? (
        <p className="mt-2 break-words rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="font-semibold">Last error:</span> {job.lastError}
        </p>
      ) : null}
      {job.result?.alreadyPublished ? <p className="mt-2 text-sm text-slate-600">It had already been published another way, so nothing was sent again.</p> : null}
      {waiting ? <p className="mt-2 text-xs text-slate-500">It runs by itself at the time above.</p> : null}
      {job.status === 'completed' && link ? (
        <a href={link} target="_blank" rel="noreferrer" className={`${linkButton} mt-2 inline-flex items-center gap-1 text-xs`}>
          View on {providerLabel[job.provider]} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  )
}

// Publish jobs: what is queued, running, published or failed on its way to
// LinkedIn or GitHub, with the buttons to run or retry them
export default function PublishingView() {
  const { isAdmin } = useAuth()
  const { notify } = useFeedback()
  const { busy, run } = useBusy()
  const id = useId()
  const jobs = useResource<PublishJob[]>(
    async () => listOf<PublishJob>((await socialV2API.getPublishJobs())?.data),
    'Couldn’t load the publish jobs.',
    [],
  )
  const [status, setStatus] = useState<'' | JobStatus>('')
  const [provider, setProvider] = useState<'' | Provider>('')
  const { limit, initial, more, less } = useShowMore(8)
  const now = useNow()
  const { setData, reload } = jobs

  const shown = jobs.data.filter((job) => (!status || job.status === status) && (!provider || job.provider === provider))

  const processDue = () =>
    run('due', async () => {
      try {
        const response = await socialV2API.processDuePublishJobs()
        const ran = listOf<{ success?: boolean; status?: string }>(response?.data)
        const published = ran.filter((item) => item.status === 'completed').length
        notify(
          ran.length === 0
            ? 'No jobs were due.'
            : `Ran ${plural(ran.length, 'job')}: ${published} published, ${ran.length - published} still waiting or failed.`,
          'success',
        )
        await reload()
      } catch (error) {
        notify(errorText(error, 'Couldn’t run the due jobs.'), 'error')
      }
    })

  return (
    <div className="mx-auto w-full max-w-3xl">
      <SectionCard
        id="publish-jobs"
        title="Publish jobs"
        description="Posts on their way to LinkedIn and GitHub. Scheduled LinkedIn posts wait here until their time, and a failed one tries again by itself."
        action={
          isAdmin ? (
            <BusyButton busy={busy.due} busyLabel="Running…" onClick={() => void processDue()} className={`${darkButton} ${smallButton}`}>
              Process due jobs
            </BusyButton>
          ) : undefined
        }
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-status`} className={labelClass}>Status</label>
            <select id={`${id}-status`} value={status} onChange={(event) => setStatus(event.target.value as '' | JobStatus)} className={inputClass}>
              <option value="">All ({jobs.data.length})</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>{jobStatusLabel[value]} ({jobs.data.filter((job) => job.status === value).length})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-provider`} className={labelClass}>Where</label>
            <select id={`${id}-provider`} value={provider} onChange={(event) => setProvider(event.target.value as '' | Provider)} className={inputClass}>
              <option value="">LinkedIn and GitHub</option>
              <option value="linkedin">LinkedIn</option>
              <option value="github">GitHub</option>
            </select>
          </div>
        </div>

        {jobs.error ? <div className="mb-4"><ErrorState message={jobs.error} onRetry={() => void jobs.reload()} retrying={jobs.loading} /></div> : null}
        {!jobs.loaded && jobs.loading ? <LoadingState label="Loading publish jobs…" /> : null}
        {jobs.loaded && jobs.data.length === 0 ? (
          <EmptyState>No publish jobs yet. Posts you send to LinkedIn or GitHub show up here.</EmptyState>
        ) : null}
        {jobs.loaded && jobs.data.length > 0 && shown.length === 0 ? <EmptyState>No jobs match these filters.</EmptyState> : null}

        <ul className="space-y-3">
          {shown.slice(0, limit).map((job) => (
            <JobCard
              key={job._id}
              job={job}
              isAdmin={isAdmin}
              now={now}
              onChange={(jobId, next) => setData((list) => list.map((item) => (item._id === jobId ? next : item)))}
            />
          ))}
        </ul>
        <ShowMore limit={limit} initial={initial} total={shown.length} onMore={more} onLess={less} noun="more jobs" />
        {jobs.loaded && jobs.data.length >= 200 ? <p className="mt-3 text-xs text-slate-500">Showing the 200 newest jobs.</p> : null}
        {jobs.loaded ? <span className="sr-only" aria-live="polite">{plural(shown.length, 'job')} shown</span> : null}
      </SectionCard>
    </div>
  )
}
