import { useId, useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorText } from './format'
import { CONTENT_MAX, TAG_MAX, TAGS_MAX, TITLE_MAX, parseTags } from './postForm'
import { BusyButton, SectionCard } from './ui'
import { hintClass, inputClass, labelClass, primaryButton } from './styles'
import type { SocialPost, Visibility } from './types'

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

export default function PostComposer({
  needsApproval,
  onCreated,
}: {
  // Users and team members: LinkedIn and GitHub posts wait for approval
  needsApproval: boolean
  onCreated: (post: SocialPost) => void
}) {
  const { notify } = useFeedback()
  const id = useId()
  const [form, setForm] = useState(initialComposer)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const external = form.linkedin || form.github
  const noTarget = !form.pandav && !form.linkedin && !form.github

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const content = form.content.trim()
    const { tags, error: tagError } = parseTags(form.tags)
    if (!content) return setError('Write something to post.')
    if (noTarget) return setError('Choose where to post it.')
    if (tagError) return setError(tagError)
    setError('')
    setSubmitting(true)
    try {
      const response = await socialV2API.createPost({
        title: form.title.trim() || undefined,
        content,
        visibility: form.visibility,
        tags,
        targets: { pandav: form.pandav, linkedin: form.linkedin, github: form.github },
      })
      const post = response?.data as SocialPost | undefined
      if (post) onCreated(post)
      setForm(initialComposer)
      notify(
        post?.approvalStatus === 'pending'
          ? 'Posted. It waits for approval: until then only you and admins can see it.'
          : !form.pandav
            ? 'Saved. It isn’t in the feed; publish it to LinkedIn or GitHub from the post.'
            : external
              ? 'Posted. Publish it to LinkedIn or GitHub from the post when you’re ready.'
              : 'Posted to the feed.',
        'success',
      )
    } catch (submitError) {
      setError(errorText(submitError, 'Couldn’t create the post. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SectionCard id="compose" title="Compose update" description="Share progress with your colleagues, and optionally on LinkedIn or GitHub.">
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
            <label htmlFor={`${id}-visibility`} className={labelClass}>Who can see it</label>
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
            placeholder="Share progress, celebrate a milestone, or draft an update for LinkedIn or GitHub…"
            rows={5}
            aria-describedby={`${id}-content-count`}
            className={`${inputClass} rounded-[24px]`}
          />
          <p id={`${id}-content-count`} className={`${hintClass} text-right`}>{form.content.length}/{CONTENT_MAX}</p>
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
          <p id={`${id}-tags-hint`} className={hintClass}>Separate tags with commas: up to {TAGS_MAX}, each up to {TAG_MAX} characters.</p>
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
            {needsApproval
              ? 'LinkedIn and GitHub posts wait for approval by your team leader or an admin. Targets can’t be changed later.'
              : 'Targets can’t be changed later.'}
            {!form.pandav && !noTarget ? ' Without the Pandav feed, only you and admins see the post here.' : ''}
          </p>
        </fieldset>

        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}

        <div className="flex justify-end">
          <BusyButton
            type="submit"
            busy={submitting}
            busyLabel="Posting…"
            icon={<Send className="h-4 w-4" aria-hidden="true" />}
            className={`${primaryButton} px-5 py-3`}
          >
            Create post
          </BusyButton>
        </div>
      </form>
    </SectionCard>
  )
}
