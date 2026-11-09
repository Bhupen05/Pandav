import type { AttendanceRecord } from '../../api/attendanceAPI'
import { formatDateTime, formatTime } from '../../utils/date'
import { WarningChip } from './Badges'
import ExpandableText from './ExpandableText'

// What was written on a day: the owner's note and the reviewer's reason are
// shown apart, never mixed (the reason used to overwrite the note)
export default function RecordNotes({ record, ownLabel = 'Note', hideEmpty }: { record: AttendanceRecord; ownLabel?: string; hideEmpty?: boolean }) {
  const reviewer = record.approvedBy?.name
  const hasAnything =
    record.remarks || record.reviewRemarks || record.missedCheckout || record.correctionRequest || record.autoMarked
  if (!hasAnything) return hideEmpty ? null : <span className="text-neutral-500">—</span>

  return (
    <div className="space-y-1.5 text-sm text-neutral-700">
      {(record.missedCheckout || record.correctionRequest || record.autoMarked) && (
        <div className="flex flex-wrap gap-1">
          {record.missedCheckout && <WarningChip>No check-out</WarningChip>}
          {record.correctionRequest && (
            <WarningChip>
              Fix asked: out at {formatTime(record.correctionRequest.checkOutTime)}
            </WarningChip>
          )}
          {record.autoMarked && (
            <span className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-700">
              Marked automatically
            </span>
          )}
        </div>
      )}
      {record.remarks && (
        <div>
          <p className="text-xs font-semibold text-neutral-600">{ownLabel}</p>
          <ExpandableText text={record.remarks} />
        </div>
      )}
      {record.reviewRemarks && (
        <div>
          <p className="text-xs font-semibold text-neutral-600">
            Reviewer's reason{reviewer ? ` (${reviewer}${record.reviewedAt ? `, ${formatDateTime(record.reviewedAt)}` : ''})` : ''}
          </p>
          <ExpandableText text={record.reviewRemarks} />
        </div>
      )}
    </div>
  )
}
