import { useState } from 'react'
import { attendanceAPI, type AttendanceRecord } from '../../api/attendanceAPI'
import type { FeedbackContextType } from '../../context/useFeedback'
import { formatDay } from '../../utils/date'
import { describeError } from './labels'

type Options = {
  notify: FeedbackContextType['notify']
  prompt: FeedbackContextType['prompt']
  // Loads the lists again; resolves when they are up to date
  onChanged: () => Promise<unknown>
}

// Approve or reject one record. The reason for a rejection is asked for in a
// dialog and stored as the reviewer's remarks, never over the owner's note.
export function useReview({ notify, prompt, onChanged }: Options) {
  const [busyId, setBusyId] = useState('')

  const approve = async (record: AttendanceRecord) => {
    setBusyId(record._id)
    try {
      await attendanceAPI.approveAttendance(record._id)
      notify(`Approved ${record.user?.name || 'the'} attendance for ${formatDay(record.day)}.`, 'success')
    } catch (error) {
      notify(describeError(error, 'Could not approve this record.'), 'error')
    }
    await onChanged()
    setBusyId('')
  }

  const reject = async (record: AttendanceRecord) => {
    const reason = await prompt({
      title: 'Reject this attendance?',
      message: `${record.user?.name || 'This person'}, ${formatDay(record.day)}. The reason is kept on the record and shown to them.`,
      label: 'Reason',
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return
    setBusyId(record._id)
    try {
      await attendanceAPI.rejectAttendance(record._id, reason.trim() || undefined)
      notify(`Rejected ${record.user?.name || 'the'} attendance for ${formatDay(record.day)}.`, 'success')
    } catch (error) {
      notify(describeError(error, 'Could not reject this record.'), 'error')
    }
    await onChanged()
    setBusyId('')
  }

  return { busyId, approve, reject }
}
