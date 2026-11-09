import type { AttendanceRecord, AttendanceSettings } from '../../api/attendanceAPI'
import { describeShift, describeWorkdays } from './labels'
import { ErrorState } from './States'

type Props = {
  // False until today's record has loaded: both buttons wait
  ready: boolean
  busy: boolean
  record?: AttendanceRecord
  // An open check-in that Check out would close (today's, or last night's)
  hasOpenCheckIn: boolean
  // Why check-in is closed, if it is
  blockedReason: string
  rejectedToday: boolean
  settings?: AttendanceSettings
  settingsError?: string
  onRetrySettings: () => void
  onCheckIn: () => void
  onCheckOut: () => void
}

// Check in / Check out, with the shift rule and the reason a button is off
export default function CheckPanel({ ready, busy, record, hasOpenCheckIn, blockedReason, rejectedToday, settings, settingsError, onRetrySettings, onCheckIn, onCheckOut }: Props) {
  const checkedIn = !!record?.checkInTime
  const checkedOut = !!record?.checkOutTime

  return (
    <section aria-labelledby="quick-actions-title" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 id="quick-actions-title" className="mb-4 text-lg font-semibold text-neutral-900">Quick actions</h2>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onCheckIn}
          disabled={!ready || busy || checkedIn || !!blockedReason}
          aria-describedby={blockedReason ? 'check-in-reason' : undefined}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
        >
          {checkedIn ? '✓ Checked In' : busy ? 'Processing...' : 'Check In'}
        </button>
        <button
          type="button"
          onClick={onCheckOut}
          disabled={!ready || busy || !hasOpenCheckIn}
          className="rounded-md bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50"
        >
          {checkedOut ? '✓ Checked Out' : busy ? 'Processing...' : 'Check Out'}
        </button>
      </div>
      {blockedReason && <p id="check-in-reason" className="mt-3 text-sm font-medium text-neutral-900">{blockedReason}</p>}
      {rejectedToday && !blockedReason && (
        <p className="mt-3 text-sm text-neutral-700">Your request for today was rejected. Checking in now replaces it.</p>
      )}
      <div className="mt-4 border-t border-neutral-200 pt-3 text-sm text-neutral-700">
        {settings ? (
          <>
            <p>{describeShift(settings)}</p>
            <p className="mt-0.5 text-neutral-600">Working days: {describeWorkdays(settings.workdays)}</p>
          </>
        ) : settingsError ? (
          <ErrorState message="The shift rules could not be loaded." onRetry={onRetrySettings} />
        ) : (
          <p className="text-neutral-600">Loading the shift rules…</p>
        )}
      </div>
    </section>
  )
}
