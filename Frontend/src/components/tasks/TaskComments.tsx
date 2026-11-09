import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { taskAPI } from '../../api/taskAPI'
import { getErrorMessage } from '../../api/axios'
import { useFeedback } from '../../context/useFeedback'
import { formatDateTime, personId, personName } from './taskFormat'
import type { TaskComment } from './types'
import { InlineError } from './ui'

const MAX_COMMENT = 2000

type Props = {
  taskId: string
  viewerId: string
  // Managers and admins may delete anyone's comment
  canModerate: boolean
  report: (message: string, tone: 'success' | 'error') => void
  // Called after a change, so the activity history can refresh
  onActivity: () => void
}

// The discussion on a task: newest 50 comments, older ones on request
export default function TaskComments({ taskId, viewerId, canModerate, report, onActivity }: Props) {
  const { confirm } = useFeedback()
  const [comments, setComments] = useState<TaskComment[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const response = await taskAPI.getComments(taskId)
      if (id !== requestId.current) return
      setComments(response.data || [])
      setHasMore(Boolean(response.hasMore))
    } catch (failure) {
      if (id === requestId.current) setError(getErrorMessage(failure, "Couldn't load the comments."))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    load()
  }, [load])

  const loadOlder = async () => {
    if (loadingOlder || comments.length === 0) return
    setLoadingOlder(true)
    try {
      const response = await taskAPI.getComments(taskId, comments[0]._id)
      setComments((current) => [...(response.data || []), ...current])
      setHasMore(Boolean(response.hasMore))
    } catch (failure) {
      report(getErrorMessage(failure, "Couldn't load older comments."), 'error')
    } finally {
      setLoadingOlder(false)
    }
  }

  const post = async (event?: FormEvent) => {
    event?.preventDefault()
    const body = text.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      const response = await taskAPI.addComment(taskId, body)
      setComments((current) => [...current, response.data])
      setText('')
      onActivity()
    } catch (failure) {
      report(getErrorMessage(failure, "Couldn't post the comment."), 'error')
    } finally {
      setPosting(false)
    }
  }

  const saveEdit = async (comment: TaskComment) => {
    const body = editText.trim()
    if (!body || savingEdit) return
    setSavingEdit(true)
    try {
      const response = await taskAPI.editComment(taskId, comment._id, body)
      setComments((current) => current.map((entry) => (entry._id === comment._id ? response.data : entry)))
      setEditingId(null)
    } catch (failure) {
      report(getErrorMessage(failure, "Couldn't save the comment."), 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  const remove = async (comment: TaskComment) => {
    const ok = await confirm({
      title: 'Delete this comment?',
      message: 'Its words are removed for everyone. This can\'t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok || busyId) return
    setBusyId(comment._id)
    try {
      const response = await taskAPI.deleteComment(taskId, comment._id)
      setComments((current) => current.map((entry) => (entry._id === comment._id ? response.data : entry)))
      onActivity()
    } catch (failure) {
      report(getErrorMessage(failure, "Couldn't delete the comment."), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="task-comments-heading">
      <h3 id="task-comments-heading" className="mb-3 text-sm font-semibold text-neutral-900">Comments</h3>

      {loading && comments.length === 0 ? (
        <p role="status" className="text-sm text-neutral-500">Loading comments…</p>
      ) : error ? (
        <InlineError title="Comments didn't load" message={error} onRetry={load} />
      ) : (
        <>
          {hasMore && (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="mb-3 text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Show older comments'}
            </button>
          )}
          {comments.length === 0 ? (
            <p className="text-sm text-neutral-500">No comments yet. Start the conversation below.</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((comment) => {
                const own = personId(comment.author) === viewerId
                const editing = editingId === comment._id
                return (
                  <li key={comment._id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-sm font-medium text-neutral-900">{personName(comment.author, 'Deleted user')}</p>
                      <p className="text-xs text-neutral-500">
                        {formatDateTime(comment.createdAt)}
                        {comment.editedAt && !comment.deleted ? ' · edited' : ''}
                      </p>
                    </div>
                    {comment.deleted ? (
                      <p className="mt-1 text-sm italic text-neutral-500">Comment deleted</p>
                    ) : editing ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          saveEdit(comment)
                        }}
                        className="mt-2"
                      >
                        <label htmlFor={`edit-${comment._id}`} className="sr-only">Edit your comment</label>
                        <textarea
                          id={`edit-${comment._id}`}
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              saveEdit(comment)
                            }
                          }}
                          maxLength={MAX_COMMENT}
                          rows={3}
                          autoFocus
                          className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="submit"
                            disabled={savingEdit || !editText.trim()}
                            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit}
                            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-neutral-800">{comment.text}</p>
                    )}
                    {!comment.deleted && !editing && (own || canModerate) && (
                      <div className="mt-2 flex gap-3 text-xs">
                        {own && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(comment._id)
                              setEditText(comment.text)
                            }}
                            aria-label={`Edit comment from ${formatDateTime(comment.createdAt)}`}
                            className="font-medium text-neutral-600 hover:text-neutral-900 hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(comment)}
                          disabled={busyId === comment._id}
                          aria-label={`Delete comment from ${formatDateTime(comment.createdAt)}`}
                          className="font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <form onSubmit={post} className="mt-4">
        <label htmlFor="task-comment-input" className="mb-1.5 block text-sm font-medium text-neutral-700">Add a comment</label>
        <textarea
          id="task-comment-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter starts a new line
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              post()
            }
          }}
          maxLength={MAX_COMMENT}
          rows={3}
          placeholder="Write a comment. Enter sends, Shift+Enter adds a line."
          className="w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-neutral-500">{text.length}/{MAX_COMMENT}</span>
          <button
            type="submit"
            disabled={posting || !text.trim()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </form>
    </section>
  )
}
