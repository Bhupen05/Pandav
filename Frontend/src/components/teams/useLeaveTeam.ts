import { teamAPI } from '../../api/teamAPI'
import { useFeedback } from '../../context/useFeedback'
import { teamErrorMessage } from './format'
import { useBusy, useSyncSession } from './hooks'

// Leaving a team: asks first, tells the server, then copies the user's new
// role into the session. `onLeft` runs once it worked.
export function useLeaveTeam(team: { _id: string; name: string }, onLeft: () => void) {
  const { notify, confirm } = useFeedback()
  const syncSession = useSyncSession()
  const { run, isBusy } = useBusy()

  const leave = async () => {
    const ok = await confirm({
      title: 'Leave this team?',
      message: `You will no longer see ${team.name}’s tasks, chat or attendance, and you are taken off its open tasks. Your finished work stays. The team’s leaders are told.`,
      confirmLabel: 'Leave team',
      danger: true,
    })
    if (!ok) return
    await run('leave', async () => {
      try {
        const response = await teamAPI.leaveTeam(team._id)
        notify(response?.message || `You have left ${team.name}.`, 'success')
        await syncSession()
        onLeft()
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not leave the team.'), 'error')
      }
    })
  }

  return { leave, leaving: isBusy('leave') }
}
