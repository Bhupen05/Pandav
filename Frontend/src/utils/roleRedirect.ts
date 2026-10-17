export type AppRole = 'admin' | 'team_leader' | 'team_member' | 'user' | string

export const getDashboardRouteForRole = (role?: AppRole | null) => {
  if (role === 'admin') return '/admin'
  if (role === 'team_leader') return '/teams'
  if (role === 'team_member') return '/team-member'
  return '/user'
}
