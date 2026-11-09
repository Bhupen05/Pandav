import { teamAPI } from '../../api/teamAPI'
import { useFeedback } from '../../context/useFeedback'
import { dayIn, formatDay, SERVER_TIME_ZONE, teamErrorMessage } from './format'
import { useBusy } from './hooks'
import type { AttendanceRecord, TeamTask } from './types'

// A day's record can be reviewed once it is checked out, or when its day is
// over (the server's day, which is not always the browser's)
export const attendanceReviewable = (record: AttendanceRecord, today = dayIn(SERVER_TIME_ZONE)) =>
  record.approvalStatus === 'pending' && (Boolean(record.checkOutTime) || (record.day ?? '') < today)

export type TeamReviews = ReturnType<typeof useTeamReviews>

// Approving and rejecting tasks and attendance, for every place that offers
// them. A reject asks for a reason first; the result is a toast, and
// `onChanged` runs afterwards even on a failure, since someone else may have
// reviewed the same item meanwhile.
export function useTeamReviews(teamId: string, onChanged: () => void) {
  const { notify, prompt } = useFeedback()
  const { run, isBusy } = useBusy()

  const approveTask = (task: TeamTask) =>
    run(`task-${task._id}`, async () => {
      try {
        await teamAPI.approveTeamTask(teamId, task._id)
        notify(`Approved "${task.title}".`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not approve this task.'), 'error')
      }
      onChanged()
    })

  const rejectTask = async (task: TeamTask) => {
    const reason = await prompt({
      title: 'Reject this task?',
      message: `"${task.title}" goes back to its assignees with your reason, and they can finish it again.`,
      label: 'Reason',
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return
    await run(`task-${task._id}`, async () => {
      try {
        await teamAPI.rejectTeamTask(teamId, task._id, reason.trim() ? { rejectionReason: reason.trim() } : undefined)
        notify(`Sent "${task.title}" back with your reason.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not reject this task.'), 'error')
      }
      onChanged()
    })
  }

  const approveAttendance = (record: AttendanceRecord) =>
    run(`attendance-${record._id}`, async () => {
      try {
        await teamAPI.approveTeamAttendance(teamId, record._id)
        const owner = record.user?.name ? `${record.user.name}'s` : 'the'
        notify(`Approved ${owner} attendance for ${formatDay(record.day ?? record.date)}.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not approve this attendance.'), 'error')
      }
      onChanged()
    })

  const rejectAttendance = async (record: AttendanceRecord) => {
    const who = record.user?.name ?? 'this person'
    const reason = await prompt({
      title: 'Reject this attendance?',
      message: `The attendance of ${who} for ${formatDay(record.day ?? record.date)} is marked rejected, and they see your reason.`,
      label: 'Reason',
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return
    await run(`attendance-${record._id}`, async () => {
      try {
        await teamAPI.disapproveTeamAttendance(teamId, record._id, reason.trim() || undefined)
        notify(`Rejected the attendance of ${who} for ${formatDay(record.day ?? record.date)}.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not reject this attendance.'), 'error')
      }
      onChanged()
    })
  }

  return {
    approveTask,
    rejectTask,
    approveAttendance,
    rejectAttendance,
    isTaskBusy: (task: TeamTask) => isBusy(`task-${task._id}`),
    isAttendanceBusy: (record: AttendanceRecord) => isBusy(`attendance-${record._id}`),
  }
}
