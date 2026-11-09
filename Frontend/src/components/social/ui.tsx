import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCcw } from 'lucide-react'
import { initials } from './format'
import { badgeClass, secondaryButton, smallButton } from './styles'
import type { Person } from './types'

export function SectionCard({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  id?: string
}) {
  const headingId = id ? `${id}-heading` : undefined
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-[28px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.25)] backdrop-blur sm:p-5"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-extrabold tracking-tight text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

const avatarSizes = {
  sm: 'h-8 w-8 rounded-xl text-[11px]',
  md: 'h-11 w-11 rounded-2xl text-sm',
}

// A photo, or the person's initials when there is none (or it fails to load)
export function Avatar({ person, size = 'md' }: { person: Person | null | undefined; size?: keyof typeof avatarSizes }) {
  const [broken, setBroken] = useState(false)
  const image = person?.profileImage
  if (image && !broken) {
    return (
      <img
        src={image}
        alt=""
        onError={() => setBroken(true)}
        className={`${avatarSizes[size]} shrink-0 object-cover shadow-sm`}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={`${avatarSizes[size]} flex shrink-0 items-center justify-center bg-slate-900 font-bold text-white shadow-sm`}
    >
      {initials(person?.name)}
    </div>
  )
}

export function Badge({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return (
    <span className={`${badgeClass} ${className}`} title={title}>
      {children}
    </span>
  )
}

// Disabled and showing a spinner while its action runs
export function BusyButton({
  busy,
  busyLabel,
  icon,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string; icon?: ReactNode }) {
  return (
    <button type="button" {...props} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-8 text-sm text-slate-600">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{message}</span>
      </span>
      {onRetry ? (
        <BusyButton busy={retrying} onClick={onRetry} className={`${secondaryButton} ${smallButton}`} icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />}>
          Retry
        </BusyButton>
      ) : null}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

// "Show more" under a list that only shows its first few items, and
// "Show fewer" once it has been expanded
export function ShowMore({
  limit,
  initial,
  total,
  onMore,
  onLess,
  noun = 'more',
}: {
  limit: number
  initial: number
  total: number
  onMore: () => void
  onLess: () => void
  noun?: string
}) {
  if (total > limit) {
    return (
      <div className="mt-3 flex justify-center">
        <button type="button" onClick={onMore} className={`${secondaryButton} ${smallButton}`}>
          Show more ({total - limit} {noun})
        </button>
      </div>
    )
  }
  if (limit > initial && total > initial) {
    return (
      <div className="mt-3 flex justify-center">
        <button type="button" onClick={onLess} className={`${secondaryButton} ${smallButton}`}>
          Show fewer
        </button>
      </div>
    )
  }
  return null
}
