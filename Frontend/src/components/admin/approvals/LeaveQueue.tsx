import type { LeaveRequest, ListResponse } from '../../../api/adminAPI'
import { Badge, Loadable } from '../ui'
import { formatDateTime, formatDay } from '../format'
import { BTN } from '../buttons'
import type { useReview } from '../useReview'
import type { useResource } from '../useResource'
import { Meta, QueueItem } from './parts'

type Review = ReturnType<typeof useReview>

export function LeaveQueue({
  resource,
  review,
}: {
  resource: ReturnType<typeof useResource<ListResponse<LeaveRequest>>>
  review: Review
}) {
  return (
    <Loadable
      data={resource.data}
      error={resource.error}
      loading={resource.loading}
      onRetry={resource.reload}
      errorFallback="Could not load the leave requests"
      isEmpty={(data) => data.data.length === 0}
      empty="No leave requests are waiting for approval."
    >
      {(data) => (
        <ul className="space-y-3">
          {data.data.map((request) => {
            const busy = review.isBusy(`leave:${request.leaveRequestId}`)
            const label = `${request.user.name}, ${request.leaveTypeLabel || 'leave'}`
            const same = request.startDate === request.endDate
            return (
              <QueueItem
                key={request.leaveRequestId}
                actions={
                  <>
                    <button type="button" disabled={busy} onClick={() => review.approveLeave(request)} aria-label={`Approve ${label}`} className={`${BTN.sm} ${BTN.success}`}>
                      Approve
                    </button>
                    <button type="button" disabled={busy} onClick={() => review.rejectLeave(request)} aria-label={`Reject ${label}`} className={`${BTN.sm} ${BTN.danger}`}>
                      Reject
                    </button>
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-neutral-900">{request.user.name}</p>
                  <Badge tone="violet">{request.leaveTypeLabel || 'Leave'}</Badge>
                  {request.halfDay && <Badge tone="indigo">Half day</Badge>}
                </div>
                <Meta>
                  {same ? formatDay(request.startDate) : `${formatDay(request.startDate)} to ${formatDay(request.endDate)}`}
                  {` · ${request.days} ${request.days === 1 ? 'day' : 'days'}`}
                  {request.team?.name ? ` · ${request.team.name}` : ''}
                  {request.createdAt ? ` · Asked ${formatDateTime(request.createdAt)}` : ''}
                </Meta>
                {request.remarks && <p className="mt-1 text-sm break-words text-neutral-700">&ldquo;{request.remarks}&rdquo;</p>}
              </QueueItem>
            )
          })}
        </ul>
      )}
    </Loadable>
  )
}
