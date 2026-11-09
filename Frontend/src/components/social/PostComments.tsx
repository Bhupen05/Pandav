import { useId, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import { errorText, formatDateTime, idOf, personOf } from './format'
import { useBusy } from './hooks'
import { authorOf, type PatchPost } from './postState'
import { Avatar, BusyButton } from './ui'
import { inputClass, primaryButton } from './styles'
import type { Comment, SocialPost } from './types'

const COMMENT_MAX = 600
// The latest comments show; older ones open on request
const SHOWN = 3

export default function PostComments({ post, onChange }: { post: SocialPost; onChange: PatchPost }) {
  const { user, isAdmin } = useAuth()
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()
  const id = useId()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(SHOWN)

  const total = post.comments.length
  const shown = post.comments.slice(Math.max(0, total - limit))
  const hidden = total - shown.length
  const authorName = authorOf(post).name

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    await run('add', async () => {
      setError('')
      try {
        const response = await socialV2API.addComment(post._id, text)
        const comment = response?.data as Comment | undefined
        if (comment) onChange(post._id, (old) => ({ ...old, comments: [...old.comments, comment] }))
        setDraft('')
      } catch (commentError) {
        setError(errorText(commentError, 'Couldn’t add your comment. Try again.'))
      }
    })
  }

  const removeComment = async (comment: Comment) => {
    const sure = await confirm({
      title: 'Delete this comment?',
      message: 'It is removed for everyone. Comments can’t be edited, only deleted.',
      confirmLabel: 'Delete comment',
      danger: true,
    })
    if (!sure) return
    await run(`delete-${comment._id}`, async () => {
      try {
        await socialV2API.deleteComment(post._id, comment._id)
        onChange(post._id, (old) => ({ ...old, comments: old.comments.filter((item) => item._id !== comment._id) }))
        notify('Comment deleted.', 'success')
      } catch (deleteError) {
        notify(errorText(deleteError, 'Couldn’t delete the comment.'), 'error')
      }
    })
  }

  // The comment's author, the post's author or an admin may delete it
  const canDelete = (comment: Comment) =>
    isAdmin || idOf(comment.user) === user?._id || idOf(post.author) === user?._id

  return (
    <div className="mt-4">
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + SHOWN)}
          className="mb-2 rounded text-sm font-semibold text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          Show earlier comments ({hidden})
        </button>
      ) : total > SHOWN && limit > SHOWN ? (
        <button
          type="button"
          onClick={() => setLimit(SHOWN)}
          className="mb-2 rounded text-sm font-semibold text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          Show fewer comments
        </button>
      ) : null}

      {total > 0 ? (
        <ul aria-label="Comments" className="space-y-2">
          {shown.map((comment) => {
            const person = personOf(comment.user)
            return (
              <li key={comment._id} className="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                <Avatar person={person} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-slate-800">{person?.name ?? 'Former member'}</span>
                    {comment.createdAt ? <span className="text-xs text-slate-500">{formatDateTime(comment.createdAt)}</span> : null}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600">{comment.text}</p>
                </div>
                {canDelete(comment) ? (
                  <BusyButton
                    busy={busy[`delete-${comment._id}`]}
                    onClick={() => void removeComment(comment)}
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    aria-label={`Delete comment by ${person?.name ?? 'a former member'}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60"
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <form className="mt-3 flex flex-wrap items-start gap-2" onSubmit={addComment} noValidate>
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={`${id}-comment`} className="sr-only">Comment on {authorName}’s post</label>
          <input
            id={`${id}-comment`}
            value={draft}
            maxLength={COMMENT_MAX}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <BusyButton type="submit" busy={busy.add} busyLabel="Sending…" disabled={!draft.trim()} className={`${primaryButton} py-3`}>
          Comment
        </BusyButton>
        {error ? <p role="alert" className="basis-full text-sm text-rose-700">{error}</p> : null}
      </form>
    </div>
  )
}
