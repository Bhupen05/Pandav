import { useId, useState, type FormEvent } from 'react'
import {
  attendanceAPI,
  APPROVAL_STATUSES,
  ATTENDANCE_STATUSES,
  type ApprovalStatus,
  type AttendanceRecord,
  type AttendanceSettings,
  type AttendanceStatus,
} from '../../api/attendanceAPI'
import { formatDay, fromZonedInput, toZonedInput } from '../../utils/date'
import Dialog from './Dialog'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { approvalLabel, dayTypeLabel, describeError } from './labels'
import { PersonPicker } from './Pickers'

type Props = {
  // Editing this record; leave out to add one
  record?: AttendanceRecord
  settings?: AttendanceSettings
  onClose: () => void
  // Called after the record is saved, with a sentence for the toast
  onSaved: (message: string) => void
}

type UpdateBody = Parameters<typeof attendanceAPI.updateAttendance>[1]

// Admins add a record for anyone, or change any field of one, including its
// date and times (PUT sends only what changed, so an untouched check-out time
// doesn't clear a waiting correction). Times are typed, and shown, as the
// wall-clock time in the server's zone: that is what decides a record's day.
export default function AdminRecordDialog({ record, settings, onClose, onSaved }: Props) {
  const timeZone = settings?.timezone
  if (!timeZone) {
    // Without the zone a typed time can't be turned into the right moment
    return (
      <Dialog title={record ? 'Edit attendance record' : 'Add attendance record'} onClose={onClose}>
        <p role="alert" className="text-sm text-neutral-800">The attendance settings have not loaded yet, so times can't be read. Close this and try again in a moment.</p>
        <button type="button" onClick={onClose} className={`${secondaryButton} mt-4 w-full`}>Close</button>
      </Dialog>
    )
  }
  return <RecordForm record={record} settings={settings} timeZone={timeZone} onClose={onClose} onSaved={onSaved} />
}

function RecordForm({ record, settings, timeZone, onClose, onSaved }: Omit<Props, 'settings'> & { settings: AttendanceSettings; timeZone: string }) {
  const editing = !!record
  const personLabelId = useId()
  const [userId, setUserId] = useState('')
  const [personName, setPersonName] = useState('')
  const [date, setDate] = useState(record?.day ?? '')
  const [status, setStatus] = useState<AttendanceStatus>(record?.status ?? 'present')
  const [approval, setApproval] = useState<ApprovalStatus>(record?.approvalStatus ?? 'approved')
  const [leaveType, setLeaveType] = useState(record?.leaveType ?? '')
  const [checkIn, setCheckIn] = useState(toZonedInput(record?.checkInTime, timeZone))
  const [checkOut, setCheckOut] = useState(toZonedInput(record?.checkOutTime, timeZone))
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
    const inISO = fromZonedInput(checkIn, timeZone)
    const outISO = fromZonedInput(checkOut, timeZone)
    if (checkIn && !inISO) {
      setError(`The check-in time doesn't exist in ${timeZone}: the clocks skip it that day.`)
      return
    }
    if (checkOut && !outISO) {
      setError(`The check-out time doesn't exist in ${timeZone}: the clocks skip it that day.`)
      return
    }
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
        if (checkIn !== toZonedInput(record.checkInTime, timeZone)) body.checkInTime = inISO
        if (checkOut !== toZonedInput(record.checkOutTime, timeZone)) body.checkOutTime = outISO
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
        onSaved(`Added a record for ${personName || 'the person'}, ${formatDay(date)}.`)
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
              <span id={personLabelId} className={labelClass}>Person</span>
              <PersonPicker
                id="record-person"
                labelId={personLabelId}
                value={userId}
                onChange={(person) => {
                  setUserId(person?._id ?? '')
                  setPersonName(person?.name ?? '')
                }}
                placeholder="Select a person"
                required
              />
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
            <input id="record-in" type="datetime-local" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} aria-describedby="record-zone" className={inputClass} />
          </div>
          <div>
            <label htmlFor="record-out" className={labelClass}>Check-out time</label>
            <input id="record-out" type="datetime-local" value={checkOut} min={checkIn || undefined} onChange={(event) => setCheckOut(event.target.value)} aria-describedby="record-zone" className={inputClass} />
          </div>
        </div>
        <p id="record-zone" className="-mt-2 text-xs text-neutral-600">Times are in {timeZone}. Setting a check-out time settles a waiting correction.</p>

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
