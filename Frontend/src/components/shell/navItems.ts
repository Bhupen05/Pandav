import {
  BarChart3,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  House,
  ListChecks,
  Mail,
  MessageSquare,
  ScrollText,
  Share2,
  ShieldAlert,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { getDashboardRouteForRole } from '../../utils/roleRedirect'

// Which count a link shows next to its label
export type BadgeKey = 'chat' | 'invites' | 'approvals' | 'messages'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  // Paths that belong to this link's section. Everything under them counts too,
  // except for the home link, which only matches its own page.
  match: string[]
  exact?: boolean
  badge?: BadgeKey
}

// What the badge says to people who can't see it
export const BADGE_WORDS: Record<BadgeKey, string> = {
  chat: 'unread',
  invites: 'pending',
  approvals: 'waiting',
  messages: 'new',
}

// The links of the signed-in navigation for a role, in order
export function buildNavItems(role?: string | null): NavItem[] {
  const home = getDashboardRouteForRole(role)
  const isAdmin = role === 'admin'
  const isLeader = role === 'team_leader'

  const homeItem: NavItem = { to: home, label: 'Home', icon: House, match: [home], exact: true }
  const approvals: NavItem = { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, match: ['/approvals'], badge: 'approvals' }
  const tasks: NavItem = { to: '/tasks', label: 'Tasks', icon: ListChecks, match: ['/tasks'] }
  const chat: NavItem = { to: '/chat', label: 'Chat', icon: MessageSquare, match: ['/chat'], badge: 'chat' }
  const social: NavItem = {
    to: '/social',
    label: 'Social Hub',
    icon: Share2,
    match: ['/social', '/todo', '/network', '/integrations', '/publish-jobs'],
  }

  if (isAdmin) {
    return [
      homeItem,
      approvals,
      { to: '/admin/users', label: 'People', icon: UserCog, match: ['/admin/users', '/admin/userview'] },
      { to: '/admin/teams', label: 'Teams', icon: Building2, match: ['/admin/teams'] },
      tasks,
      { to: '/admin/attendance', label: 'Attendance', icon: CalendarCheck, match: ['/admin/attendance'] },
      { to: '/admin/messages', label: 'Messages', icon: Mail, match: ['/admin/messages'], badge: 'messages' },
      { to: '/admin/moderation', label: 'Moderation', icon: ShieldAlert, match: ['/admin/moderation'] },
      chat,
      social,
      { to: '/admin/audit', label: 'Audit log', icon: ScrollText, match: ['/admin/audit'] },
      { to: '/admin/reports', label: 'Reports', icon: BarChart3, match: ['/admin/reports'] },
    ]
  }

  // Team members have one team page; everyone else starts, joins or leads one at /teams
  const team: NavItem = {
    to: role === 'team_member' ? '/team-member' : '/teams',
    label: 'Team',
    icon: Users,
    match: role === 'team_member' ? ['/team-member'] : ['/teams', '/team'],
    badge: 'invites',
  }
  const attendance: NavItem = { to: '/attendance', label: 'Attendance', icon: CalendarCheck, match: ['/attendance'] }

  return [homeItem, ...(isLeader ? [approvals] : []), tasks, attendance, chat, social, team]
}

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`)

// The one link that marks where the user is. The first match wins, so on a
// page that two links lead to (a leader's home is also their team page) only
// the first, Home, is highlighted.
export function activeNavIndex(items: NavItem[], pathname: string) {
  return items.findIndex((item) => item.match.some((base) => (item.exact ? pathname === base : within(pathname, base))))
}
