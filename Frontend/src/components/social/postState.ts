import { personOf } from './format'
import type { LinkedInState } from './LinkedInStatus'
import type { Person, SocialPost } from './types'

// How a view changes one post it shows (every list holding it applies it)
export type PostUpdate = (post: SocialPost) => SocialPost
export type PatchPost = (postId: string, update: PostUpdate) => void

// A post as the server sent it after an action, laid over what is shown now:
// some answers leave out what the page already knows (the author's email, the
// comment list, what the caller may do)
export const mergePost = (old: SocialPost, fresh: Partial<SocialPost>): SocialPost => {
  const author = personOf(fresh.author)
  return {
    ...old,
    ...fresh,
    author: author ? { ...personOf(old.author), ...author } : old.author,
    comments: fresh.comments ?? old.comments,
    images: fresh.images ?? old.images,
    viewer: fresh.viewer ?? old.viewer,
  }
}

// A post's LinkedIn state after posting it, scheduling it or cancelling that
export const withLinkedInState = (state: LinkedInState): PostUpdate => (post) => ({ ...post, ...state })

// A post whose author the server left unpopulated still shows a name
export const authorOf = (post: SocialPost): Person => personOf(post.author) ?? { _id: '', name: 'Former member' }
