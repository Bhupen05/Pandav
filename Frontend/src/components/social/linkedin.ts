import { socialV2API } from '../../api/socialV2API'
import type { Integration, Provider } from './types'

// What a post says on LinkedIn, as the server builds it
// (Backend/src/utils/linkedinText.js): keep the two the same

// The most a LinkedIn post's text may hold
export const LINKEDIN_TEXT_MAX = 3000

// A tag as a LinkedIn hashtag: letters, digits and underscores only
export const hashtagOf = (tag: string) => tag.normalize('NFKC').replace(/[^\p{L}\p{N}_]/gu, '')

const HASHTAG = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu

// The title on its own line, the post, then the tags as hashtags (leaving
// out tags the post already uses as hashtags)
export function linkedInText({ title, content, tags }: { title?: string; content: string; tags: string[] }) {
  const body = content.trim()
  const used = new Set([...body.matchAll(HASHTAG)].map((match) => match[2].toLowerCase()))
  const hashtags: string[] = []
  for (const tag of tags) {
    const hashtag = hashtagOf(tag)
    if (!hashtag || used.has(hashtag.toLowerCase())) continue
    used.add(hashtag.toLowerCase())
    hashtags.push(`#${hashtag}`)
  }
  return [title?.trim() ?? '', body, hashtags.join(' ')].filter(Boolean).join('\n\n')
}

// Images (Backend/src/models/SocialImageV2.js)
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif']
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGES_PER_POST = 4
export const ALT_TEXT_MAX = 300

// A file as base64, without the data: prefix
export const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*;base64,/, ''))
    reader.onerror = () => reject(new Error('The file couldn’t be read'))
    reader.readAsDataURL(file)
  })

// The linked account, when it can post right now
export const usableAccount = (integration?: Integration | null) =>
  integration && integration.isConnected && !integration.needsRelink ? integration : null

// The name and photo LinkedIn knows the member by
export const accountName = (integration?: Integration | null) =>
  integration?.metadata?.name ||
  [integration?.metadata?.localizedFirstName, integration?.metadata?.localizedLastName].filter(Boolean).join(' ') ||
  integration?.accountHandle ||
  ''

// Where to come back to after the provider's consent page
const RETURN_KEY = 'pandav:oauth-return'

export function rememberReturn(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, path)
  } catch {
    // Without storage the callback page returns to Integrations
  }
}

export function takeReturn(fallback: string) {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    // Only a path in this app
    return path && path.startsWith('/') && !path.startsWith('//') ? path : fallback
  } catch {
    return fallback
  }
}

// Sends the browser to the provider's consent page. The provider sends it back
// to /integrations/<provider>/callback (OAuthCallback.tsx), which finishes
// linking and returns to the page it left from.
export async function startConnect(provider: Provider) {
  const response = await socialV2API.startProviderOAuth(provider)
  const authUrl: string | undefined = response?.data?.authUrl
  if (!authUrl) throw new Error('The server sent no sign-in page')
  // Trying again from the callback page keeps the page it started from
  if (!/^\/integrations\/[^/]+\/callback/.test(window.location.pathname)) {
    rememberReturn(`${window.location.pathname}${window.location.search}`)
  }
  window.location.assign(authUrl)
}
