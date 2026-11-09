export type AppRole = 'admin' | 'team_leader' | 'team_member' | 'user' | string

export const getDashboardRouteForRole = (role?: AppRole | null) => {
  if (role === 'admin') return '/admin'
  if (role === 'team_leader') return '/teams'
  if (role === 'team_member') return '/team-member'
  return '/user'
}

// Where someone who must choose a new password has to go first
export const CHANGE_PASSWORD_ROUTE = '/profile?tab=security'

// The words to show for a role, never the stored value
export const getRoleLabel = (role?: AppRole | null) => {
  if (role === 'admin') return 'Admin'
  if (role === 'team_leader') return 'Team leader'
  if (role === 'team_member') return 'Team member'
  return 'User'
}

// A path inside this app that is safe to navigate to, or undefined. Rejects
// other sites ("https://...", "//host") that a link or saved value could hold.
export const internalPath = (value?: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : undefined
