import type { AdminUser } from '../../api/adminAPI'
import { Badge } from './ui'
import { roleLabel, roleTone } from './labels'

// Role and account state as words, not colour alone
export function PersonBadges({ user, extra = false }: { user: AdminUser; extra?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={roleTone(user.role)}>{roleLabel(user.role)}</Badge>
      {user.deletedAt ? (
        <Badge tone="neutral">Deleted</Badge>
      ) : (
        <Badge tone={user.isActive ? 'emerald' : 'red'}>{user.isActive ? 'Active' : 'Inactive'}</Badge>
      )}
      {extra && user.twoFactor?.enabled && <Badge tone="sky">Two-step sign-in on</Badge>}
      {extra && user.mustChangePassword && <Badge tone="amber">Must choose a new password</Badge>}
      {extra && user.emailVerified === false && <Badge tone="neutral">Email not confirmed</Badge>}
    </div>
  )
}
