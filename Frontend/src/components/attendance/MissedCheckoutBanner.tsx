import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { AttendanceRecord } from '../../api/attendanceAPI'
import { formatDay, formatTime } from '../../utils/date'
import CorrectionDialog from './CorrectionDialog'
import { secondaryButton } from './fields'

type Props = {
  records: AttendanceRecord[]
  // Called after a request was sent, so the page loads again
  onSent: () => void
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void
}

// Days with a check-in and no check-out: the owner can ask for the time to be fixed
export default function MissedCheckoutBanner({ records, onSent, notify }: Props) {
  const [fixing, setFixing] = useState<AttendanceRecord | null>(null)
  if (records.length === 0) return null

  return (
    <section aria-label="Missed check-outs" className="mb-6 space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-orange-900">
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
        {records.length === 1 ? 'You forgot to check out on one day' : `You forgot to check out on ${records.length} days`}
      </h2>
      <ul className="space-y-2">
        {records.map((record) => (
          <li key={record._id} className="flex flex-col gap-2 rounded-lg bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-neutral-800">
              <p className="font-medium">{formatDay(record.day)}</p>
              <p className="text-neutral-600">
                Checked in at {formatTime(record.checkInTime)}, no check-out.
                {record.correctionRequest && (
                  <> You asked for {formatTime(record.correctionRequest.checkOutTime)}; waiting for review.</>
                )}
              </p>
            </div>
            <button type="button" onClick={() => setFixing(record)} className={secondaryButton}>
              {record.correctionRequest ? 'Change your request' : 'Ask for a fix'}
            </button>
          </li>
        ))}
      </ul>
      {fixing && (
        <CorrectionDialog
          record={fixing}
          onClose={() => setFixing(null)}
          onDone={() => {
            setFixing(null)
            notify('Request sent. Your team leader or an admin will review the time.', 'success')
            onSent()
          }}
        />
      )}
    </section>
  )
}
