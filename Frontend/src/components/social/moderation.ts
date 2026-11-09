import type { ModerationAction } from '../../api/socialV2API'
import type { ModerationStatus } from './types'

// What an admin may do to a post in each state (Backend/Doc/SocialHub.md,
// "Moderation"): only these are offered, so the server never has to refuse one
export const moderationActionsFor: Record<ModerationStatus, ModerationAction[]> = {
  clean: ['flag', 'hide', 'remove'],
  flagged: ['unflag', 'hide', 'remove'],
  hidden: ['unhide', 'remove'],
  removed: ['restore'],
}

export const moderationActionInfo: Record<
  ModerationAction,
  { label: string; title: string; explain: string; done: string; danger?: boolean }
> = {
  flag: {
    label: 'Flag',
    title: 'Flag this post?',
    explain: 'Flagging marks the post for review. Everyone who may see it still can. The author is told.',
    done: 'Post flagged.',
  },
  unflag: {
    label: 'Unflag',
    title: 'Unflag this post?',
    explain: 'The post goes back to normal. The author isn’t told.',
    done: 'Post unflagged.',
  },
  hide: {
    label: 'Hide',
    title: 'Hide this post?',
    explain: 'Only the author and admins can see a hidden post, and it can’t be published. The author is told, with your reason.',
    done: 'Post hidden.',
    danger: true,
  },
  unhide: {
    label: 'Unhide',
    title: 'Unhide this post?',
    explain: 'Everyone who may see the post sees it again. The author is told.',
    done: 'Post unhidden.',
  },
  remove: {
    label: 'Remove',
    title: 'Remove this post?',
    explain: 'A removed post is out of every feed and its author can’t edit it. You can restore it later. The author is told, with your reason.',
    done: 'Post removed.',
    danger: true,
  },
  restore: {
    label: 'Restore',
    title: 'Restore this post?',
    explain: 'The post comes back as a normal post. The author is told.',
    done: 'Post restored.',
  },
}
