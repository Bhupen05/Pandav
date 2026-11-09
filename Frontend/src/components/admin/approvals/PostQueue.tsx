import type { SocialPostRow } from '../../../api/adminAPI'
import { Badge, CollapsibleText, Loadable } from '../ui'
import { formatDateTime } from '../format'
import { roleLabel } from '../labels'
import { BTN } from '../buttons'
import type { useReview } from '../useReview'
import type { useResource } from '../useResource'
import { Meta, QueueItem } from './parts'

type Review = ReturnType<typeof useReview>

const targetNames = (post: SocialPostRow) =>
  [post.targets?.pandav && 'Pandav feed', post.targets?.linkedin && 'LinkedIn', post.targets?.github && 'GitHub'].filter(Boolean) as string[]

export function PostQueue({ resource, review }: { resource: ReturnType<typeof useResource<SocialPostRow[]>>; review: Review }) {
  return (
    <Loadable
      data={resource.data}
      error={resource.error}
      loading={resource.loading}
      onRetry={resource.reload}
      errorFallback="Could not load the posts waiting for approval"
      isEmpty={(data) => data.length === 0}
      empty="No posts are waiting for approval."
    >
      {(posts) => (
        <ul className="space-y-3">
          {posts.map((post) => {
            const busy = review.isBusy(`post:${post._id}`)
            const label = post.title || `${post.author?.name ?? 'Unknown'}'s post`
            return (
              <QueueItem
                key={post._id}
                actions={
                  <>
                    <button type="button" disabled={busy} onClick={() => review.approvePost(post)} aria-label={`Approve ${label}`} className={`${BTN.sm} ${BTN.success}`}>
                      Approve
                    </button>
                    <button type="button" disabled={busy} onClick={() => review.rejectPost(post)} aria-label={`Reject ${label}`} className={`${BTN.sm} ${BTN.danger}`}>
                      Reject
                    </button>
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-neutral-900">{post.author?.name ?? 'Unknown author'}</p>
                  {post.author?.role && <span className="text-xs text-neutral-500">{roleLabel(post.author.role)}</span>}
                  {targetNames(post).map((name) => (
                    <Badge key={name} tone={name === 'Pandav feed' ? 'neutral' : 'blue'}>
                      {name}
                    </Badge>
                  ))}
                </div>
                <Meta>{formatDateTime(post.createdAt)}</Meta>
                {post.title && <p className="mt-2 font-medium break-words text-neutral-900">{post.title}</p>}
                <CollapsibleText text={post.content} className="mt-1" />
              </QueueItem>
            )
          })}
        </ul>
      )}
    </Loadable>
  )
}
