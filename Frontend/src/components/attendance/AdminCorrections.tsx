import { useState } from 'react'
import { attendanceAPI, type AttendanceRecord } from '../../api/attendanceAPI'
import { useFeedback } from '../../context/useFeedback'
import { formatDateTime, formatDay, formatTime } from '../../utils/date'
import ExpandableText from './ExpandableText'
import { primaryButton, secondaryButton } from './fields'
import { describeError, initials } from './labels'
import Pager from './Pager'
import { EmptyState, ErrorState, Loading } from './States'
import { useLoad } from './useLoad'

const PAGE_SIZE = 10

// The "Corrections" tab: people who forgot to check out and say when they left.
// Applying sets the check-out time (PUT), which settles the request.
export default function AdminCorrections({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const { notify, confirm } = useFeedback()
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState('')

  const corrections = useLoad(
    () => attendanceAPI.listRecords({ hasCorrection: true, page, limit: PAGE_SIZE }),
    String(page),
    { refreshMs: 30000 },
  )

  const finish = async () => {
    await Promise.all([corrections.refresh(), onChanged()])
    setBusyId('')
  }

  const apply = async (record: AttendanceRecord) => {
    if (!record.correctionRequest) return
    setBusyId(record._id)
    try {
      await attendanceAPI.updateAttendance(record._id, { checkOutTime: record.correctionRequest.checkOutTime })
      notify(`Check-out set to ${formatTime(record.correctionRequest.checkOutTime)} for ${record.user?.name || 'the person'}, ${formatDay(record.day)}.`, 'success')
    } catch (error) {
      notify(describeError(error, 'Could not apply this correction.'), 'error')
    }
    await finish()
  }

  const decline = async (record: AttendanceRecord) => {
    const ok = await confirm({
      title: 'Decline this correction?',
      message: `${record.user?.name || 'This person'}, ${formatDay(record.day)}. The check-out time stays as it is.`,
      confirmLabel: 'Decline',
      danger: true,
    })
    if (!ok) return
    setBusyId(record._id)
    try {
      await attendanceAPI.updateAttendance(record._id, { correctionRequest: null })
      notify('Correction declined.', 'success')
    } catch (error) {
      notify(describeError(error, 'Could not decline this correction.'), 'error')
    }
    await finish()
  }

  const list = corrections.data?.data ?? []

  return (
    <section aria-labelledby="corrections-title" className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <h2 id="corrections-title" className="font-semibold text-neutral-900">Check-out corrections</h2>
        <p className="text-sm text-neutral-700">People who forgot to check out ask for the time they left to be applied.</p>
      </div>

      {corrections.error && !corrections.data ? (
        <div className="p-4"><ErrorState message={corrections.error} onRetry={corrections.reload} /></div>
      ) : corrections.loading && !corrections.data ? (
        <Loading label="Loading the corrections…" />
      ) : list.length === 0 ? (
        <EmptyState>No check-out corrections are waiting.</EmptyState>
      ) : (
        <>
          <ul className={`divide-y divide-neutral-200 ${corrections.loading ? 'opacity-60' : ''}`} aria-busy={corrections.loading}>
            {list.map((record) => {
              const asked = record.correctionRequest
              const busy = busyId === record._id
              return (
                <li key={record._id} className="space-y-3 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-700">
                      {initials(record.user?.name)}
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">{record.user?.name || 'Unknown'}</p>
                      <p className="text-xs text-neutral-600">{record.user?.email}</p>
                    </div>
                  </div>
                  <p className="text-sm text-neutral-800">
                    <span className="font-medium">{formatDay(record.day)}</span> · checked in at {formatTime(record.checkInTime)}
                    {record.checkOutTime ? `, checked out at ${formatTime(record.checkOutTime)}` : ', no check-out'}
                  </p>
                  {asked && (
                    <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-950">
                      <p>
                        Asks for a check-out at <span className="font-semibold">{formatDateTime(asked.checkOutTime)}</span>
                        {asked.requestedAt ? <span className="text-orange-900"> (asked {formatDateTime(asked.requestedAt)})</span> : null}
                      </p>
                      {asked.remarks && <ExpandableText text={asked.remarks} className="mt-1" />}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => apply(record)}
                      disabled={busy}
                      aria-label={`Apply the check-out time for ${record.user?.name || 'this person'}, ${formatDay(record.day)}`}
                      className={primaryButton}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => decline(record)}
                      disabled={busy}
                      aria-label={`Decline the correction for ${record.user?.name || 'this person'}, ${formatDay(record.day)}`}
                      className={secondaryButton}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <Pager pagination={corrections.data?.pagination} shown={list.length} noun="corrections" onPage={setPage} busy={corrections.loading} />
        </>
      )}
    </section>
  )
}
