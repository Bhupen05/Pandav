import type { ReactNode } from 'react'
import { BTN } from '../buttons'
import type { useSelection } from './helpers'

// "Select all", the count, and the bulk buttons above a list
export function BulkBar({
  noun,
  selection,
  busy,
  onApprove,
  onReject,
  total,
}: {
  noun: string
  selection: ReturnType<typeof useSelection>
  busy: boolean
  onApprove: (ids: string[]) => void
  onReject: (ids: string[]) => void
  total: number
}) {
  const count = selection.selected.length
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={selection.allSelected}
          onChange={selection.toggleAll}
          disabled={total === 0}
          className="h-4 w-4 rounded border-neutral-300"
        />
        Select all {total} {noun}
      </label>
      <span className="text-sm text-neutral-500" aria-live="polite">
        {count === 0 ? 'None selected' : `${count} selected`}
      </span>
      <div className="flex gap-2 sm:ml-auto">
        <button type="button" disabled={count === 0 || busy} onClick={() => onApprove(selection.selected)} className={`${BTN.sm} ${BTN.success}`}>
          Approve selected
        </button>
        <button type="button" disabled={count === 0 || busy} onClick={() => onReject(selection.selected)} className={`${BTN.sm} ${BTN.danger}`}>
          Reject selected
        </button>
      </div>
    </div>
  )
}

// One thing waiting for a decision: what it is on the left, the buttons on the right
export function QueueItem({
  checkbox,
  children,
  actions,
}: {
  checkbox?: ReactNode
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-start">
      {checkbox && <div className="pt-0.5">{checkbox}</div>}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div>
    </li>
  )
}

export function Meta({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-xs text-neutral-500">{children}</p>
}
