import type { AttendanceRecord, AttendanceSettings } from '../../api/attendanceAPI'
import { formatDay, formatHours, formatTime } from '../../utils/date'
import { ApprovalBadge, DayTypeBadge } from './Badges'
import { leaveTypeLabel } from './labels'
import RecordNotes from './RecordNotes'
import { useMediaQuery } from './useMediaQuery'

type Props = {
  records: AttendanceRecord[]
  settings?: AttendanceSettings | null
  today: string
}

const hoursOf = (record: AttendanceRecord, today: string) => {
  if (record.workHours && record.workHours > 0) return formatHours(record.workHours)
  if (record.checkInTime && !record.checkOutTime) return record.day === today ? 'In progress…' : 'No check-out'
  return '—'
}

// The signed-in person's own days: no Employee column; a table when there is
// room (the side menu takes 256px), cards on phones and tablets
export default function OwnRecords({ records, settings, today }: Props) {
  const wide = useMediaQuery('(min-width: 1280px)')

  if (wide) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium text-neutral-900">Date</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium text-neutral-900">Status</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium text-neutral-900">Check in</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium text-neutral-900">Check out</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium text-neutral-900">Hours</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 font-medium text-neutral-900">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {records.map((record) => (
              <tr key={record._id} className="align-top hover:bg-neutral-50">
                <td className="whitespace-nowrap px-3 py-3 text-neutral-800">{formatDay(record.day)}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <DayTypeBadge status={record.status} detail={leaveTypeLabel(settings, record.leaveType)} />
                    <ApprovalBadge status={record.approvalStatus} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{formatTime(record.checkInTime)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{formatTime(record.checkOutTime)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{hoursOf(record, today)}</td>
                <td className="min-w-44 max-w-xs px-3 py-3"><RecordNotes record={record} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-neutral-200">
      {records.map((record) => (
        <li key={record._id} className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-neutral-900">{formatDay(record.day)}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <DayTypeBadge status={record.status} detail={leaveTypeLabel(settings, record.leaveType)} />
              <ApprovalBadge status={record.approvalStatus} />
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-neutral-600">Check in</dt>
              <dd className="text-neutral-800">{formatTime(record.checkInTime)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-600">Check out</dt>
              <dd className="text-neutral-800">{formatTime(record.checkOutTime)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-600">Hours</dt>
              <dd className="text-neutral-800">{hoursOf(record, today)}</dd>
            </div>
          </dl>
          <RecordNotes record={record} hideEmpty />
        </li>
      ))}
    </ul>
  )
}
