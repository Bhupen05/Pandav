import { useState } from 'react'
import { Heart, Pencil, Trash2 } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import ApprovalButtons from './ApprovalButtons'
import GitHubStatus from './GitHubStatus'
import { PostImages } from './ImageGrid'
import LinkedInStatus from './LinkedInStatus'
import PostComments from './PostComments'
import PostEditDialog from './PostEditDialog'
import PostLinks from './PostLinks'
import PostMarkers from './PostMarkers'
import { errorText, formatDateTime, idOf, roleLabel, tone, visibilityLabel } from './format'
import { useBusy } from './hooks'
import { authorOf, mergePost, withLinkedInState, type PatchPost } from './postState'
import { Avatar, Badge, BusyButton } from './ui'
import { dangerButton, secondaryButton, smallButton } from './styles'
import type { SocialPost } from './types'

// One post: who wrote it and what sets it apart, its text and images, where
// it went (LinkedIn, GitHub), and what the caller may do with it (approve,
// like, comment, edit, delete). Every action changes only this post.
export default function PostCard({
  post,
  highlighted = false,
  onChange,
  onRemoved,
}: {
  post: SocialPost
  // Opened from a link (/social?post=<id>)
  highlighted?: boolean
  onChange: PatchPost
  onRemoved: (postId: string) => void
}) {
  const { user, isAdmin } = useAuth()
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()
  const [editing, setEditing] = useState(false)

  const author = authorOf(post)
  const isAuthor = idOf(post.author) === user?._id
  const viewer = post.viewer
  const liked = Boolean(user && post.likes.includes(user._id))
  const needsApproval = author.role === 'user' || author.role === 'team_member'

  const toggleLike = () =>
    run('like', async () => {
      if (!user) return
      try {
        const response = await socialV2API.likePost(post._id)
        const nowLiked = Boolean(response?.data?.liked)
        onChange(post._id, (old) => ({
          ...old,
          likes: nowLiked ? [...new Set([...old.likes, user._id])] : old.likes.filter((likeId) => likeId !== user._id),
        }))
      } catch (error) {
        notify(errorText(error, 'Couldn’t update your like. Try again.'), 'error')
      }
    })

  const remove = async () => {
    const byAdmin = !isAuthor
    const sure = await confirm({
      title: 'Delete this post?',
      message: `${byAdmin ? `${author.name} is told. ` : ''}Its comments and likes go too. Copies already on LinkedIn or GitHub stay there.`,
      confirmLabel: 'Delete post',
      danger: true,
    })
    if (!sure) return
    await run('delete', async () => {
      try {
        await socialV2API.deletePost(post._id)
        onRemoved(post._id)
        notify('Post deleted.', 'success')
      } catch (error) {
        notify(errorText(error, 'Couldn’t delete the post. Try again.'), 'error')
      }
    })
  }

  return (
    <article
      id={`post-${post._id}`}
      tabIndex={-1}
      data-highlighted={highlighted || undefined}
      aria-label={`Post by ${author.name}`}
      className={`scroll-mt-24 rounded-[26px] border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4 outline-none transition sm:p-5 ${
        highlighted ? 'border-sky-400 ring-4 ring-sky-300/50' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar person={author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-slate-950">{author.name}</h3>
            {roleLabel(author.role) ? <Badge className={tone.neutral}>{roleLabel(author.role)}</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(post.createdAt)}
            {post.editedAt ? ` · edited ${formatDateTime(post.editedAt)}` : ''}
          </p>
        </div>
      </div>

      <PostMarkers post={post} canSeeModeration={isAdmin || isAuthor} />

      {post.title ? <h4 className="mt-4 break-words text-lg font-extrabold text-slate-950">{post.title}</h4> : null}
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{post.content}</p>
      <PostImages images={post.images} />
      <PostLinks links={post.mediaUrls} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge className={tone.info}>{visibilityLabel[post.visibility]}</Badge>
        {post.targets.linkedin ? <Badge className="bg-sky-100 text-sky-700">LinkedIn</Badge> : null}
        {post.targets.github ? <Badge className="bg-slate-200 text-slate-700">GitHub</Badge> : null}
        {post.sourceTask ? <Badge className={tone.success} title={post.sourceTask.title}>From a finished to-do</Badge> : null}
        {post.tags?.map((tag) => (
          <Badge key={tag} className={tone.neutral}>#{tag}</Badge>
        ))}
      </div>

      <LinkedInStatus
        post={post}
        canPublish={viewer?.canPublish ?? false}
        onChange={(postId, state) => onChange(postId, withLinkedInState(state))}
      />
      <GitHubStatus post={post} canPublish={viewer?.canPublish ?? false} onChange={onChange} />

      {viewer?.canApprove ? <ApprovalButtons post={post} onChange={onChange} /> : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <BusyButton
          busy={busy.like}
          onClick={() => void toggleLike()}
          aria-pressed={liked}
          icon={<Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} aria-hidden="true" />}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60 ${
            liked ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Like · {post.likes.length}
        </BusyButton>
        <span className="text-sm text-slate-500">
          {post.comments.length} {post.comments.length === 1 ? 'comment' : 'comments'}
        </span>

        <div className="ml-auto flex flex-wrap gap-2">
          {viewer?.canEdit ? (
            <button type="button" onClick={() => setEditing(true)} className={`${secondaryButton} ${smallButton}`}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
          ) : null}
          {viewer?.canDelete ? (
            <BusyButton
              busy={busy.delete}
              busyLabel="Deleting…"
              onClick={() => void remove()}
              icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              className={`${dangerButton} ${smallButton}`}
            >
              Delete
            </BusyButton>
          ) : null}
        </div>
      </div>

      <PostComments post={post} onChange={onChange} />

      {editing ? (
        <PostEditDialog
          post={post}
          needsApproval={needsApproval}
          onClose={() => setEditing(false)}
          onSaved={(fresh, message) => {
            onChange(post._id, (old) => mergePost(old, fresh))
            setEditing(false)
            notify(message || 'Post updated.', 'success')
          }}
        />
      ) : null}
    </article>
  )
}
