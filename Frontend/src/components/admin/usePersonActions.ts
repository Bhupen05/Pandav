import { useCallback } from 'react'
import { adminAPI, type AdminUser } from '../../api/adminAPI'
import { useFeedback } from '../../context/useFeedback'
import { useBusy } from './useBusy'
import { errorText } from './format'

type Person = Pick<AdminUser, '_id' | 'name' | 'role' | 'isActive'>

// What an admin can do to a person, with the confirmations and messages.
// Each action says what happened and then calls `onChanged` so the page can
// refresh the part that changed.
export function usePersonActions(onChanged: () => void, onDeleted?: (person: Person) => void) {
  const { notify, confirm, prompt } = useFeedback()
  const { run, isBusy, anyBusy } = useBusy()

  const attempt = useCallback(
    async (key: string, action: () => Promise<string | void>, failure: string) =>
      run(key, async () => {
        try {
          const done = await action()
          if (done) notify(done, 'success')
          onChanged()
          return true
        } catch (error) {
          notify(errorText(error, failure), 'error')
          return false
        }
      }),
    [run, notify, onChanged],
  )

  const toggleActive = useCallback(
    async (person: Person) => {
      if (person.isActive) {
        const ok = await confirm({
          title: `Disable ${person.name}?`,
          message: "They will be signed out everywhere and can't sign in until you enable the account again.",
          confirmLabel: 'Disable',
          danger: true,
        })
        if (!ok) return
      }
      await attempt(
        `toggle:${person._id}`,
        async () => {
          const result = await adminAPI.toggleActive(person._id)
          return result.message || (person.isActive ? `${person.name} is disabled.` : `${person.name} is enabled.`)
        },
        'Could not change the account',
      )
    },
    [confirm, attempt],
  )

  const resetPassword = useCallback(
    async (person: Person) => {
      const newPassword = await prompt({
        title: `Reset password for ${person.name}`,
        message: 'They will be signed out everywhere, and must choose their own password the next time they sign in.',
        label: 'New password (at least 6 characters)',
        type: 'password',
        minLength: 6,
        confirmLabel: 'Reset password',
      })
      if (newPassword === null) return
      await attempt(
        `password:${person._id}`,
        async () => {
          await adminAPI.resetPassword(person._id, newPassword)
          return `Password reset. Share the new password with ${person.name}; they will be asked to choose their own when they sign in.`
        },
        'Could not reset the password',
      )
    },
    [prompt, attempt],
  )

  const changeRole = useCallback(
    async (person: Person) => {
      const toAdmin = person.role !== 'admin'
      const ok = await confirm({
        title: toAdmin ? `Make ${person.name} an admin?` : `Make ${person.name} a regular user?`,
        message: toAdmin
          ? 'Admins can see and change everything: people, teams, tasks, attendance and messages. They will be told.'
          : 'They lose admin access straight away. They will be told.',
        confirmLabel: toAdmin ? 'Make admin' : 'Make user',
        danger: !toAdmin,
      })
      if (!ok) return
      await attempt(
        `role:${person._id}`,
        async () => {
          await adminAPI.updateUser(person._id, { role: toAdmin ? 'admin' : 'user' })
          return toAdmin ? `${person.name} is now an admin.` : `${person.name} is now a regular user.`
        },
        'Could not change the role',
      )
    },
    [confirm, attempt],
  )

  const resetTwoFactor = useCallback(
    async (person: Person) => {
      const ok = await confirm({
        title: `Reset two-step sign-in for ${person.name}?`,
        message: 'Use this when they lost their phone and backup codes. They can then sign in with their password alone and set it up again.',
        confirmLabel: 'Reset two-step sign-in',
        danger: true,
      })
      if (!ok) return
      await attempt(
        `2fa:${person._id}`,
        async () => {
          const result = await adminAPI.resetTwoFactor(person._id)
          return result.message || `Two-step sign-in is off for ${person.name}.`
        },
        'Could not reset two-step sign-in',
      )
    },
    [confirm, attempt],
  )

  const remove = useCallback(
    async (person: Person) => {
      const ok = await confirm({
        title: `Delete ${person.name}'s account?`,
        message:
          'The account is anonymised: the name becomes "Deleted user", and the email, phone, department and photo are removed. ' +
          'Their attendance, Social Hub posts and connections are deleted, and they are taken off open tasks. ' +
          'Chat messages, tasks they finished, approvals and the audit log are kept, under "Deleted user". This can\'t be undone.',
        confirmLabel: 'Delete account',
        danger: true,
      })
      if (!ok) return
      const done = await attempt(
        `delete:${person._id}`,
        async () => {
          await adminAPI.deleteUser(person._id)
          return `${person.name}'s account was deleted.`
        },
        'Could not delete the account',
      )
      if (done) onDeleted?.(person)
    },
    [confirm, attempt, onDeleted],
  )

  return { toggleActive, resetPassword, changeRole, resetTwoFactor, remove, isBusy, anyBusy }
}

export type PersonActions = ReturnType<typeof usePersonActions>
