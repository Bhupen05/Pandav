import { Link } from 'react-router-dom'
import type { AdminUser } from '../../api/adminAPI'
import type { PersonActions } from './usePersonActions'
import { BTN } from './buttons'

// The buttons for one person. Admins can't disable, demote or delete
// themselves, and team roles come from the team, so those buttons are left
// out where the server would refuse them.
export function PersonActionButtons({
  user,
  actions,
  selfId,
  open = false,
}: {
  user: AdminUser
  actions: PersonActions
  selfId?: string
  // Adds an "Open" link to the person's page
  open?: boolean
}) {
  const isSelf = user._id === selfId
  const deleted = Boolean(user.deletedAt)
  const canChangeRole = user.role === 'user' || user.role === 'admin'
  const busy = (kind: string) => actions.isBusy(`${kind}:${user._id}`)
  const small = `${BTN.sm} ${BTN.neutral}`

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {open && (
        <Link to={`/admin/users/${user._id}`} aria-label={`Open ${user.name}`} className={`${BTN.sm} ${BTN.primary}`}>
          Open
        </Link>
      )}
      {!deleted && !isSelf && (
        <>
          <button
            type="button"
            onClick={() => actions.toggleActive(user)}
            disabled={busy('toggle')}
            aria-label={`${user.isActive ? 'Disable' : 'Enable'} ${user.name}`}
            className={`${BTN.sm} ${user.isActive ? BTN.danger : 'border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'}`}
          >
            {user.isActive ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={() => actions.resetPassword(user)}
            disabled={busy('password')}
            aria-label={`Reset password for ${user.name}`}
            className={small}
          >
            Reset password
          </button>
          {canChangeRole && (
            <button
              type="button"
              onClick={() => actions.changeRole(user)}
              disabled={busy('role')}
              aria-label={`${user.role === 'admin' ? 'Make user' : 'Make admin'}: ${user.name}`}
              className={small}
            >
              {user.role === 'admin' ? 'Make user' : 'Make admin'}
            </button>
          )}
          {user.twoFactor?.enabled && (
            <button
              type="button"
              onClick={() => actions.resetTwoFactor(user)}
              disabled={busy('2fa')}
              aria-label={`Reset two-step sign-in for ${user.name}`}
              className={small}
            >
              Reset two-step
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.remove(user)}
            disabled={busy('delete')}
            aria-label={`Delete ${user.name}`}
            className={`${BTN.sm} ${BTN.danger}`}
          >
            Delete
          </button>
        </>
      )}
    </div>
  )
}
