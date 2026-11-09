import { useState, type FormEvent } from 'react'
import {
  attendanceAPI,
  APPROVAL_STATUSES,
  ATTENDANCE_STATUSES,
  type ApprovalStatus,
  type AttendanceRecord,
  type AttendanceSettings,
  type AttendanceStatus,
  type PersonRef,
} from '../../api/attendanceAPI'
import { formatDay, fromDateTimeInput, toDateTimeInput } from '../../utils/date'
import Dialog from './Dialog'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { approvalLabel, dayTypeLabel, describeError } from './labels'

type Props = {
  // Editing this record; leave out to add one
  record?: AttendanceRecord
  people: PersonRef[]
  settings?: AttendanceSettings
  onClose: () => void
  // Called after the record is saved, with a sentence for the toast
  onSaved: (message: string) => void
}

type UpdateBody = Parameters<typeof attendanceAPI.updateAttendance>[1]

// Admins add a record for anyone, or change any field of one, including its
// date and times (PUT sends only what changed, so an untouched check-out time
// doesn't clear a waiting correction)
export default function AdminRecordDialog({ record, people, settings, onClose, onSaved }: Props) {
  const editing = !!record
  const [userId, setUserId] = useState('')
  const [date, setDate] = useState(record?.day ?? '')
  const [status, setStatus] = useState<AttendanceStatus>(record?.status ?? 'present')
  const [approval, setApproval] = useState<ApprovalStatus>(record?.approvalStatus ?? 'approved')
  const [leaveType, setLeaveType] = useState(record?.leaveType ?? '')
  const [checkIn, setCheckIn] = useState(toDateTimeInput(record?.checkInTime))
  const [checkOut, setCheckOut] = useState(toDateTimeInput(record?.checkOutTime))
  const [remarks, setRemarks] = useState(record?.remarks ?? '')
  const [reviewRemarks, setReviewRemarks] = useState(record?.reviewRemarks ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const showLeaveType = status === 'leave' || status === 'half-day'

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing && !userId) {
      setError('Choose the person this record is for.')
      return
    }
    if (!date) {
      setError('Choose the date.')
      return
    }
    const inISO = fromDateTimeInput(checkIn)
    const outISO = fromDateTimeInput(checkOut)
    if (inISO && outISO && new Date(outISO) < new Date(inISO)) {
      setError('The check-out cannot be before the check-in.')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (record) {
        const body: UpdateBody = {}
        if (date !== record.day) body.date = date
        if (status !== record.status) body.status = status
        if (approval !== record.approvalStatus) body.approvalStatus = approval
        if (checkIn !== toDateTimeInput(record.checkInTime)) body.checkInTime = inISO
        if (checkOut !== toDateTimeInput(record.checkOutTime)) body.checkOutTime = outISO
        if (remarks.trim() !== (record.remarks ?? '')) body.remarks = remarks.trim()
        if (reviewRemarks.trim() !== (record.reviewRemarks ?? '')) body.reviewRemarks = reviewRemarks.trim()
        if (showLeaveType && leaveType !== (record.leaveType ?? '')) body.leaveType = leaveType || null
        if (Object.keys(body).length === 0) {
          onClose()
          return
        }
        await attendanceAPI.updateAttendance(record._id, body)
        onSaved(`Saved the record for ${record.user?.name || 'this person'}, ${formatDay(record.day)}.`)
      } else {
        await attendanceAPI.createAttendance({
          user: userId,
          date,
          status,
          approvalStatus: approval,
          checkInTime: inISO,
          checkOutTime: outISO,
          remarks: remarks.trim() || undefined,
          reviewRemarks: reviewRemarks.trim() || undefined,
          leaveType: showLeaveType && leaveType ? leaveType : undefined,
        })
        const person = people.find((candidate) => candidate._id === userId)
        onSaved(`Added a record for ${person?.name || 'the person'}, ${formatDay(date)}.`)
      }
    } catch (failure) {
      setError(describeError(failure, 'Could not save this record.'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={editing ? 'Edit attendance record' : 'Add attendance record'}
      description={editing ? `${record.user?.name || 'Unknown'}, ${formatDay(record.day)}` : 'A record you add is approved straight away unless you choose otherwise.'}
      onClose={onClose}
      busy={saving}
      wide
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {!editing && (
            <div className="sm:col-span-2">
              <label htmlFor="record-person" className={labelClass}>Person</label>
              <select id="record-person" value={userId} onChange={(event) => setUserId(event.target.value)} required className={inputClass}>
                <option value="">Select a person</option>
                {people.map((person) => (
                  <option key={person._id} value={person._id}>{person.name}{person.email ? ` (${person.email})` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="record-date" className={labelClass}>Date</label>
            <input id="record-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required className={inputClass} />
          </div>
          <div>
            <label htmlFor="record-status" className={labelClass}>Day type</label>
            <select id="record-status" value={status} onChange={(event) => setStatus(event.target.value as AttendanceStatus)} className={inputClass}>
              {ATTENDANCE_STATUSES.map((value) => (
                <option key={value} value={value}>{dayTypeLabel(value)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="record-approval" className={labelClass}>Approval</label>
            <select id="record-approval" value={approval} onChange={(event) => setApproval(event.target.value as ApprovalStatus)} className={inputClass}>
              {APPROVAL_STATUSES.map((value) => (
                <option key={value} value={value}>{approvalLabel(value)}</option>
              ))}
            </select>
          </div>
          {showLeaveType && (
            <div>
              <label htmlFor="record-leave-type" className={labelClass}>Type of leave</label>
              <select id="record-leave-type" value={leaveType} onChange={(event) => setLeaveType(event.target.value)} className={inputClass}>
                <option value="">Not set</option>
                {settings?.leaveTypes.map((type) => (
                  <option key={type.key} value={type.key}>{type.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="record-in" className={labelClass}>Check-in time</label>
            <input id="record-in" type="datetime-local" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="record-out" className={labelClass}>Check-out time</label>
            <input id="record-out" type="datetime-local" value={checkOut} min={checkIn || undefined} onChange={(event) => setCheckOut(event.target.value)} className={inputClass} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-neutral-600">Times are in your browser's time zone. Setting a check-out time settles a waiting correction.</p>

        <div>
          <label htmlFor="record-remarks" className={labelClass}>Employee's note</label>
          <textarea id="record-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} rows={2} className={inputClass} />
        </div>
        <div>
          <label htmlFor="record-review" className={labelClass}>Reviewer's reason</label>
          <textarea id="record-review" value={reviewRemarks} onChange={(event) => setReviewRemarks(event.target.value)} maxLength={1000} rows={2} className={inputClass} />
          <p className="mt-1 text-xs text-neutral-600">{reviewRemarks.length}/1000 characters</p>
        </div>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className={`${secondaryButton} flex-1`}>Cancel</button>
          <button type="submit" disabled={saving} className={`${primaryButton} flex-1`}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add record'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
