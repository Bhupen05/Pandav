// Limits of a post's fields (Backend/Doc/SocialHub.md, POST /posts)

export const TITLE_MAX = 180
export const CONTENT_MAX = 5000
export const TAGS_MAX = 20
export const TAG_MAX = 40

// "a, b ,c" -> ['a', 'b', 'c'], or an error to show
export function parseTags(raw: string): { tags: string[]; error?: string } {
  const tags = [...new Set(raw.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))]
  if (tags.length > TAGS_MAX) return { tags, error: `Use at most ${TAGS_MAX} tags.` }
  if (tags.some((tag) => tag.length > TAG_MAX)) return { tags, error: `Each tag can be at most ${TAG_MAX} characters.` }
  return { tags }
}
