import { CalendarDays } from 'lucide-react'
import type { AttendanceRecord, Holiday, MonthSummary } from '../../api/attendanceAPI'
import { formatDay, formatHours, formatMonth, formatTime } from '../../utils/date'
import { ApprovalBadge, DayTypeBadge } from './Badges'
import { ErrorState } from './States'

const card = 'rounded-xl border border-neutral-200 bg-white p-4 shadow-sm'

// The four "Today" cards: always about the signed-in person
export function TodayCards({ record, holiday, loading }: { record?: AttendanceRecord; holiday?: Holiday; loading: boolean }) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading today" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={`${card} animate-pulse`}>
            <div className="h-3 w-20 rounded bg-neutral-200" />
            <div className="mt-3 h-6 w-24 rounded bg-neutral-200" />
          </div>
        ))}
      </div>
    )
  }

  const hours =
    record?.workHours && record.workHours > 0
      ? formatHours(record.workHours)
      : record?.checkInTime && !record.checkOutTime
        ? 'In progress…'
        : '0 hrs'

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className={card}>
        <p className="text-xs text-neutral-600">Today's status</p>
        {record ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DayTypeBadge status={record.status} />
            <ApprovalBadge status={record.approvalStatus} />
          </div>
        ) : (
          <p className="mt-1 text-lg font-semibold text-neutral-700">{holiday ? `Holiday: ${holiday.name}` : 'Not checked in'}</p>
        )}
      </div>
      <div className={card}>
        <p className="text-xs text-neutral-600">Check-in time</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">{formatTime(record?.checkInTime)}</p>
      </div>
      <div className={card}>
        <p className="text-xs text-neutral-600">Check-out time</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">{formatTime(record?.checkOutTime)}</p>
      </div>
      <div className={card}>
        <p className="text-xs text-neutral-600">Today's work hours</p>
        <p className="mt-1 text-lg font-semibold text-blue-700">{hours}</p>
      </div>
    </div>
  )
}

type MonthProps = {
  summary?: MonthSummary
  loading: boolean
  error?: string
  onRetry: () => void
}

// This month's hours: approved ones are the total, hours still waiting for
// approval are shown on their own line
export function MonthCard({ summary, loading, error, onRetry }: MonthProps) {
  return (
    <section aria-labelledby="month-title" className="rounded-xl bg-linear-to-r from-blue-700 to-emerald-700 p-6 text-white shadow-sm">
      <p id="month-title" className="text-sm font-medium">
        Approved working hours{summary ? ` · ${formatMonth(summary.month)}` : ' · this month'}
      </p>
      {summary ? (
        <>
          <p className="mt-1 text-3xl font-bold">{formatHours(summary.approvedHours)}</p>
          {summary.pendingHours > 0 && (
            <p className="mt-1 text-sm">+ {formatHours(summary.pendingHours)} awaiting approval (not counted yet)</p>
          )}
          <p className="mt-3 text-sm">
            Approved days: {summary.days.present} present · {summary.days.late} late · {summary.days.halfDay} half day · {summary.days.leave} leave · {summary.days.absent} absent
          </p>
          {summary.rejectedCount > 0 && (
            <p className="mt-1 text-sm">{summary.rejectedCount} {summary.rejectedCount === 1 ? 'day was' : 'days were'} rejected this month.</p>
          )}
        </>
      ) : error ? (
        <div className="mt-3 text-neutral-900"><ErrorState message={error} onRetry={onRetry} /></div>
      ) : loading ? (
        <div role="status" aria-label="Loading this month" className="mt-3 h-9 w-40 animate-pulse rounded bg-white/30" />
      ) : null}
    </section>
  )
}

// The next holidays (all of them are on the server; people see what is coming)
export function HolidaysCard({ holidays, today, loading, error, onRetry }: { holidays: Holiday[]; today: string; loading: boolean; error?: string; onRetry: () => void }) {
  const upcoming = holidays.filter((holiday) => holiday.day >= today).slice(0, 5)
  return (
    <section aria-labelledby="holidays-title" className={card}>
      <h2 id="holidays-title" className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        Upcoming holidays
      </h2>
      {error && holidays.length === 0 ? (
        <div className="mt-2"><ErrorState message={error} onRetry={onRetry} /></div>
      ) : loading && holidays.length === 0 ? (
        <div role="status" aria-label="Loading holidays" className="mt-3 h-12 animate-pulse rounded bg-neutral-100" />
      ) : upcoming.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">No holidays are coming up.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-neutral-800">
          {upcoming.map((holiday) => (
            <li key={holiday._id} className="flex flex-wrap justify-between gap-x-3">
              <span>{holiday.name}</span>
              <span className="text-neutral-600">{formatDay(holiday.day, { year: false })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
