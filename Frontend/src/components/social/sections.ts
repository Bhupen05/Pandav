export type SocialSection = 'feed' | 'todo' | 'network' | 'integrations' | 'publishing' | 'moderation'

export const SECTIONS: Array<{
  key: SocialSection
  to: string
  label: string
  title: string
  description: string
  adminOnly?: boolean
}> = [
  {
    key: 'feed',
    to: '/social',
    label: 'Feed',
    title: 'Feed',
    description: 'Share progress with your colleagues, and on LinkedIn or GitHub.',
  },
  {
    key: 'todo',
    to: '/todo',
    label: 'My to-dos',
    title: 'My to-dos',
    description: 'A private list for yourself, with the option to share what you finish.',
  },
  {
    key: 'network',
    to: '/network',
    label: 'Network',
    title: 'Network',
    description: 'Find people, answer requests and keep track of your connections.',
  },
  {
    key: 'integrations',
    to: '/integrations',
    label: 'Integrations',
    title: 'Integrations',
    description: 'Connect your LinkedIn and GitHub accounts.',
  },
  {
    key: 'publishing',
    to: '/publish-jobs',
    label: 'Publishing',
    title: 'Publishing',
    description: 'Follow posts on their way to LinkedIn and GitHub.',
  },
  {
    key: 'moderation',
    to: '/admin/moderation',
    label: 'Moderation',
    title: 'Moderation',
    description: 'Review posts and reported messages.',
    adminOnly: true,
  },
]

// The view an address opens (the feed for anything else)
export const sectionOf = (pathname: string): SocialSection => {
  if (pathname.startsWith('/todo')) return 'todo'
  if (pathname.startsWith('/network')) return 'network'
  if (pathname.startsWith('/integrations')) return 'integrations'
  if (pathname.startsWith('/publish-jobs')) return 'publishing'
  if (pathname.startsWith('/admin/moderation')) return 'moderation'
  return 'feed'
}
