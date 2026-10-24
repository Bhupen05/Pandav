import { useId, useState, type FormEvent } from 'react'
import { CalendarClock, Eye, EyeOff, Linkedin, Send } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import ImagePicker, { type PickedImage } from './ImagePicker'
import LinkedInPreview from './LinkedInPreview'
import { errorText, formatDateTime } from './format'
import { LINKEDIN_TEXT_MAX, accountName, linkedInText, startConnect, usableAccount } from './linkedin'
import { CONTENT_MAX, TAG_MAX, TAGS_MAX, TITLE_MAX, parseTags } from './postForm'
import { BusyButton, SectionCard } from './ui'
import { hintClass, inputClass, labelClass, primaryButton, secondaryButton, smallButton } from './styles'
import type { Integration, SocialPost, Visibility } from './types'

const initialComposer = {
  title: '',
  content: '',
  visibility: 'public' as Visibility,
  pandav: true,
  linkedin: false,
  github: false,
  tags: '',
}

const targetOptions = [
  ['pandav', 'Pandav feed'],
  ['linkedin', 'LinkedIn'],
  ['github', 'GitHub'],
] as const

// How far ahead a post can be scheduled (the server's limit)
const SCHEDULE_DAYS = 90

// A date as a datetime-local input shows it, in this browser's timezone
const toLocalInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const scheduleProblem = (value: string) => {
  if (!value) return 'Choose when it goes to LinkedIn.'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return 'Choose when it goes to LinkedIn.'
  if (at.getTime() <= Date.now()) return 'Choose a time that is still to come.'
  if (at.getTime() > Date.now() + SCHEDULE_DAYS * 24 * 60 * 60 * 1000) return `A post can be scheduled at most ${SCHEDULE_DAYS} days ahead.`
  return ''
}

