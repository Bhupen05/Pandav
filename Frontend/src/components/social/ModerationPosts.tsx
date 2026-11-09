import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { socialV2API, type ModerationAction } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import {
  approvalLabel,
  approvalTone,
  excerpt,
  formatDateTime,
  listOf,
  moderationLabel,
  moderationTone,
  personOf,
  roleLabel,
  tone,
  visibilityLabel,
} from './format'
import { useResource, useShowMore } from './hooks'
import ModerationDialog from './ModerationDialog'
import { moderationActionInfo, moderationActionsFor } from './moderation'
import { mergePost, authorOf } from './postState'
import { Avatar, Badge, EmptyState, ErrorState, LoadingState, SectionCard, ShowMore } from './ui'
import { dangerButton, inputClass, labelClass, linkButton, secondaryButton, smallButton } from './styles'
import type { ModerationStatus, Person, SocialPost } from './types'

const STATUS_FILTERS: Array<['all' | ModerationStatus, string]> = [
  ['all', 'All posts'],
  ['clean', moderationLabel.clean],
  ['flagged', moderationLabel.flagged],
  ['hidden', moderationLabel.hidden],
  ['removed', moderationLabel.removed],
]

function PostRow({
  post,
  onAction,
}: {
  post: SocialPost
  onAction: (post: SocialPost, action: ModerationAction) => void
}) {
  const [open, setOpen] = useState(false)
  const author = authorOf(post)
  const moderator = personOf(post.moderatedBy)
  const text = post.content
  const long = text.length > 220

  return (
    <li id={`moderate-${post._id}`} className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Avatar person={author} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{author.name}</span>
            {roleLabel(author.role) ? <Badge className={tone.neutral}>{roleLabel(author.role)}</Badge> : null}
            <Badge className={moderationTone[post.moderationStatus]}>{moderationLabel[post.moderationStatus]}</Badge>
          </div>
          <p className="mt-0.5 break-all text-xs text-slate-500">
            {[author.email, formatDateTime(post.createdAt)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {post.title ? <h3 className="mt-3 break-words font-bold text-slate-950">{post.title}</h3> : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{open || !long ? text : excerpt(text, 220)}</p>
      {long ? (
        <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className={`${linkButton} mt-1 text-xs`}>
          {open ? 'Show less' : 'Read the whole post'}
        </button>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge className={tone.info}>{visibilityLabel[post.visibility]}</Badge>
        {post.approvalStatus !== 'none' ? <Badge className={approvalTone[post.approvalStatus]}>{approvalLabel[post.approvalStatus]}</Badge> : null}
        {post.targets.linkedin ? <Badge className="bg-sky-100 text-sky-700">LinkedIn</Badge> : null}
        {post.targets.github ? <Badge className="bg-slate-200 text-slate-700">GitHub</Badge> : null}
        {!post.targets.pandav ? <Badge className={tone.neutral}>Not in the feed</Badge> : null}
      </div>

      {post.moderationStatus !== 'clean' || post.moderationReason ? (
        <p className="mt-3 break-words rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {post.moderationReason ? <><span className="font-semibold">Reason:</span> {post.moderationReason}. </> : 'No reason given. '}
          <span className="text-slate-500">
            {moderator ? `${moderationLabel[post.moderationStatus]} by ${moderator.name}` : moderationLabel[post.moderationStatus]}
            {post.moderatedAt ? ` on ${formatDateTime(post.moderatedAt)}` : ''}.
          </span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {moderationActionsFor[post.moderationStatus].map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAction(post, action)}
            aria-label={`${moderationActionInfo[action].label} the post by ${author.name}`}
            className={`${moderationActionInfo[action].danger ? dangerButton : secondaryButton} ${smallButton}`}
          >
            {moderationActionInfo[action].label}
          </button>
        ))}
        <Link to={`/social?post=${post._id}`} className={`${linkButton} ml-auto text-xs`}>
          Open in the feed
        </Link>
      </div>
    </li>
  )
}

// Every post, with its moderation state: filter by state and author, and move
// a post along (flag, hide, remove and back) with a reason
export default function ModerationPosts() {
  const { user } = useAuth()
  const { notify } = useFeedback()
  const id = useId()
  const [status, setStatus] = useState<'all' | ModerationStatus>('all')
  const [owner, setOwner] = useState('')
  // Authors seen so far, so the author filter keeps its choices while it filters
  const [authors, setAuthors] = useState<Record<string, Person>>({})
  const [acting, setActing] = useState<{ post: SocialPost; action: ModerationAction } | null>(null)
  const { limit, initial, more, less } = useShowMore(6)

  const posts = useResource<SocialPost[]>(
    async () => {
      const list = listOf<SocialPost>((await socialV2API.getModerationPosts(status, owner))?.data)
      setAuthors((current) => {
        const next = { ...current }
        for (const post of list) {
          const author = personOf(post.author)
          if (author) next[author._id] = author
        }
        return next
      })
      return list
    },
    'Couldn’t load the posts.',
    [],
    { key: `${status}|${owner}` },
  )
  const { setData } = posts

  const authorList = Object.values(authors).sort((a, b) => a.name.localeCompare(b.name))

  // The post as the server has it after the action. A filtered list drops a
  // post that no longer matches.
  function applied(post: SocialPost, fresh: Partial<SocialPost>, action: ModerationAction) {
    const moderator = user ? { _id: user._id, name: user.name, email: user.email, role: user.role } : null
    const next = { ...mergePost(post, fresh), moderatedBy: moderator ?? post.moderatedBy }
    setData((list) =>
      list.flatMap((item) => {
        if (item._id !== post._id) return [item]
        return status !== 'all' && next.moderationStatus !== status ? [] : [next]
      }),
    )
    setActing(null)
    notify(moderationActionInfo[action].done, 'success')
  }

  return (
    <SectionCard
      id="moderation-posts"
      title="Posts"
      description="Every post in Pandav, whoever can see it. Flag, hide or remove a post, and bring it back."
      action={posts.loaded ? <Badge className={tone.neutral}>{posts.data.length >= 200 ? '200 newest' : `${posts.data.length} shown`}</Badge> : undefined}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-status`} className={labelClass}>Status</label>
          <select id={`${id}-status`} value={status} onChange={(event) => setStatus(event.target.value as 'all' | ModerationStatus)} className={inputClass}>
            {STATUS_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-author`} className={labelClass}>Author</label>
          <select id={`${id}-author`} value={owner} onChange={(event) => setOwner(event.target.value)} className={inputClass}>
            <option value="">Everyone</option>
            {authorList.map((author) => (
              <option key={author._id} value={author._id}>{author.name}</option>
            ))}
          </select>
        </div>
      </div>

      {posts.error ? <div className="mb-4"><ErrorState message={posts.error} onRetry={() => void posts.reload()} retrying={posts.loading} /></div> : null}
      {!posts.loaded && posts.loading ? <LoadingState label="Loading posts…" /> : null}
      {posts.loaded && posts.data.length === 0 ? <EmptyState>No posts match these filters.</EmptyState> : null}

      <ul aria-busy={posts.loading || undefined} className={`space-y-3 transition-opacity ${posts.loading && posts.loaded ? "opacity-60" : ""}`}>
        {posts.data.slice(0, limit).map((post) => (
          <PostRow key={post._id} post={post} onAction={(target, action) => setActing({ post: target, action })} />
        ))}
      </ul>
      <ShowMore limit={limit} initial={initial} total={posts.data.length} onMore={more} onLess={less} noun="more posts" />

      {acting ? (
        <ModerationDialog
          post={acting.post}
          authorName={authorOf(acting.post).name}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={(fresh) => applied(acting.post, fresh, acting.action)}
        />
      ) : null}
    </SectionCard>
  )
}
