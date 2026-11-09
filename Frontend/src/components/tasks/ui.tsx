import { AlertTriangle, RefreshCw } from 'lucide-react'
import { PRIORITY_BADGE, PRIORITY_LABEL, STATUS_BADGE, STATUS_LABEL } from './taskFormat'
import type { TaskPriority, TaskStatus } from './types'

// Small pieces the task screens share

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-neutral-100 text-neutral-700'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority?: TaskPriority }) {
  const value = priority || 'medium'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[value] ?? 'bg-neutral-100 text-neutral-700'}`}>
      {PRIORITY_LABEL[value] ?? value}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-12 text-sm font-medium text-neutral-600">
      <span aria-hidden="true" className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" />
      {label}
    </div>
  )
}

// A failed request, with a way to try again
export function InlineError({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center">
      <AlertTriangle aria-hidden="true" className="h-6 w-6 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-red-800">{title}</p>
        <p className="wrap-break-word text-sm text-red-700">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  )
}