export default function PostComposer({
  needsApproval,
  linkedin,
  onCreated,
}: {
  // Users and team members: LinkedIn and GitHub posts wait for approval
  needsApproval: boolean
  // The person's LinkedIn link, in whatever state it is
  linkedin: Integration | null
  onCreated: (post: SocialPost) => void
}) {
  const { notify } = useFeedback()
  const id = useId()
  const [form, setForm] = useState(initialComposer)
  const [images, setImages] = useState<PickedImage[]>([])
  const [timing, setTiming] = useState<'now' | 'later'>('now')
  const [publishAt, setPublishAt] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  const account = usableAccount(linkedin)
  const external = form.linkedin || form.github
  const noTarget = !form.pandav && !form.linkedin && !form.github
  const { tags } = parseTags(form.tags)
  const liText = linkedInText({ title: form.title, content: form.content, tags })
  const liOver = form.linkedin && liText.length > LINKEDIN_TEXT_MAX
  const later = form.linkedin && timing === 'later'
  const laterAt = later && publishAt ? new Date(publishAt) : null
  // LinkedIn sign-ins last about two months; a post due after that won't go
  const expiresFirst = Boolean(laterAt && account?.tokenExpiresAt && laterAt > new Date(account.tokenExpiresAt))

  async function connectLinkedIn() {
    setConnecting(true)
    try {
      await startConnect('linkedin')
    } catch (connectError) {
      setError(errorText(connectError, 'Couldn’t start connecting LinkedIn. Try again.'))
      setConnecting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const content = form.content.trim()
    const { error: tagError } = parseTags(form.tags)
    if (!content) return setError('Write something to post.')
    if (noTarget) return setError('Choose where to post it.')
    if (tagError) return setError(tagError)
    if (form.linkedin && !account) return setError('Connect your LinkedIn account first, or untick LinkedIn.')
    if (liOver) return setError(`It is too long for LinkedIn: ${liText.length} of ${LINKEDIN_TEXT_MAX} characters, with the title and tags.`)
    if (images.some((image) => image.status === 'uploading')) return setError('Wait for the images to finish uploading.')
    if (images.some((image) => image.status === 'failed')) return setError('Remove the images that didn’t upload.')
    if (later) {
      const problem = scheduleProblem(publishAt)
      if (problem) return setError(problem)
    }
    setError('')
    setSubmitting(true)
    try {
      const response = await socialV2API.createPost({
        title: form.title.trim() || undefined,
        content,
        visibility: form.visibility,
        tags,
        targets: { pandav: form.pandav, linkedin: form.linkedin, github: form.github },
        images: images.map((image) => ({ id: image.id as string, altText: image.altText.trim() || undefined })),
        ...(form.linkedin ? { autoPublish: true, publishAt: later ? new Date(publishAt).toISOString() : null } : {}),
      })
      const post = response?.data as SocialPost | undefined
      if (post) onCreated(post)
      setForm(initialComposer)
      setImages([])
      setTiming('now')
      setPublishAt('')
      setShowPreview(false)
      const result = post?.publishResults?.linkedin
      if (post?.approvalStatus === 'pending') {
        notify(
          form.linkedin
            ? `Posted. It goes to LinkedIn${later ? ` on ${formatDateTime(post.publishAt)}` : ''} once your team leader or an admin approves it. Until then only you and admins see it.`
            : 'Posted. It waits for approval: until then only you and admins can see it.',
          'success',
        )
      } else if (form.linkedin && result?.status === 'published') {
        notify(form.pandav ? 'Posted here and on LinkedIn.' : 'Posted on LinkedIn.', 'success')
      } else if (form.linkedin && result?.status === 'failed') {
        notify(`Saved, but LinkedIn didn’t take it yet: ${result.message}. Pandav tries again by itself.`, 'error')
      } else if (form.linkedin && post?.publishAt) {
        notify(`Saved. It goes to LinkedIn on ${formatDateTime(post.publishAt)}.`, 'success')
      } else {
        notify(
          !form.pandav
            ? 'Saved. It isn’t in the feed; publish it to GitHub from the post.'
            : form.github
              ? 'Posted. Publish it to GitHub from the post when you’re ready.'
              : 'Posted to the feed.',
          'success',
        )
      }
    } catch (submitError) {
      setError(errorText(submitError, 'Couldn’t create the post. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const submitLabel = !form.linkedin ? 'Create post' : needsApproval ? 'Send for approval' : later ? 'Schedule' : 'Post now'

  return (
    <SectionCard id="compose" title="Compose update" description="Share progress with your colleagues, and on LinkedIn or GitHub.">
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${id}-title`} className={labelClass}>Title <span className="font-normal text-slate-500">(optional)</span></label>
            <input
              id={`${id}-title`}
              value={form.title}
              maxLength={TITLE_MAX}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-visibility`} className={labelClass}>Who can see it in Pandav</label>
            <select
              id={`${id}-visibility`}
              value={form.visibility}
              onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value as Visibility }))}
              className={inputClass}
            >
              <option value="public">Everyone in Pandav</option>
              <option value="team">My team only</option>
              <option value="connections">My connections only</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-content`} className={labelClass}>Post</label>
          <textarea
            id={`${id}-content`}
            value={form.content}
            maxLength={CONTENT_MAX}
            required
            onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            placeholder="Share progress, celebrate a milestone, or draft an update for LinkedIn…"
            rows={5}
            aria-describedby={`${id}-content-count`}
            className={`${inputClass} rounded-[24px]`}
          />
          <p id={`${id}-content-count`} aria-live="polite" className={`${hintClass} text-right ${liOver ? 'font-semibold text-rose-700' : ''}`}>
            {form.linkedin
              ? `${liText.length}/${LINKEDIN_TEXT_MAX} on LinkedIn, with the title and tags`
              : `${form.content.length}/${CONTENT_MAX}`}
          </p>
        </div>

        <div>
          <span className={labelClass}>Images <span className="font-normal text-slate-500">(optional)</span></span>
          <ImagePicker images={images} setImages={setImages} disabled={submitting} />
        </div>

        <div>
          <label htmlFor={`${id}-tags`} className={labelClass}>Tags <span className="font-normal text-slate-500">(optional)</span></label>
          <input
            id={`${id}-tags`}
            value={form.tags}
            onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
            placeholder="release, design"
            aria-describedby={`${id}-tags-hint`}
            className={inputClass}
          />
          <p id={`${id}-tags-hint`} className={hintClass}>
            Separate tags with commas: up to {TAGS_MAX}, each up to {TAG_MAX} characters. On LinkedIn they become hashtags.
          </p>
        </div>

        <fieldset>
          <legend className={labelClass}>Post to</legend>
          <div className="flex flex-wrap gap-2">
            {targetOptions.map(([key, label]) => (
              <label
                key={key}
                className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-400 has-[:focus-visible]:ring-offset-2 ${
                  form[key] ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))}
                  className="sr-only"
                />
                <span aria-hidden="true">{form[key] ? '✓' : '+'}</span>
                {label}
              </label>
            ))}
          </div>
          <p className={hintClass}>
            {external && needsApproval
              ? 'LinkedIn and GitHub posts wait for approval by your team leader or an admin. '
              : ''}
            Where it goes can’t be changed later.
            {!form.pandav && !noTarget ? ' Without the Pandav feed, only you and admins see the post here.' : ''}
          </p>
        </fieldset>

        {form.linkedin ? (
          <section aria-label="LinkedIn" className="space-y-3 rounded-[24px] border border-sky-200 bg-sky-50/70 p-4">
            {!account ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  {linkedin?.needsRelink
                    ? 'Your LinkedIn sign-in has expired. Connect again to post there.'
                    : 'Connect your LinkedIn account to post there. You’ll come back here afterwards.'}
                </p>
                <BusyButton
                  busy={connecting}
                  busyLabel="Opening LinkedIn…"
                  onClick={() => void connectLinkedIn()}
                  icon={<Linkedin className="h-4 w-4" aria-hidden="true" />}
                  className={`${primaryButton} bg-[#0a66c2] hover:bg-[#004182]`}
                >
                  {linkedin?.needsRelink ? 'Connect again' : 'Connect LinkedIn'}
                </BusyButton>
              </div>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm text-slate-700">
                  <Linkedin className="h-4 w-4 shrink-0 text-[#0a66c2]" aria-hidden="true" />
                  <span>
                    Posting as <span className="font-semibold text-slate-900">{accountName(account)}</span>, publicly.
                  </span>
                </p>

                <fieldset>
                  <legend className="sr-only">When it goes to LinkedIn</legend>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['now', needsApproval ? 'As soon as it’s approved' : 'Now'],
                      ['later', 'At a time I choose'],
                    ] as const).map(([value, label]) => (
                      <label
                        key={value}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-400 ${
                          timing === value ? 'border-[#0a66c2] bg-white text-[#0a66c2]' : 'border-slate-200 bg-white/60 text-slate-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${id}-timing`}
                          value={value}
                          checked={timing === value}
                          onChange={() => setTiming(value)}
                          className="sr-only"
                        />
                        {value === 'later' ? <CalendarClock className="h-4 w-4" aria-hidden="true" /> : null}
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {timing === 'later' ? (
                  <div>
                    <label htmlFor={`${id}-publish-at`} className={labelClass}>Post on LinkedIn at</label>
                    <input
                      id={`${id}-publish-at`}
                      type="datetime-local"
                      value={publishAt}
                      min={toLocalInput(new Date())}
                      max={toLocalInput(new Date(Date.now() + SCHEDULE_DAYS * 24 * 60 * 60 * 1000))}
                      onChange={(event) => setPublishAt(event.target.value)}
                      aria-describedby={`${id}-publish-at-hint`}
                      className={`${inputClass} md:max-w-xs`}
                    />
                    <p id={`${id}-publish-at-hint`} className={hintClass}>
                      Your time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
                      {needsApproval ? ' If it’s approved after that, it goes out when it’s approved.' : ''}
                    </p>
                    {expiresFirst ? (
                      <p role="alert" className="mt-1 text-xs font-semibold text-amber-800">
                        Your LinkedIn sign-in ends on {formatDateTime(account.tokenExpiresAt)}, before then. Connect LinkedIn again before it’s due, or it won’t go out.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => setShowPreview((current) => !current)}
                  aria-expanded={showPreview}
                  className={`${secondaryButton} ${smallButton}`}
                >
                  {showPreview ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                  {showPreview ? 'Hide the LinkedIn preview' : 'Preview on LinkedIn'}
                </button>
                {showPreview ? (
                  <div className="max-w-xl">
                    <LinkedInPreview
                      name={accountName(account)}
                      picture={account.metadata?.picture}
                      when={laterAt ? formatDateTime(laterAt.toISOString()) : 'Now'}
                      text={liText}
                      images={images
                        .filter((image) => image.status !== 'failed')
                        .map((image) => ({ key: image.key, src: image.previewUrl, alt: image.altText, width: image.width, height: image.height }))}
                    />
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}

        <div className="flex justify-end">
          <BusyButton
            type="submit"
            busy={submitting}
            busyLabel={form.linkedin && !later && !needsApproval ? 'Posting to LinkedIn…' : 'Posting…'}
            icon={<Send className="h-4 w-4" aria-hidden="true" />}
            className={`${primaryButton} px-5 py-3`}
          >
            {submitLabel}
          </BusyButton>
        </div>
      </form>
    </SectionCard>
  )
}
