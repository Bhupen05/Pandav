import type { AttendanceRow } from '../../../api/adminAPI'
import { Badge, Loadable } from '../ui'
import { formatDateTime, formatDay, formatTime } from '../format'
import { approvalLabel, approvalTone } from '../labels'
import { BTN } from '../buttons'
import type { useReview } from '../useReview'
import { LoadMore, Meta, QueueItem } from './parts'
import type { PagedQueue } from './usePagedQueue'

type Review = ReturnType<typeof useReview>

export function CorrectionQueue({
  resource,
  review,
}: {
  resource: PagedQueue<AttendanceRow>
  review: Review
}) {
  return (
    <Loadable
      data={resource.data}
      error={resource.error}
      loading={resource.loading}
      onRetry={resource.reload}
      errorFallback="Could not load the correction requests"
      isEmpty={(data) => data.data.length === 0}
      empty="No one has asked for a check-out time to be corrected."
    >
      {(data) => (
        <>
          <ul className="space-y-3">
            {data.data.map((row) => {
              const asked = row.correctionRequest
              const busy = review.isBusy(`correction:${row._id}`)
              const name = `${row.user.name}, ${formatDay(row.day)}`
              return (
                <QueueItem
                  key={row._id}
                  actions={
                    <>
                      <button type="button" disabled={busy} onClick={() => review.applyCorrection(row)} aria-label={`Apply the new check-out time for ${name}`} className={`${BTN.sm} ${BTN.success}`}>
                        Apply new time
                      </button>
                      <button type="button" disabled={busy} onClick={() => review.declineCorrection(row)} aria-label={`Decline the correction for ${name}`} className={`${BTN.sm} ${BTN.danger}`}>
                        Decline
                      </button>
                    </>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-neutral-900">{row.user.name}</p>
                    <Badge tone={approvalTone(row.approvalStatus)}>{approvalLabel(row.approvalStatus)}</Badge>
                    {row.missedCheckout && <Badge tone="amber">Missed check-out</Badge>}
                  </div>
                  <Meta>
                    {formatDay(row.day)} · In {formatTime(row.checkInTime)} · Out {row.checkOutTime ? formatTime(row.checkOutTime) : 'not recorded'}
                  </Meta>
                  {asked && (
                    <p className="mt-1 text-sm text-neutral-800">
                      Asks for a check-out at <span className="font-semibold">{formatTime(asked.checkOutTime)}</span>
                      {asked.requestedAt && <span className="text-xs text-neutral-500"> (asked {formatDateTime(asked.requestedAt)})</span>}
                      {asked.remarks && <span className="block text-neutral-700 break-words">&ldquo;{asked.remarks}&rdquo;</span>}
                    </p>
                  )}
                </QueueItem>
              )
            })}
          </ul>
          <LoadMore
            noun="requests"
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
