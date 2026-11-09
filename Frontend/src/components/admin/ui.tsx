import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { TONE_CLASSES, type Tone } from './labels'
import { errorText, initials } from './format'

// The blue-to-green band at the top of the admin pages
export function AdminHeader({
  title,
  subtitle,
  back,
  actions,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: { to: string; label: string }
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="bg-linear-to-r from-blue-600 to-emerald-600 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 md:flex-row md:items-center md:justify-between md:py-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-white/90">{subtitle}</p>}
          {children}
        </div>
        {(back || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {back && (
              <Link
                to={back.to}
                className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {back.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex justify-center py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" />
    </div>
  )
}

// A failed request, with the server's message and a way to try again
export function ErrorNotice({ error, fallback, onRetry, compact = false }: { error: unknown; fallback: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700 ${compact ? 'p-3' : 'p-4'}`}
    >
      <p className="min-w-0 flex-1">{errorText(error, fallback)}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">
      {children}
    </div>
  )
}

// Loading, error and empty states around a list; `children` renders the data
export function Loadable<T>({
  data,
  error,
  loading,
  onRetry,
  errorFallback,
  isEmpty,
  empty,
  children,
}: {
  data: T | undefined
  error: unknown
  loading: boolean
  onRetry: () => void
  errorFallback: string
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  children: (data: T) => ReactNode
}) {
  return (
    <>
      {error !== undefined && (
        <div className="mb-3">
          <ErrorNotice error={error} fallback={errorFallback} onRetry={onRetry} compact />
        </div>
      )}
      {data === undefined ? (
        loading ? <Spinner /> : null
      ) : isEmpty?.(data) ? (
        empty ? <EmptyState>{empty}</EmptyState> : null
      ) : (
        children(data)
      )}
    </>
  )
}

export function Avatar({ name, image, size = 'md' }: { name?: string | null; image?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  const classes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl' }[size]
  if (image && !broken) {
    return <img src={image} alt="" onError={() => setBroken(true)} className={`${classes} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span aria-hidden="true" className={`${classes} inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-100 font-bold text-neutral-700`}>
      {initials(name)}
    </span>
  )
}

// Previous / next, for lists the server pages
export function Pager({
  page,
  pages,
  total,
  onPage,
  label,
  disabled = false,
}: {
  page: number
  pages: number
  total?: number
  onPage: (page: number) => void
  label: string
  disabled?: boolean
}) {
  if (pages <= 1) return null
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-600">
      <p>
        Page {page} of {pages}
        {total !== undefined && <span className="text-neutral-400"> · {total} in all</span>}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={disabled || page <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={disabled || page >= pages}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

// Long text, shortened until "Show more" is pressed
export function CollapsibleText({ text, limit = 400, className = '' }: { text: string; limit?: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const lines = text.split('\n').length
  const long = text.length > limit || lines > 6
  return (
    <div className={className}>
      <p id={id} className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-700 ${long && !open ? 'line-clamp-5' : ''}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="mt-1 text-xs font-semibold text-emerald-700 hover:underline"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

// A small figure tile
export function StatTile({ label, value, tone = 'text-neutral-900', hint, to }: { label: string; value: ReactNode; tone?: string; hint?: ReactNode; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="block rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">{body}</div>
  )
}
