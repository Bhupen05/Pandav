import ApprovalButtons from './ApprovalButtons'
import { PostImages } from './ImageGrid'
import PostLinks from './PostLinks'
import { formatDateTime, roleLabel, tone } from './format'
import { useShowMore } from './hooks'
import { authorOf, type PatchPost } from './postState'
import { Avatar, Badge, EmptyState, ErrorState, LoadingState, SectionCard, ShowMore } from './ui'
import type { SocialPost } from './types'

// Posts waiting for the caller's decision (admins, and team leaders for the
// people in their teams). A post leaves the list as soon as it is decided.
export default function PendingApprovals({
  posts,
  loaded,
  loading,
  error,
  onRetry,
  onChange,
}: {
  posts: SocialPost[]
  loaded: boolean
  loading: boolean
  error: string
  onRetry: () => void
  onChange: PatchPost
}) {
  const waiting = posts.filter((post) => post.approvalStatus === 'pending' && post.viewer?.canApprove !== false)
  const { limit, initial, more, less } = useShowMore(3)

  return (
    <SectionCard
      id="approvals"
      title="Waiting for your approval"
      description="Posts to LinkedIn or GitHub from your team need a decision before they go out."
      action={loaded ? <Badge className={waiting.length > 0 ? tone.warning : tone.neutral}>{waiting.length} waiting</Badge> : undefined}
    >
      {error ? <ErrorState message={error} onRetry={onRetry} retrying={loading} /> : null}
      {!loaded && loading ? <LoadingState label="Loading posts waiting for approval…" /> : null}
      {loaded && waiting.length === 0 ? <EmptyState>Nothing is waiting for you right now.</EmptyState> : null}

      {waiting.length > 0 ? (
        <ul className="space-y-3">
          {waiting.slice(0, limit).map((post) => {
            const author = authorOf(post)
            return (
              <li key={post._id} className="rounded-[24px] border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex items-start gap-3">
                  <Avatar person={author} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{author.name}</span>
                      {roleLabel(author.role) ? <Badge className={tone.neutral}>{roleLabel(author.role)}</Badge> : null}
                      {post.targets.linkedin ? <Badge className="bg-sky-100 text-sky-700">LinkedIn</Badge> : null}
                      {post.targets.github ? <Badge className="bg-slate-200 text-slate-700">GitHub</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(post.createdAt)}</p>
                  </div>
                </div>
                {post.title ? <h3 className="mt-3 break-words font-bold text-slate-950">{post.title}</h3> : null}
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{post.content}</p>
                <PostImages images={post.images} />
                <PostLinks links={post.mediaUrls} />
                {post.autoPublish ? (
                  <p className="mt-2 text-xs text-slate-600">
                    {post.publishAt ? `Goes to LinkedIn on ${formatDateTime(post.publishAt)}, once approved.` : 'Goes to LinkedIn as soon as it is approved.'}
                  </p>
                ) : null}
                <ApprovalButtons post={post} onChange={onChange} />
              </li>
            )
          })}
        </ul>
      ) : null}

      <ShowMore limit={limit} initial={initial} total={waiting.length} onMore={more} onLess={less} noun="more posts" />
    </SectionCard>
  )
}
