import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { attendanceAPI, type ApprovalStatus, type AttendanceSettings, type LeaveRequest } from '../../api/attendanceAPI'
import { useFeedback } from '../../context/useFeedback'
import { formatDateTime, formatDayRange } from '../../utils/date'
import { ApprovalBadge } from './Badges'
import ExpandableText from './ExpandableText'
import { inputClass } from './fields'
import { approvalLabel, describeError, formatDays, initials, leaveTypeLabel } from './labels'
import Pager from './Pager'
import { EmptyState, ErrorState, Loading } from './States'
import { useLoad } from './useLoad'

const PAGE_SIZE = 10

type Props = {
  meId: string
  settings?: AttendanceSettings
  onChanged: () => Promise<unknown>
}

// The "Leave requests" tab: whole requests are approved or rejected at once
export default function AdminLeave({ meId, settings, onChanged }: Props) {
  const { notify, prompt } = useFeedback()
  const [status, setStatus] = useState<'' | ApprovalStatus>('pending')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState('')

  const requests = useLoad(
    () => attendanceAPI.getLeaveRequests({ status: status || undefined, page, limit: PAGE_SIZE }),
    `${status}:${page}`,
    { refreshMs: 30000 },
  )

  const approve = async (request: LeaveRequest) => {
    setBusyId(request.leaveRequestId)
    try {
      await attendanceAPI.approveLeave(request.leaveRequestId)
      notify(`Approved the leave of ${request.user?.name || 'the person'} (${formatDayRange(request.startDate, request.endDate)}).`, 'success')
    } catch (error) {
      notify(describeError(error, 'Could not approve this leave request.'), 'error')
    }
    await Promise.all([requests.refresh(), onChanged()])
    setBusyId('')
  }

  const reject = async (request: LeaveRequest) => {
    const reason = await prompt({
      title: 'Reject this leave request?',
      message: `${request.user?.name || 'This person'}, ${formatDayRange(request.startDate, request.endDate)}. The reason is sent to them.`,
      label: 'Reason',
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return
    setBusyId(request.leaveRequestId)
    try {
      await attendanceAPI.rejectLeave(request.leaveRequestId, reason.trim() || undefined)
      notify(`Rejected the leave of ${request.user?.name || 'the person'} (${formatDayRange(request.startDate, request.endDate)}).`, 'success')
    } catch (error) {
      notify(describeError(error, 'Could not reject this leave request.'), 'error')
    }
    await Promise.all([requests.refresh(), onChanged()])
    setBusyId('')
  }

  const list = requests.data?.data ?? []

  return (
    <section aria-labelledby="leave-title" className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <h2 id="leave-title" className="font-semibold text-neutral-900">Leave requests</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="leave-status" className="whitespace-nowrap text-sm text-neutral-700">Show</label>
          <select
            id="leave-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as '' | ApprovalStatus)
              setPage(1)
            }}
            className={`${inputClass} w-auto`}
          >
            <option value="pending">{approvalLabel('pending')}</option>
            <option value="approved">{approvalLabel('approved')}</option>
            <option value="rejected">{approvalLabel('rejected')}</option>
            <option value="">All requests</option>
          </select>
        </div>
      </div>

      {requests.error && !requests.data ? (
        <div className="p-4"><ErrorState message={requests.error} onRetry={requests.reload} /></div>
      ) : requests.loading && !requests.data ? (
        <Loading label="Loading the leave requests…" />
      ) : list.length === 0 ? (
        <EmptyState>{status === 'pending' ? 'No leave requests are waiting for a decision.' : 'No leave requests found.'}</EmptyState>
      ) : (
        <>
          <ul className={`divide-y divide-neutral-200 ${requests.loading ? 'opacity-60' : ''}`} aria-busy={requests.loading}>
            {list.map((request) => {
              const range = formatDayRange(request.startDate, request.endDate)
              const own = request.user?._id === meId
              const busy = busyId === request.leaveRequestId
              const reviewer = request.approvedBy?.name
              return (
                <li key={request.leaveRequestId} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-700">
                        {initials(request.user?.name)}
                      </div>
                      <div>
                        <p className="font-medium text-neutral-900">{request.user?.name || 'Unknown'}</p>
                        <p className="text-xs text-neutral-600">{request.user?.email}</p>
                      </div>
                    </div>
                    <ApprovalBadge status={request.approvalStatus} />
                  </div>
                  <p className="text-sm text-neutral-800">
                    <span className="font-medium">{range}</span> · {request.halfDay ? 'Half a day' : formatDays(request.days)} · {request.leaveTypeLabel || leaveTypeLabel(settings, request.leaveType)}
                    {request.team?.name ? ` · ${request.team.name}` : ''}
                  </p>
                  {Object.values(request.counts).filter(Boolean).length > 1 && (
                    <p className="text-xs text-neutral-600">
                      {request.counts.approved} approved · {request.counts.pending} awaiting approval · {request.counts.rejected} rejected
                    </p>
                  )}
                  {request.remarks && (
                    <div className="text-sm text-neutral-700">
                      <p className="text-xs font-semibold text-neutral-600">Employee's note</p>
                      <ExpandableText text={request.remarks} />
                    </div>
                  )}
                  {request.reviewRemarks && (
                    <div className="text-sm text-neutral-700">
                      <p className="text-xs font-semibold text-neutral-600">
                        Reviewer's reason{reviewer ? ` (${reviewer}${request.reviewedAt ? `, ${formatDateTime(request.reviewedAt)}` : ''})` : ''}
                      </p>
                      <ExpandableText text={request.reviewRemarks} />
                    </div>
                  )}
                  {request.counts.pending > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => approve(request)}
                        disabled={busy || own}
                        aria-label={`Approve leave of ${request.user?.name || 'this person'}, ${range}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reject(request)}
                        disabled={busy || own}
                        aria-label={`Reject leave of ${request.user?.name || 'this person'}, ${range}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Reject
                      </button>
                      {own && <span className="text-xs text-neutral-600">You can't review your own leave.</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <Pager pagination={requests.data?.pagination} shown={list.length} noun="requests" onPage={setPage} busy={requests.loading} />
        </>
      )}
    </section>
  )
}
