import type { ReactNode } from 'react'
import type { Pagination } from '../../../api/adminAPI'
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
  partial = false,
}: {
  noun: string
  selection: ReturnType<typeof useSelection>
  busy: boolean
  onApprove: (ids: string[]) => void
  onReject: (ids: string[]) => void
  total: number
  // More of the list is still to be loaded: "all" means the ones showing
  partial?: boolean
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
        Select all {total}{partial ? ' loaded' : ''} {noun}
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

// "Showing 50 of 312" and the button that loads the next page, under a list read a page at a time
export function LoadMore({
  noun,
  shown,
  pagination,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  noun: string
  shown: number
  pagination?: Pagination
  hasMore: boolean
  loading: boolean
  error: string
  onLoadMore: () => void
}) {
  // Records that belong to a leave request are listed under Leave, so `shown` may be below the
  // rows loaded; the total is the server's count of everything in the queue
  if (!hasMore && !error) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="text-sm text-neutral-600" aria-live="polite">
        Showing {shown}
        {pagination ? ` of ${pagination.total}` : ''} {noun}
      </p>
      {hasMore && (
        <button type="button" onClick={onLoadMore} disabled={loading} className={`${BTN.sm} ${BTN.neutral}`}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
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
