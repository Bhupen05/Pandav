import type { ReactNode } from 'react'
import { secondaryButton } from './fields'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-600">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={secondaryButton}>
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-neutral-600">{children}</p>
}
