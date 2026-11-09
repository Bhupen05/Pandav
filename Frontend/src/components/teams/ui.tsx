import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

// Small building blocks shared by the team pages. They follow the team
// pages' look: white cards, grey borders, blue actions.

// ── Avatar ─────────────────────────────────────────────────────────────────

const initialsOf = (name?: string) =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

const AVATAR_SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
}

export function Avatar({
  name,
  src,
  size = 'md',
  tone = 'bg-blue-100 text-blue-700',
  rounded = 'rounded-full',
}: {
  name?: string
  src?: string
  size?: keyof typeof AVATAR_SIZES
  tone?: string
  rounded?: string
}) {
  const [broken, setBroken] = useState(false)
  const showPhoto = Boolean(src) && !broken
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden font-bold ${rounded} ${AVATAR_SIZES[size]} ${showPhoto ? 'bg-gray-100' : tone}`}
    >
      {showPhoto ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}

// ── Badge ──────────────────────────────────────────────────────────────────

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

// ── States ─────────────────────────────────────────────────────────────────

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-hidden="true" />
      {label}
    </div>
  )
}

export function EmptyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">
      {children}
    </div>
  )
}

export function ErrorBlock({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-800">
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  )
}

// ── Frozen banner ──────────────────────────────────────────────────────────

export function FrozenBanner({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      {children}
    </div>
  )
}

// ── Pager ──────────────────────────────────────────────────────────────────

export function Pager({
  page,
  pages,
  total,
  onPage,
  label,
  disabled,
}: {
  page: number
  pages: number
  total: number
  onPage: (page: number) => void
  // What is being paged, e.g. "tasks"
  label: string
  disabled?: boolean
}) {
  if (pages <= 1) return null
  return (
    <nav aria-label={`Pages of ${label}`} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
      <p>
        Page {page} of {pages} · {total} {label}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={disabled || page <= 1}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={disabled || page >= pages}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  )
}

// ── Dialog ─────────────────────────────────────────────────────────────────

// A native modal dialog: focus stays inside it and Escape closes it (unless
// it is busy saving)
export function TeamDialog({
  title,
  description,
  onClose,
  busy,
  wide,
  children,
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  busy?: boolean
  wide?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const busyRef = useRef(busy)

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!busyRef.current) onClose()
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl backdrop:bg-black/50 sm:p-6 ${
        wide ? 'max-w-lg' : 'max-w-md'
      }`}
    >
      <h3 id={titleId} className="text-lg font-semibold text-gray-900">
        {title}
      </h3>
      {description && <div className="mt-1 text-sm text-gray-500">{description}</div>}
      <div className="mt-4">{children}</div>
    </dialog>
  )
}

export const inputClass =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30'

export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'

export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export const dangerOutlineButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50'

// "12/80" under a field with a length limit
export function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <span className={`text-xs ${value.length > max ? 'text-red-600' : 'text-gray-400'}`}>
      {value.length}/{max}
    </span>
  )
}
