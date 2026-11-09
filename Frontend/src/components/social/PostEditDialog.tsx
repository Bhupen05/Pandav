import { useId, useState, type FormEvent } from 'react'
import { socialV2API } from '../../api/socialV2API'
import { errorText } from './format'
import { LINKEDIN_TEXT_MAX, linkedInText } from './linkedin'
import Modal from './Modal'
import { CONTENT_MAX, TAG_MAX, TAGS_MAX, TITLE_MAX, parseTags } from './postForm'
import { BusyButton } from './ui'
import { hintClass, inputClass, labelClass, primaryButton, secondaryButton } from './styles'
import type { SocialPost, Visibility } from './types'

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((tag, index) => tag === b[index])

// Where the post is edited: its title, text, tags and who sees it. Where it is
// posted can't change. The result is shown here (toasts sit behind a dialog).
export default function PostEditDialog({
  post,
  needsApproval,
  onClose,
  onSaved,
}: {
  post: SocialPost
  // The author is a user or team member: editing an approved post that isn't
  // on LinkedIn or GitHub yet sends it back for approval
  needsApproval: boolean
  onClose: () => void
  // The post as the server has it now, and its message when it needs approval again
  onSaved: (post: SocialPost, message?: string) => void
}) {
  const id = useId()
  const [title, setTitle] = useState(post.title ?? '')
  const [content, setContent] = useState(post.content)
  const [visibility, setVisibility] = useState<Visibility>(post.visibility)
  const [tagsText, setTagsText] = useState((post.tags ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { tags, error: tagError } = parseTags(tagsText)
  const onLinkedIn = post.targets.linkedin && post.publishResults?.linkedin?.status !== 'published'
  const unpublishedExternal =
    (post.targets.linkedin && post.publishResults?.linkedin?.status !== 'published') ||
    (post.targets.github && post.publishResults?.github?.status !== 'published')
  const backToApproval = needsApproval && post.approvalStatus === 'approved' && unpublishedExternal
  const liText = linkedInText({ title, content, tags })
  const liOver = onLinkedIn && liText.length > LINKEDIN_TEXT_MAX

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const text = content.trim()
    if (!text) return setError('Write something to post.')
    if (tagError) return setError(tagError)
    if (liOver) return setError(`It is too long for LinkedIn: ${liText.length} of ${LINKEDIN_TEXT_MAX} characters, with the title and tags.`)

    // Only what changed is sent
    const changes: Record<string, unknown> = {}
    if (title.trim() !== (post.title ?? '')) changes.title = title.trim() || null
    if (text !== post.content) changes.content = text
    if (visibility !== post.visibility) changes.visibility = visibility
    if (!sameTags(tags, post.tags ?? [])) changes.tags = tags
    if (Object.keys(changes).length === 0) return onClose()

    setError('')
    setSaving(true)
    try {
      const response = await socialV2API.updatePost(post._id, changes)
      onSaved(response.data as SocialPost, response.message as string | undefined)
    } catch (saveError) {
      setError(errorText(saveError, 'Couldn’t save the post. Try again.'))
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit your post" description="Where it is posted can’t be changed." onClose={onClose} busy={saving}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <label htmlFor={`${id}-title`} className={labelClass}>Title <span className="font-normal text-slate-500">(optional)</span></label>
          <input id={`${id}-title`} value={title} maxLength={TITLE_MAX} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
        </div>

        <div>
          <label htmlFor={`${id}-content`} className={labelClass}>Post</label>
          <textarea
            id={`${id}-content`}
            value={content}
            maxLength={CONTENT_MAX}
            rows={6}
            required
            onChange={(event) => setContent(event.target.value)}
            aria-describedby={`${id}-count`}
            className={`${inputClass} rounded-[24px]`}
          />
          <p id={`${id}-count`} aria-live="polite" className={`${hintClass} text-right ${liOver ? 'font-semibold text-rose-700' : ''}`}>
            {onLinkedIn ? `${liText.length}/${LINKEDIN_TEXT_MAX} on LinkedIn, with the title and tags` : `${content.length}/${CONTENT_MAX}`}
          </p>
        </div>

        <div>
          <label htmlFor={`${id}-tags`} className={labelClass}>Tags <span className="font-normal text-slate-500">(optional)</span></label>
          <input id={`${id}-tags`} value={tagsText} onChange={(event) => setTagsText(event.target.value)} aria-describedby={`${id}-tags-hint`} className={inputClass} />
          <p id={`${id}-tags-hint`} className={hintClass}>Separate tags with commas: up to {TAGS_MAX}, each up to {TAG_MAX} characters.</p>
        </div>

        <div>
          <label htmlFor={`${id}-visibility`} className={labelClass}>Who can see it in Pandav</label>
          <select id={`${id}-visibility`} value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)} className={inputClass}>
            <option value="public">Everyone in Pandav</option>
            <option value="team">My team only</option>
            <option value="connections">My connections only</option>
          </select>
        </div>

        {backToApproval ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This post was approved. Saving changes sends it back for approval, and anything queued for it is cancelled.
          </p>
        ) : null}
        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <BusyButton type="submit" busy={saving} busyLabel="Saving…" className={primaryButton}>
            Save changes
          </BusyButton>
        </div>
      </form>
    </Modal>
  )
}
