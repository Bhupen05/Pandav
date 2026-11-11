import type { AttendanceRow } from '../../../api/adminAPI'
import { Badge, Loadable } from '../ui'
import { formatDay, formatHours, formatTime } from '../format'
import { dayTypeLabel, dayTypeTone } from '../labels'
import { BTN } from '../buttons'
import type { useReview } from '../useReview'
import { BulkBar, LoadMore, Meta, QueueItem } from './parts'
import { reviewableRecords, useSelection } from './helpers'
import type { PagedQueue } from './usePagedQueue'

type Review = ReturnType<typeof useReview>

export function AttendanceQueue({
  resource,
  review,
}: {
  resource: PagedQueue<AttendanceRow>
  review: Review
}) {
  const rows = reviewableRecords(resource.data)
  const selection = useSelection(rows.map((row) => row._id))

  return (
    <Loadable
      data={resource.data}
      error={resource.error}
      loading={resource.loading}
      onRetry={resource.reload}
      errorFallback="Could not load the attendance waiting for approval"
      isEmpty={() => rows.length === 0}
      empty="No attendance records are waiting for approval."
    >
      {(data) => (
        <>
          <BulkBar
            noun="records"
            total={rows.length}
            partial={resource.hasMore}
            selection={selection}
            busy={review.isBusy('bulk:attendance')}
            onApprove={(ids) => review.bulkAttendance(ids, 'approve').then((done) => done && selection.clear())}
            onReject={(ids) => review.bulkAttendance(ids, 'reject').then((done) => done && selection.clear())}
          />
          <ul className="space-y-3">
            {rows.map((row) => {
              const busy = review.isBusy(`attendance:${row._id}`) || review.isBusy('bulk:attendance')
              const name = `${row.user.name}, ${formatDay(row.day)}`
              return (
                <QueueItem
                  key={row._id}
                  checkbox={
                    <input
                      type="checkbox"
                      checked={selection.isSelected(row._id)}
                      onChange={() => selection.toggle(row._id)}
                      aria-label={`Select ${name}`}
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                  }
                  actions={
                    <>
                      <button type="button" disabled={busy} onClick={() => review.approveAttendance(row)} aria-label={`Approve ${name}`} className={`${BTN.sm} ${BTN.success}`}>
                        Approve
                      </button>
                      <button type="button" disabled={busy} onClick={() => review.rejectAttendance(row)} aria-label={`Reject ${name}`} className={`${BTN.sm} ${BTN.danger}`}>
                        Reject
                      </button>
                    </>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-neutral-900">{row.user.name}</p>
                    <Badge tone={dayTypeTone(row.status)}>{dayTypeLabel(row.status)}</Badge>
                    {row.missedCheckout && <Badge tone="amber">Missed check-out</Badge>}
                  </div>
                  <Meta>
                    {formatDay(row.day)} · In {formatTime(row.checkInTime)} · Out {row.checkOutTime ? formatTime(row.checkOutTime) : 'not yet'}
                    {row.workHours ? ` · ${formatHours(row.workHours)}` : ''}
                    {row.team?.name ? ` · ${row.team.name}` : ''}
                  </Meta>
                  {row.remarks && <p className="mt-1 text-sm break-words text-neutral-700">&ldquo;{row.remarks}&rdquo;</p>}
                </QueueItem>
              )
            })}
          </ul>
          <LoadMore
            noun="records"
            shown={data.data.length}
            pagination={data.pagination}
            hasMore={resource.hasMore}
            loading={resource.loadingMore}
            error={resource.moreError}
            onLoadMore={resource.loadMore}
          />
        </>
      )}
    </Loadable>
  )
}
