// Links on a post (`mediaUrls`, Backend/Doc/SocialHub.md): up to 10, each at
// most 2048 characters and a web address the server can parse. The server
// takes http and https; this app only adds https links, and only opens https
// links (older posts may hold http ones).

export const LINKS_MAX = 10
export const LINK_MAX_LENGTH = 2048

const parse = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// Why a link can't be added to `existing`, or '' when it can
export function linkProblem(value: string, existing: string[] = []): string {
  const link = value.trim()
  if (!link) return 'Enter a link.'
  if (link.length > LINK_MAX_LENGTH) return `A link can be at most ${LINK_MAX_LENGTH} characters.`
  const url = parse(link)
  if (!url) return 'Enter a full web address, like https://example.com/page.'
  if (url.protocol !== 'https:' || !/^https:\/\//i.test(link)) return 'A link has to start with “https://”.'
  if (existing.includes(link)) return 'That link is already added.'
  if (existing.length >= LINKS_MAX) return `A post can have up to ${LINKS_MAX} links.`
  return ''
}

// The links to send: those added, plus one typed but not added yet
export function linksToSend(links: string[], draft: string): { links: string[]; error?: string } {
  const pending = draft.trim()
  if (!pending) return { links }
  const problem = linkProblem(pending, links)
  return problem ? { links, error: `The link you typed isn’t added: ${problem}` } : { links: [...links, pending] }
}

// Only https links are opened from a post
export const isOpenableLink = (link: string) => parse(link)?.protocol === 'https:'

// What a link is called on screen: host and path, cut to `max` characters
export function linkLabel(link: string, max = 60) {
  const url = parse(link)
  const text = url ? `${url.host}${`${url.pathname}${url.search}`.replace(/\/$/, '')}` : link
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export const sameLinks = (a: string[], b: string[]) => a.length === b.length && a.every((link, index) => link === b[index])
