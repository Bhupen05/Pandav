import { useState, type FormEvent } from 'react'
import { attendanceAPI, type AttendanceRecord } from '../../api/attendanceAPI'
import { formatDay, formatTime, fromDateTimeInput, toDateTimeInput } from '../../utils/date'
import Dialog from './Dialog'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { describeError } from './labels'

type Props = {
  record: AttendanceRecord
  onClose: () => void
  // Called after the request is saved
  onDone: () => void
}

// The owner tells the reviewer when they really left (POST /attendance/:id/correction)
export default function CorrectionDialog({ record, onClose, onDone }: Props) {
  const checkIn = record.checkInTime ? new Date(record.checkInTime) : null
  // The latest possible check-out: 24 hours after the check-in, but not in the future
  const [opened] = useState(() => Date.now())
  const latest = new Date(checkIn ? Math.min(checkIn.getTime() + 24 * 3600 * 1000, opened) : opened)
  const [checkOut, setCheckOut] = useState(toDateTimeInput(record.correctionRequest?.checkOutTime))
  const [remarks, setRemarks] = useState(record.correctionRequest?.remarks || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const iso = fromDateTimeInput(checkOut)
    if (!iso) {
      setError('Choose the time you checked out.')
      return
    }
    const chosen = new Date(iso)
    if (checkIn && chosen <= checkIn) {
      setError(`The check-out must be after your check-in at ${formatTime(record.checkInTime)}.`)
      return
    }
    if (chosen > latest) {
      setError(checkIn && latest.getTime() < opened ? 'The check-out must be within 24 hours of your check-in.' : 'The check-out cannot be in the future.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await attendanceAPI.requestCorrection(record._id, { checkOutTime: iso, remarks: remarks.trim() || undefined })
      onDone()
    } catch (failure) {
      setError(describeError(failure, 'Could not send your request.'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Ask for a check-out fix"
      description={`${formatDay(record.day)}: you checked in at ${formatTime(record.checkInTime)} and never checked out. Say when you left; your reviewer will apply it.`}
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="correction-out" className={labelClass}>Time you checked out</label>
          <input
            id="correction-out"
            type="datetime-local"
            value={checkOut}
            min={toDateTimeInput(record.checkInTime)}
            max={toDateTimeInput(latest.toISOString())}
            onChange={(event) => setCheckOut(event.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="correction-remarks" className={labelClass}>Note for your reviewer (optional)</label>
          <textarea
            id="correction-remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            maxLength={500}
            rows={3}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-neutral-600">{remarks.length}/500 characters</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className={`${secondaryButton} flex-1`}>Cancel</button>
          <button type="submit" disabled={saving} className={`${primaryButton} flex-1`}>
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
