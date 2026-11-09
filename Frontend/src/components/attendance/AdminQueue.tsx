import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { attendanceAPI, type AttendanceRecord } from '../../api/attendanceAPI'
import type { FeedbackContextType } from '../../context/useFeedback'
import { formatDay, formatTime } from '../../utils/date'
import { DayTypeBadge } from './Badges'
import { describeError, initials } from './labels'

type Props = {
  records: AttendanceRecord[]
  total: number
  meId: string
  today: string
  busyId: string
  onApprove: (record: AttendanceRecord) => void
  onReject: (record: AttendanceRecord) => void
  // Loads the lists again after a bulk review
  onChanged: () => Promise<unknown>
  notify: FeedbackContextType['notify']
  confirm: FeedbackContextType['confirm']
  prompt: FeedbackContextType['prompt']
}

// A record can't be reviewed on the day it is still open, nor by its owner
const canReview = (record: AttendanceRecord, today: string, meId: string) =>
  record.user?._id !== meId && !(record.day === today && record.checkInTime && !record.checkOutTime)

// Everything waiting for a decision, with select-all and bulk Approve / Reject
export default function AdminQueue({ records, total, meId, today, busyId, onApprove, onReject, onChanged, notify, confirm, prompt }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  const allBox = useRef<HTMLInputElement>(null)

  const reviewable = records.filter((record) => canReview(record, today, meId))
  // Only what is still in the queue counts as selected
  const chosen = reviewable.filter((record) => selected.has(record._id)).map((record) => record._id)
  const allSelected = reviewable.length > 0 && chosen.length === reviewable.length

  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = chosen.length > 0 && !allSelected
  }, [chosen.length, allSelected])

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(reviewable.map((record) => record._id)))

  const bulk = async (action: 'approve' | 'reject') => {
    if (chosen.length === 0) return
    let reason: string | undefined
    if (action === 'reject') {
      const answer = await prompt({
        title: `Reject ${chosen.length} ${chosen.length === 1 ? 'record' : 'records'}?`,
        message: 'The reason is kept on every one of them and shown to the people concerned.',
        label: 'Reason',
        confirmLabel: 'Reject',
        danger: true,
      })
      if (answer === null) return
      reason = answer.trim() || undefined
    } else if (!(await confirm({ title: `Approve ${chosen.length} ${chosen.length === 1 ? 'record' : 'records'}?`, confirmLabel: 'Approve' }))) {
      return
    }

    setWorking(true)
    try {
      const response = await attendanceAPI.bulkReview(chosen, action, reason)
      const { failed, results } = response.data
      const problems = [...new Set(results.filter((result) => !result.ok).map((result) => result.message || 'Failed'))]
      notify(
        failed > 0 ? `${response.message}. ${failed} could not be changed: ${problems.join('; ')}.` : response.message,
        failed > 0 ? 'error' : 'success',
      )
      setSelected(new Set())
    } catch (error) {
      notify(describeError(error, 'Could not review these records.'), 'error')
    }
    await onChanged()
    setWorking(false)
  }

  if (records.length === 0) return null
  const disabled = working || chosen.length === 0

  return (
    <section aria-labelledby="queue-title" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="queue-title" className="text-lg font-semibold text-amber-950">Waiting for approval ({total})</h2>
          {total > records.length && (
            <p className="text-xs text-amber-900">Showing the first {records.length}. The rest appear as these are reviewed.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm text-neutral-800">
            <input ref={allBox} type="checkbox" checked={allSelected} onChange={toggleAll} disabled={working || reviewable.length === 0} className="h-4 w-4" />
            Select all
          </label>
          <button
            type="button"
            onClick={() => bulk('approve')}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Approve selected{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => bulk('reject')}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Reject selected{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {records.map((record) => {
          const review = canReview(record, today, meId)
          const busy = busyId === record._id || working
          const name = record.user?.name || 'Unknown'
          return (
            <li key={record._id} className="flex flex-col gap-3 rounded-xl bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={chosen.includes(record._id)}
                  disabled={!review || working}
                  onChange={() => toggle(record._id)}
                  aria-label={`Select ${name}, ${formatDay(record.day)}`}
                  className="h-4 w-4 shrink-0"
                />
                <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-900">
                  {initials(record.user?.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-700">
                    {formatDay(record.day)}
                    <DayTypeBadge status={record.status} />
                    {record.checkInTime && <span>in {formatTime(record.checkInTime)}</span>}
                    {record.checkOutTime && <span>out {formatTime(record.checkOutTime)}</span>}
                    {!review && record.user?._id !== meId && <span className="font-medium">Not checked out yet</span>}
                    {record.user?._id === meId && <span className="font-medium">Your own day</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onApprove(record)}
                  disabled={busy || !review}
                  aria-label={`Approve ${name}, ${formatDay(record.day)}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onReject(record)}
                  disabled={busy || !review}
                  aria-label={`Reject ${name}, ${formatDay(record.day)}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
