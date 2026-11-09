import { useState, type FormEvent } from 'react'
import { attendanceAPI, type AttendanceSettings, type Holiday, type LeaveRequest } from '../../api/attendanceAPI'
import type { FeedbackContextType } from '../../context/useFeedback'
import { formatDateTime, formatDay, formatDayRange } from '../../utils/date'
import { ApprovalBadge } from './Badges'
import ExpandableText from './ExpandableText'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { countWorkdays, describeError, formatDays, leaveTypeLabel } from './labels'
import Pager from './Pager'
import { EmptyState, ErrorState, Loading } from './States'
import { useLoad } from './useLoad'

type Props = {
  userId: string
  settings?: AttendanceSettings
  settingsError?: string
  onRetrySettings: () => void
  holidays: Holiday[]
  // Called after a request is made or withdrawn, so the records load again
  onChanged: () => void
  notify: FeedbackContextType['notify']
  confirm: FeedbackContextType['confirm']
}

const PAGE_SIZE = 10

// The "Leave" tab: balance per type, the request form and the person's own requests
export default function LeavePanel({ userId, settings, settingsError, onRetrySettings, holidays, onChanged, notify, confirm }: Props) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [leaveTypeKey, setLeaveTypeKey] = useState('')
  const [halfDay, setHalfDay] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [page, setPage] = useState(1)
  const [withdrawing, setWithdrawing] = useState('')

  const leaveType = leaveTypeKey || settings?.leaveTypes[0]?.key || ''
  const singleDay = !!startDate && (!endDate || endDate === startDate)

  // The balance is per calendar year: the year of the first day asked for
  const yearValue = Number(startDate.slice(0, 4))
  const year = yearValue >= 2000 && yearValue <= 2100 ? yearValue : new Date().getFullYear()
  const balance = useLoad(() => attendanceAPI.getLeaveBalance({ year }), String(year))
  const requests = useLoad(
    () => attendanceAPI.getLeaveRequests({ user: userId, page, limit: PAGE_SIZE }),
    `${userId}:${page}`,
  )

  const holidayDays = new Set(holidays.map((holiday) => holiday.day))
  const needed =
    startDate && settings
      ? halfDay
        ? 0.5
        : countWorkdays(startDate, endDate || startDate, settings.workdays, holidayDays)
      : null
  const typeBalance = balance.data?.data.types.find((type) => type.key === leaveType)

  const onStartChange = (value: string) => {
    setStartDate(value)
    if (!endDate || endDate < value) setEndDate(value)
    if (halfDay && endDate && endDate !== value) setHalfDay(false)
  }
  const onEndChange = (value: string) => {
    setEndDate(value)
    if (value !== startDate) setHalfDay(false)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!startDate) {
      setFormError('Choose the first day of your leave.')
      return
    }
    if (!leaveType) {
      setFormError('Choose a type of leave.')
      return
    }
    if ((endDate || startDate) < startDate) {
      setFormError('The last day must be on or after the first day.')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const response = await attendanceAPI.requestLeave({
        startDate,
        endDate: endDate || startDate,
        leaveType,
        halfDay: halfDay || undefined,
        remarks: remarks.trim() || undefined,
      })
      const request = response.data
      notify(
        `Leave requested for ${formatDayRange(request.startDate, request.endDate)} (${formatDays(request.days)}). It is waiting for approval.`,
        'success',
      )
      setStartDate('')
      setEndDate('')
      setHalfDay(false)
      setRemarks('')
      setPage(1)
      requests.refresh()
      balance.refresh()
      onChanged()
    } catch (failure) {
      // 409: some of the days already have a record; the server lists them
      const body = failure as { status?: number; data?: { data?: { days?: string[] } } }
      const days = body.status === 409 ? body.data?.data?.days : undefined
      setFormError(
        days && days.length > 0
          ? `You already have attendance on ${days.map((day) => formatDay(day)).join('; ')}. Choose other days, or withdraw the earlier request first.`
          : describeError(failure, 'Could not send your leave request.'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const withdraw = async (request: LeaveRequest) => {
    const range = formatDayRange(request.startDate, request.endDate)
    const ok = await confirm({
      title: 'Withdraw this leave request?',
      message: `${range}. The days still waiting for approval are removed; days already decided stay.`,
      confirmLabel: 'Withdraw',
      danger: true,
    })
    if (!ok) return
    setWithdrawing(request.leaveRequestId)
    try {
      const response = await attendanceAPI.withdrawLeave(request.leaveRequestId)
      notify(response.message || 'Leave request withdrawn', 'success')
      requests.refresh()
      balance.refresh()
      onChanged()
    } catch (failure) {
      notify(describeError(failure, 'Could not withdraw this leave request.'), 'error')
    } finally {
      setWithdrawing('')
    }
  }

  const list = requests.data?.data ?? []

  return (
    <div className="space-y-6">
      <section aria-labelledby="leave-balance-title" className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 id="leave-balance-title" className="text-lg font-semibold text-neutral-900">Your leave balance for {year}</h2>
        {balance.error && !balance.data ? (
          <div className="mt-3"><ErrorState message={balance.error} onRetry={balance.reload} /></div>
        ) : balance.loading && !balance.data ? (
          <Loading label="Loading your balance…" />
        ) : (
          <ul aria-label="Leave balance" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balance.data?.data.types.map((type) => (
              <li key={type.key} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-sm font-medium text-neutral-900">{type.label}</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">
                  {type.remaining === null ? 'No limit' : `${type.remaining} ${type.remaining === 1 ? 'day' : 'days'} left`}
                </p>
                <p className="mt-0.5 text-xs text-neutral-600">
                  {type.allowance === null ? 'No yearly limit' : `of ${type.allowance} a year`} · {type.approved} used · {type.pending} awaiting approval
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="leave-form-title" className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 id="leave-form-title" className="text-lg font-semibold text-neutral-900">Request leave</h2>
          {settingsError && !settings ? (
            <div className="mt-3"><ErrorState message={settingsError} onRetry={onRetrySettings} /></div>
          ) : (
            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="leave-start" className={labelClass}>First day</label>
                  <input id="leave-start" type="date" value={startDate} onChange={(event) => onStartChange(event.target.value)} required className={inputClass} />
                </div>
                <div>
                  <label htmlFor="leave-end" className={labelClass}>Last day</label>
                  <input id="leave-end" type="date" value={endDate} min={startDate || undefined} onChange={(event) => onEndChange(event.target.value)} required className={inputClass} />
                </div>
              </div>
              <div>
                <label htmlFor="leave-type" className={labelClass}>Type of leave</label>
                <select id="leave-type" value={leaveType} onChange={(event) => setLeaveTypeKey(event.target.value)} required className={inputClass}>
                  {!settings && <option value="">Loading…</option>}
                  {settings?.leaveTypes.map((type) => (
                    <option key={type.key} value={type.key}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="leave-half" className="flex items-center gap-2 text-sm text-neutral-800">
                  <input
                    id="leave-half"
                    type="checkbox"
                    checked={halfDay}
                    disabled={!singleDay}
                    onChange={(event) => setHalfDay(event.target.checked)}
                    className="h-4 w-4 rounded border-neutral-400"
                  />
                  Half day
                </label>
                <p className="mt-1 text-xs text-neutral-600">A half day can only be a single day.</p>
              </div>
              <div>
                <label htmlFor="leave-remarks" className={labelClass}>Remarks (optional)</label>
                <textarea id="leave-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} rows={3} className={inputClass} />
                <p className="mt-1 text-xs text-neutral-600">{remarks.length}/1000 characters</p>
              </div>

              {needed !== null && (
                <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-800" aria-live="polite">
                  {needed === 0
                    ? 'There are no workdays in that range: weekends and holidays need no leave.'
                    : `This asks for ${formatDays(needed).toLowerCase()} of ${leaveTypeLabel(settings, leaveType).toLowerCase()}. Weekends and holidays are skipped.`}
                  {needed > 0 && typeBalance && typeBalance.remaining !== null && (
                    <span className={needed > typeBalance.remaining ? 'font-medium text-red-700' : ''}>
                      {' '}
                      {needed > typeBalance.remaining
                        ? `You only have ${formatDays(typeBalance.remaining).toLowerCase()} left, so the request will be refused.`
                        : `${formatDays(typeBalance.remaining - needed)} would be left.`}
                    </span>
                  )}
                </p>
              )}

              {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}

              <button type="submit" disabled={submitting || !settings} className={primaryButton}>
                {submitting ? 'Sending…' : 'Request leave'}
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="leave-requests-title" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <h2 id="leave-requests-title" className="px-5 pt-5 text-lg font-semibold text-neutral-900">My leave requests</h2>
          {requests.error && !requests.data ? (
            <div className="p-5"><ErrorState message={requests.error} onRetry={requests.reload} /></div>
          ) : requests.loading && !requests.data ? (
            <Loading label="Loading your requests…" />
          ) : list.length === 0 ? (
            <EmptyState>You have not asked for leave yet.</EmptyState>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-neutral-200 border-t border-neutral-200">
                {list.map((request) => {
                  const range = formatDayRange(request.startDate, request.endDate)
                  const reviewer = request.approvedBy?.name
                  const mixed = Object.values(request.counts).filter(Boolean).length > 1
                  return (
                    <li key={request.leaveRequestId} className="space-y-2 px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-neutral-900">{range}</p>
                          <p className="text-sm text-neutral-600">
                            {request.halfDay ? 'Half a day' : formatDays(request.days)} · {request.leaveTypeLabel || leaveTypeLabel(settings, request.leaveType)}
                          </p>
                        </div>
                        <ApprovalBadge status={request.approvalStatus} />
                      </div>
                      {mixed && (
                        <p className="text-xs text-neutral-600">
                          {request.counts.approved} approved · {request.counts.pending} awaiting approval · {request.counts.rejected} rejected
                        </p>
                      )}
                      {request.remarks && (
                        <div className="text-sm text-neutral-700">
                          <p className="text-xs font-semibold text-neutral-600">Your note</p>
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
                        <button
                          type="button"
                          onClick={() => withdraw(request)}
                          disabled={withdrawing === request.leaveRequestId}
                          aria-label={`Withdraw leave request for ${range}`}
                          className={secondaryButton}
                        >
                          {withdrawing === request.leaveRequestId ? 'Withdrawing…' : 'Withdraw'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              <Pager pagination={requests.data?.pagination} shown={list.length} noun="requests" onPage={setPage} busy={requests.loading} />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
