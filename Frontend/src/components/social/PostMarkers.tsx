import { moderationTone, tone } from './format'
import { Badge } from './ui'
import type { SocialPost } from './types'

type Marker = { key: string; label: string; className: string; note: string }

// What sets a post apart from an ordinary one, for the people who can see it
// (the author and admins, for every case but "flagged" and "reported"): the
// feed hides these posts from everyone else
function postMarkers(post: SocialPost, canSeeModeration: boolean): Marker[] {
  const markers: Marker[] = []
  const reason = post.moderationReason ? ` Reason: ${post.moderationReason}` : ''

  if (post.approvalStatus === 'pending') {
    markers.push({
      key: 'pending',
      label: 'Awaiting approval',
      className: tone.warning,
      note: 'Only the author and admins can see this post until it is approved.',
    })
  }
  if (post.approvalStatus === 'rejected') {
    markers.push({
      key: 'rejected',
      label: 'Not approved',
      className: tone.danger,
      note: 'It can’t be published. Only the author and admins can see it.',
    })
  }
  if (post.moderationStatus === 'hidden') {
    markers.push({
      key: 'hidden',
      label: 'Hidden by an admin',
      className: moderationTone.hidden,
      note: `Only the author and admins can see it.${reason}`,
    })
  }
  if (post.moderationStatus === 'removed') {
    markers.push({
      key: 'removed',
      label: 'Removed by an admin',
      className: moderationTone.removed,
      note: `It is out of everyone’s feed.${reason}`,
    })
  }
  if (post.moderationStatus === 'flagged' && canSeeModeration) {
    markers.push({
      key: 'flagged',
      label: 'Flagged by an admin',
      className: moderationTone.flagged,
      note: `Everyone who may see it still can.${reason}`,
    })
  }
  if (!post.targets.pandav) {
    markers.push({
      key: 'external',
      label: 'Not in the feed',
      className: tone.neutral,
      note: 'This post is only for LinkedIn or GitHub. Only the author and admins see it here.',
    })
  }
  return markers
}

export default function PostMarkers({ post, canSeeModeration }: { post: SocialPost; canSeeModeration: boolean }) {
  const markers = postMarkers(post, canSeeModeration)
  if (markers.length === 0) return null
  return (
    <ul aria-label="Post status" className="mt-4 space-y-2">
      {markers.map((marker) => (
        <li key={marker.key} className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
          <Badge className={marker.className}>{marker.label}</Badge>
          <span className="min-w-0 break-words">{marker.note}</span>
        </li>
      ))}
    </ul>
  )
}
