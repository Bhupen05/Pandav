import type { AttendanceRecord, AttendanceSettings } from '../../api/attendanceAPI'
import { formatDay, formatHours, formatTime } from '../../utils/date'
import { ApprovalBadge, DayTypeBadge } from './Badges'
import { smallButton } from './fields'
import { initials, leaveTypeLabel } from './labels'
import RecordNotes from './RecordNotes'
import { useMediaQuery } from './useMediaQuery'

type Props = {
  records: AttendanceRecord[]
  settings?: AttendanceSettings
  today: string
  // The signed-in admin: nobody reviews their own day
  meId: string
  busyId: string
  onApprove: (record: AttendanceRecord) => void
  onReject: (record: AttendanceRecord) => void
  onEdit: (record: AttendanceRecord) => void
  onDelete: (record: AttendanceRecord) => void
}

const hoursOf = (record: AttendanceRecord, today: string) => {
  if (record.workHours && record.workHours > 0) return formatHours(record.workHours)
  if (record.checkInTime && !record.checkOutTime) return record.day === today ? 'In progress…' : 'No check-out'
  return '—'
}

// Why Approve and Reject are off for a pending record, or ''
const reviewBlock = (record: AttendanceRecord, today: string, meId: string) => {
  if (record.user?._id === meId) return "You can't review your own attendance"
  if (record.day === today && record.checkInTime && !record.checkOutTime) return "They haven't checked out yet"
  return ''
}

function Person({ record }: { record: AttendanceRecord }) {
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700">
        {initials(record.user?.name)}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-neutral-900">{record.user?.name || 'Unknown'}</p>
        <p className="truncate text-xs text-neutral-600">{record.user?.email}</p>
      </div>
    </div>
  )
}

function Actions({ record, today, meId, busyId, onApprove, onReject, onEdit, onDelete }: Omit<Props, 'records' | 'settings'> & { record: AttendanceRecord }) {
  const busy = busyId === record._id
  const blocked = record.approvalStatus === 'pending' ? reviewBlock(record, today, meId) : ''
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {record.approvalStatus === 'pending' && (
        <>
          <button type="button" onClick={() => onApprove(record)} disabled={busy || !!blocked} title={blocked || undefined} className={`${smallButton} bg-emerald-100 text-emerald-900 hover:bg-emerald-200`}>
            Approve
          </button>
          <button type="button" onClick={() => onReject(record)} disabled={busy || !!blocked} title={blocked || undefined} className={`${smallButton} bg-red-100 text-red-900 hover:bg-red-200`}>
            Reject
          </button>
        </>
      )}
      <button type="button" onClick={() => onEdit(record)} disabled={busy} className={`${smallButton} bg-blue-100 text-blue-900 hover:bg-blue-200`}>
        Edit
      </button>
      <button type="button" onClick={() => onDelete(record)} disabled={busy} className={`${smallButton} bg-neutral-100 text-red-800 hover:bg-red-50`}>
        Delete
      </button>
    </div>
  )
}

// The records of everyone: a table on wide screens (the side menu takes 256px of
// them), cards on phones and tablets
export default function AdminRecordsTable(props: Props) {
  const { records, settings, today } = props
  const wide = useMediaQuery('(min-width: 1280px)')

  if (wide) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs font-semibold uppercase text-neutral-700">
            <tr>
              <th scope="col" className="px-3 py-3">Employee</th>
              <th scope="col" className="px-3 py-3">Date</th>
              <th scope="col" className="px-3 py-3">Status</th>
              <th scope="col" className="px-3 py-3">Time</th>
              <th scope="col" className="px-3 py-3">Notes</th>
              <th scope="col" className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {records.map((record) => (
              <tr key={record._id} className="align-top transition-colors hover:bg-neutral-50">
                <td className="max-w-44 px-3 py-3"><Person record={record} /></td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-800">{formatDay(record.day, { year: false })}<span className="block text-xs text-neutral-600">{record.day.slice(0, 4)}</span></td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <DayTypeBadge status={record.status} detail={leaveTypeLabel(settings, record.leaveType)} />
                    <ApprovalBadge status={record.approvalStatus} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                  {record.checkInTime || record.checkOutTime ? (
                    <>
                      <p><span className="text-xs text-neutral-600">In</span> {formatTime(record.checkInTime)}</p>
                      <p><span className="text-xs text-neutral-600">Out</span> {formatTime(record.checkOutTime)}</p>
                      <p className="font-medium text-neutral-900">{hoursOf(record, today)}</p>
                    </>
                  ) : (
                    <p>—</p>
                  )}
                </td>
                <td className="min-w-40 max-w-56 px-3 py-3"><RecordNotes record={record} ownLabel="Employee's note" /></td>
                <td className="w-32 px-3 py-3"><Actions {...props} record={record} /></td>
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
          <div className="flex items-start justify-between gap-2">
            <Person record={record} />
            <p className="shrink-0 text-sm font-medium text-neutral-900">{formatDay(record.day, { year: false })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <DayTypeBadge status={record.status} detail={leaveTypeLabel(settings, record.leaveType)} />
            <ApprovalBadge status={record.approvalStatus} />
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
          <RecordNotes record={record} ownLabel="Employee's note" hideEmpty />
          <Actions {...props} record={record} />
        </li>
      ))}
    </ul>
  )
}
