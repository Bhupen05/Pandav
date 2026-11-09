import { useCallback, useId, useState } from 'react'
import { teamAPI } from '../../api/teamAPI'
import { ApprovalBadge, DayTypeBadge } from './badges'
import { APPROVAL_LABELS, dayIn, formatDay, formatHours, formatTime, SERVER_TIME_ZONE } from './format'
import { useLoader } from './hooks'
import { attendanceReviewable, type TeamReviews } from './reviews'
import type { AttendanceRecord, ListResponse, Team } from './types'
import { EmptyBlock, ErrorBlock, inputClass, LoadingBlock, Pager } from './ui'

const PAGE_SIZE = 20

type Props = {
  team: Team
  meId?: string
  // A leader of a team that isn't frozen
  canAct: boolean
  frozen: boolean
  version: number
  // Pending records the signed-in leader can review right now
  reviewableIds: Set<string>
  reviews: TeamReviews
}

export default function TeamAttendancePanel({ team, meId, canAct, frozen, version, reviewableIds, reviews }: Props) {
  const statusId = useId()
  const fromId = useId()
  const toId = useId()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const today = dayIn(SERVER_TIME_ZONE)

  const load = useCallback(
    () =>
      teamAPI.getTeamAttendance(team._id, {
        status,
        startDate: from,
        endDate: to,
        page,
        limit: PAGE_SIZE,
      }) as Promise<ListResponse<AttendanceRecord>>,
    [team._id, status, from, to, page],
  )
  const loader = useLoader(load, 'Could not load the team’s attendance.', version)
  const records = loader.data?.data ?? []
  const filtered = Boolean(status || from || to)

  const change = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const reviewNote = (record: AttendanceRecord) => {
    if (record.approvalStatus !== 'pending') return null
    if (frozen) return 'Waiting for an admin'
    if (record.user?._id === meId) return 'An admin or another leader reviews yours'
    if (!attendanceReviewable(record, today)) return 'Not checked out yet'
    return null
  }

  return (
    <section aria-labelledby="team-attendance-heading">
      <h2 id="team-attendance-heading" className="mb-4 text-lg font-semibold text-gray-800">
        Team Attendance
      </h2>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={statusId} className="text-sm font-medium text-gray-700">
            Approval
          </label>
          <select id={statusId} value={status} onChange={(event) => change(() => setStatus(event.target.value))} className={inputClass}>
            <option value="">All records</option>
            {Object.entries(APPROVAL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fromId} className="text-sm font-medium text-gray-700">
            From
          </label>
          <input id={fromId} type="date" value={from} max={to || undefined} onChange={(event) => change(() => setFrom(event.target.value))} className={inputClass} />
        </div>
        <div>
          <label htmlFor={toId} className="text-sm font-medium text-gray-700">
            To
          </label>
          <input id={toId} type="date" value={to} min={from || undefined} onChange={(event) => change(() => setTo(event.target.value))} className={inputClass} />
        </div>
      </div>

      {frozen && (
        <p className="mb-4 text-sm text-gray-600">Attendance can’t be reviewed while the team is frozen. Reviews wait for an admin.</p>
      )}

      {loader.error ? (
        <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
      ) : loader.loading && !loader.data ? (
        <LoadingBlock label="Loading attendance…" />
      ) : records.length === 0 ? (
        <EmptyBlock>{filtered ? 'No attendance records match these filters.' : 'No attendance records yet.'}</EmptyBlock>
      ) : (
        <>
          <div
            className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm ${loader.loading ? 'opacity-60' : ''}`}
            aria-busy={loader.loading}
          >
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Member</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Check In</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Check Out</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Hours</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((record) => {
                  const canReview = canAct && reviewableIds.has(record._id) && attendanceReviewable(record, today)
                  const busy = reviews.isAttendanceBusy(record)
                  const note = canReview ? null : reviewNote(record)
                  return (
                    <tr key={record._id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {record.user?.name ?? 'Former member'}
                        {record.user?._id === meId && <span className="ml-1 text-xs font-normal text-gray-500">(you)</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDay(record.day ?? record.date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatTime(record.checkInTime)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {formatTime(record.checkOutTime)}
                        {record.missedCheckout && <p className="mt-0.5 text-xs text-amber-700">Missed check-out</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatHours(record.workHours)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <DayTypeBadge status={record.status} />
                          <ApprovalBadge status={record.approvalStatus} />
                        </div>
                        {record.remarks && <p className="mt-1 text-xs text-gray-500">Note: {record.remarks}</p>}
                        {record.reviewRemarks && (
                          <p className="mt-1 text-xs text-gray-500">
                            {record.approvedBy?.name ? `${record.approvedBy.name}: ` : 'Review: '}
                            {record.reviewRemarks}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {canReview ? (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void reviews.approveAttendance(record)}
                              disabled={busy}
                              aria-label={`Approve attendance of ${record.user?.name ?? 'this person'} on ${formatDay(record.day ?? record.date)}`}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void reviews.rejectAttendance(record)}
                              disabled={busy}
                              aria-label={`Reject attendance of ${record.user?.name ?? 'this person'} on ${formatDay(record.day ?? record.date)}`}
                              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">{note ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={loader.data?.pagination?.page ?? page}
            pages={loader.data?.pagination?.pages ?? 1}
            total={loader.data?.pagination?.total ?? records.length}
            onPage={setPage}
            label="records"
            disabled={loader.loading}
          />
        </>
      )}
    </section>
  )
}
