import { useCallback } from 'react'
import { adminAPI, type AttendanceRow, type BulkResult, type LeaveRequest, type SocialPostRow, type TaskRow } from '../../api/adminAPI'
import { useFeedback } from '../../context/useFeedback'
import { useBusy } from './useBusy'
import { errorText, formatDay } from './format'

export type ReviewArea = 'tasks' | 'attendance' | 'leave' | 'corrections' | 'posts'

// The server reviews at most this many records in one bulk request (Backend/Doc/Attendance.md)
const BULK_ATTENDANCE_MAX = 100

const POST_TARGETS = (post: SocialPostRow) => (post.title || post.content || 'this post').slice(0, 60)

// Approving and rejecting, in one place for the dashboard and the approvals
// inbox: one wording, one reason prompt, one way to report bulk results.
// `onDone` is told which list changed so only that part refreshes.
export function useReview(onDone: (area: ReviewArea) => void) {
  const { notify, prompt, confirm } = useFeedback()
  const { run, isBusy, anyBusy } = useBusy()

  // Runs one action with its messages; true when it worked
  const attempt = useCallback(
    async (key: string, area: ReviewArea, action: () => Promise<string>, failure: string) => {
      const done = await run(key, async () => {
        try {
          notify(await action(), 'success')
          return true
        } catch (error) {
          notify(errorText(error, failure), 'error')
          return false
        }
      })
      // The list is refreshed after a failure too: it may have changed under us
      if (done !== undefined) onDone(area)
      return done === true
    },
    [run, notify, onDone],
  )

  // "3 of 5 approved", and why the others were refused
  const reportBulk = useCallback(
    (results: BulkResult[], verb: string, noun: string) => {
      const failed = results.filter((result) => !result.ok)
      const done = results.length - failed.length
      if (failed.length === 0) {
        notify(`${done} ${noun}${done === 1 ? '' : 's'} ${verb}.`, 'success')
        return
      }
      const reasons = Array.from(new Set(failed.map((result) => result.message).filter(Boolean)))
      const why = reasons.slice(0, 2).join(' ')
      notify(`${done} of ${results.length} ${verb}. ${failed.length} could not be: ${why || 'they were refused'}`, done > 0 ? 'info' : 'error')
    },
    [notify],
  )

  const askReason = useCallback(
    (title: string, message: string, confirmLabel: string) =>
      prompt({ title, message, label: 'Reason', confirmLabel, danger: true }),
    [prompt],
  )

  // ── Tasks ──
  const approveTask = (task: Pick<TaskRow, '_id' | 'title'>) =>
    attempt(`task:${task._id}`, 'tasks', async () => {
      await adminAPI.approveTask(task._id)
      return `Approved "${task.title}".`
    }, 'Could not approve the task')

  const rejectTask = async (task: Pick<TaskRow, '_id' | 'title'>) => {
    const reason = await askReason(`Send back "${task.title}"?`, 'It goes back to In progress, and the people on it see your reason.', 'Reject task')
    if (reason === null) return false
    return attempt(`task:${task._id}`, 'tasks', async () => {
      await adminAPI.rejectTask(task._id, reason.trim())
      return `Sent "${task.title}" back with your reason.`
    }, 'Could not reject the task')
  }

  const bulkTasks = async (ids: string[], action: 'approve' | 'reject') => {
    let reason: string | null = ''
    if (action === 'reject') {
      reason = await askReason(
        `Reject ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}?`,
        'They go back to In progress, and the people on them see your reason.',
        'Reject tasks',
      )
      if (reason === null) return false
    } else if (
      !(await confirm({
        title: `Approve ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}?`,
        message: 'They are marked completed.',
        confirmLabel: 'Approve',
      }))
    ) {
      return false
    }
    const done = await run('bulk:tasks', async () => {
      try {
        const response = await adminAPI.bulkReviewTasks(ids, action, reason?.trim() || undefined)
        reportBulk(response.data, action === 'approve' ? 'approved' : 'rejected', 'task')
        return true
      } catch (error) {
        notify(errorText(error, 'Could not review the tasks'), 'error')
        return false
      }
    })
    if (done !== undefined) onDone('tasks')
    return done === true
  }

  // ── Attendance ──
  const describe = (row: AttendanceRow) => `${row.user.name}'s attendance for ${formatDay(row.day)}`

  const approveAttendance = (row: AttendanceRow) =>
    attempt(`attendance:${row._id}`, 'attendance', async () => {
      await adminAPI.approveAttendance(row._id)
      return `Approved ${describe(row)}.`
    }, 'Could not approve the attendance')

  const rejectAttendance = async (row: AttendanceRow) => {
    const reason = await askReason(`Reject ${describe(row)}?`, 'They see your reason next to the record.', 'Reject')
    if (reason === null) return false
    return attempt(`attendance:${row._id}`, 'attendance', async () => {
      await adminAPI.rejectAttendance(row._id, reason.trim())
      return `Rejected ${describe(row)}.`
    }, 'Could not reject the attendance')
  }

  const bulkAttendance = async (ids: string[], action: 'approve' | 'reject') => {
    let reason: string | null = ''
    if (action === 'reject') {
      reason = await askReason(`Reject ${ids.length} ${ids.length === 1 ? 'record' : 'records'}?`, 'Each person sees your reason next to their record.', 'Reject records')
      if (reason === null) return false
    } else if (
      !(await confirm({
        title: `Approve ${ids.length} ${ids.length === 1 ? 'record' : 'records'}?`,
        confirmLabel: 'Approve',
      }))
    ) {
      return false
    }
    const done = await run('bulk:attendance', async () => {
      // Everything loaded can be selected, which may be more than one request takes
      const results: BulkResult[] = []
      const verb = action === 'approve' ? 'approved' : 'rejected'
      try {
        for (let start = 0; start < ids.length; start += BULK_ATTENDANCE_MAX) {
          const response = await adminAPI.bulkReviewAttendance(ids.slice(start, start + BULK_ATTENDANCE_MAX), action, reason?.trim() || undefined)
          results.push(...response.data.results)
        }
        reportBulk(results, verb, 'record')
        return true
      } catch (error) {
        // The batches before the failing one went through: say so
        if (results.length > 0) reportBulk(results, verb, 'record')
        notify(errorText(error, 'Could not review the records'), 'error')
        return false
      }
    })
    if (done !== undefined) onDone('attendance')
    return done === true
  }

  // ── Leave ──
  const leaveText = (request: LeaveRequest) => `${request.user.name}'s ${(request.leaveTypeLabel || 'leave').toLowerCase()}`

  const approveLeave = (request: LeaveRequest) =>
    attempt(`leave:${request.leaveRequestId}`, 'leave', async () => {
      await adminAPI.approveLeave(request.leaveRequestId)
      return `Approved ${leaveText(request)}.`
    }, 'Could not approve the leave')

  const rejectLeave = async (request: LeaveRequest) => {
    const reason = await askReason(`Reject ${leaveText(request)}?`, 'Every day of the request is rejected, and they see your reason.', 'Reject leave')
    if (reason === null) return false
    return attempt(`leave:${request.leaveRequestId}`, 'leave', async () => {
      await adminAPI.rejectLeave(request.leaveRequestId, reason.trim())
      return `Rejected ${leaveText(request)}.`
    }, 'Could not reject the leave')
  }

  // ── Corrections ──
  const applyCorrection = (row: AttendanceRow) =>
    attempt(`correction:${row._id}`, 'corrections', async () => {
      if (!row.correctionRequest) throw new Error('There is no correction to apply')
      await adminAPI.updateAttendance(row._id, { checkOutTime: row.correctionRequest.checkOutTime })
      return `Applied the new check-out time to ${describe(row)}.`
    }, 'Could not apply the correction')

  const declineCorrection = async (row: AttendanceRow) => {
    const ok = await confirm({
      title: 'Decline this correction?',
      message: `${row.user.name}'s check-out time for ${formatDay(row.day)} stays as it is.`,
      confirmLabel: 'Decline',
      danger: true,
    })
    if (!ok) return false
    return attempt(`correction:${row._id}`, 'corrections', async () => {
      await adminAPI.updateAttendance(row._id, { correctionRequest: null })
      return `Declined the correction for ${describe(row)}.`
    }, 'Could not decline the correction')
  }

  // ── Posts ──
  const approvePost = (post: SocialPostRow) =>
    attempt(`post:${post._id}`, 'posts', async () => {
      await adminAPI.decidePost(post._id, 'approved')
      return `Approved "${POST_TARGETS(post)}". It can now be published.`
    }, 'Could not approve the post')

  const rejectPost = async (post: SocialPostRow) => {
    const ok = await confirm({
      title: 'Reject this post?',
      message: `"${POST_TARGETS(post)}" will not be published to LinkedIn or GitHub, and the author is told.`,
      confirmLabel: 'Reject post',
      danger: true,
    })
    if (!ok) return false
    return attempt(`post:${post._id}`, 'posts', async () => {
      await adminAPI.decidePost(post._id, 'rejected')
      return 'Post rejected.'
    }, 'Could not reject the post')
  }

  return {
    isBusy,
    anyBusy,
    approveTask,
    rejectTask,
    bulkTasks,
    approveAttendance,
    rejectAttendance,
    bulkAttendance,
    approveLeave,
    rejectLeave,
    applyCorrection,
    declineCorrection,
    approvePost,
    rejectPost,
  }
}
