import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { adminAPI, type AuditEvent, type AuditQuery } from '../api/adminAPI'
import { useFeedback } from '../context/useFeedback'
import { AdminHeader, Badge, ErrorNotice, Spinner } from '../components/admin/ui'
import { PersonPicker, type PickedPerson } from '../components/admin/PersonPicker'
import { useResource } from '../components/admin/useResource'
import { useBusy } from '../components/admin/useBusy'
import { errorText, formatDateTime } from '../components/admin/format'
import { auditActionLabel, roleLabel } from '../components/admin/labels'
import { BTN, FIELD, LABEL } from '../components/admin/buttons'

const PAGE_SIZE = 50
const OBJECT_ID = /^[a-f0-9]{24}$/i

type Feed = { key: string; events: AuditEvent[]; hasMore: boolean; error?: unknown }

// "adminRole" and "admin_role" both read "Admin role"
const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export default function AuditLog() {
  const { notify } = useFeedback()
  const { run, isBusy } = useBusy()
  const [params, setParams] = useSearchParams()

  const applied = useMemo(
    () => ({
      action: params.get('action') ?? '',
      status: params.get('status') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
      actor: params.get('actor') ?? '',
      actorName: params.get('actorName') ?? '',
      targetType: params.get('targetType') ?? '',
      targetId: params.get('targetId') ?? '',
    }),
    [params],
  )

  const query = useMemo<AuditQuery>(
    () => ({
      action: applied.action || undefined,
      status: applied.status === 'success' || applied.status === 'failed' ? applied.status : undefined,
      from: applied.from || undefined,
      to: applied.to || undefined,
      actor: applied.actor || undefined,
      targetType: applied.targetType || undefined,
      targetId: applied.targetId || undefined,
      limit: PAGE_SIZE,
    }),
    [applied],
  )

  // The form is edited freely and only applied (put in the URL) on Search
  const [draft, setDraft] = useState(applied)
  const [picked, setPicked] = useState<PickedPerson | null>(
    applied.actor && applied.actorName ? { id: applied.actor, name: applied.actorName } : null,
  )
  const [formError, setFormError] = useState('')
  const actionsList = useResource(useMemo(() => (signal: AbortSignal) => adminAPI.getAuditActions({ signal }), []))

  const [reloadToken, setReloadToken] = useState(0)
  const [feed, setFeed] = useState<Feed | null>(null)
  const key = `${JSON.stringify(query)}#${reloadToken}`

  useEffect(() => {
    const controller = new AbortController()
    adminAPI.getAudit(query, { signal: controller.signal }).then(
      (page) => {
        if (!controller.signal.aborted) setFeed({ key, events: page.data, hasMore: page.hasMore })
      },
      (error) => {
        if (!controller.signal.aborted) setFeed({ key, events: [], hasMore: false, error })
      },
    )
    return () => controller.abort()
  }, [query, key])

  const current = feed && feed.key === key ? feed : null

  const loadMore = () => {
    if (!current || !current.hasMore || current.events.length === 0) return
    const last = current.events[current.events.length - 1]
    void run('more', async () => {
      try {
        const page = await adminAPI.getAudit({ ...query, before: last._id })
        // Filters may have changed while this was loading: then it is dropped
        setFeed((previous) =>
          previous && previous.key === key ? { ...previous, events: [...previous.events, ...page.data], hasMore: page.hasMore } : previous,
        )
      } catch (error) {
        notify(errorText(error, 'Could not load older events'), 'error')
      }
    })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const actorId = picked ? picked.id : draft.actor.trim()
    if (actorId && !OBJECT_ID.test(actorId)) {
      setFormError("That doesn't look like a person's id. Pick the person from the search instead.")
      return
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setFormError('The start date is after the end date.')
      return
    }
    setFormError('')
    const next = new URLSearchParams()
    const values: Record<string, string> = {
      action: draft.action,
      status: draft.status,
      from: draft.from,
      to: draft.to,
      actor: actorId,
      actorName: picked && actorId ? picked.name : '',
      targetType: draft.targetType.trim(),
      targetId: draft.targetId.trim(),
    }
    for (const [name, value] of Object.entries(values)) if (value) next.set(name, value)
    setParams(next)
  }

  const clear = () => {
    setDraft({ action: '', status: '', from: '', to: '', actor: '', actorName: '', targetType: '', targetId: '' })
    setPicked(null)
    setFormError('')
    setParams(new URLSearchParams())
  }

  const filtered = Object.entries(applied).some(([name, value]) => name !== 'actorName' && value)
  const actionOptions = useMemo(() => {
    const list = actionsList.data ?? []
    return applied.action && !list.includes(applied.action) ? [...list, applied.action] : list
  }, [actionsList.data, applied.action])

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <AdminHeader title="Audit log" subtitle="Who did what, newest first." back={{ to: '/admin', label: 'Back to dashboard' }} />

      <div className="mx-auto max-w-5xl px-4 py-6">
        <form onSubmit={onSubmit} aria-label="Filter the audit log" className="mb-5 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="audit-action" className={LABEL}>Action</label>
              <select id="audit-action" value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })} className={FIELD}>
                <option value="">Any action</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {auditActionLabel(action)}
                  </option>
                ))}
              </select>
              {actionsList.error !== undefined && <p className="mt-1 text-xs text-red-600">The list of actions did not load.</p>}
            </div>
            <div>
              <label htmlFor="audit-status" className={LABEL}>Result</label>
              <select id="audit-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className={FIELD}>
                <option value="">Any result</option>
                <option value="success">Succeeded</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label htmlFor="audit-from" className={LABEL}>From</label>
              <input id="audit-from" type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} className={FIELD} />
            </div>
            <div>
              <label htmlFor="audit-to" className={LABEL}>To</label>
              <input id="audit-to" type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className={FIELD} />
            </div>
            <div className="sm:col-span-2">
              <PersonPicker label="Done by" value={picked} onChange={setPicked} />
            </div>
            <div>
              <label htmlFor="audit-actor" className={LABEL}>Or a person&apos;s id</label>
              <input
                id="audit-actor"
                value={picked ? picked.id : draft.actor}
                disabled={Boolean(picked)}
                onChange={(event) => setDraft({ ...draft, actor: event.target.value })}
                placeholder="24-character id"
                className={FIELD}
              />
            </div>
            <div className="hidden lg:block" />
            <div>
              <label htmlFor="audit-target-type" className={LABEL}>Done to (kind)</label>
              <input
                id="audit-target-type"
                value={draft.targetType}
                onChange={(event) => setDraft({ ...draft, targetType: event.target.value })}
                placeholder="For example Task or User"
                className={FIELD}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="audit-target-id" className={LABEL}>Done to (id)</label>
              <input id="audit-target-id" value={draft.targetId} onChange={(event) => setDraft({ ...draft, targetId: event.target.value })} className={FIELD} />
            </div>
          </div>
          {formError && (
            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button type="submit" className={`${BTN.md} ${BTN.primary}`}>Search</button>
            {(filtered || draft.action || draft.status || draft.from || draft.to || picked || draft.actor || draft.targetType || draft.targetId) && (
              <button type="button" onClick={clear} className={`${BTN.md} ${BTN.neutral}`}>Clear filters</button>
            )}
          </div>
        </form>

        {current?.error !== undefined && (
          <ErrorNotice error={current.error} fallback="Could not load the audit log" onRetry={() => setReloadToken((value) => value + 1)} />
        )}
        {!current && <Spinner label="Loading the audit log" />}

        {current && current.error === undefined && current.events.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">
            {filtered ? 'No events match these filters.' : 'Nothing has been recorded yet.'}
          </div>
        )}

        {current && current.events.length > 0 && (
          <>
            <p className="mb-2 text-sm text-neutral-600" aria-live="polite">
              Showing {current.events.length} {current.events.length === 1 ? 'event' : 'events'}, newest first
            </p>
            <ol className="space-y-2">
              {current.events.map((event) => (
                <EventRow key={event._id} event={event} />
              ))}
            </ol>
            <div className="mt-4 text-center">
              {current.hasMore ? (
                <button type="button" onClick={loadMore} disabled={isBusy('more')} className={`${BTN.md} ${BTN.neutral}`}>
                  {isBusy('more') ? 'Loading...' : 'Load more'}
                </button>
              ) : (
                <p className="text-xs text-neutral-500">That is everything for these filters.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const actor = event.actor
  const details = event.details && typeof event.details === 'object' ? Object.entries(event.details) : []

  return (
    <li className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-neutral-900">{auditActionLabel(event.action)}</p>
            <Badge tone={event.status === 'failed' ? 'red' : 'emerald'}>{event.status === 'failed' ? 'Failed' : 'Succeeded'}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-neutral-600">
            By{' '}
            {actor ? (
              actor.deleted ? (
                <span className="font-medium">Deleted user</span>
              ) : (
                <Link to={`/admin/users/${actor._id}`} className="font-medium text-neutral-900 hover:underline">
                  {actor.name}
                </Link>
              )
            ) : (
              <span className="font-medium">the system</span>
            )}
            {event.targetType && (
              <>
                {' '}
                · on {event.targetType}
                {event.targetId && <span className="break-all text-neutral-400"> {event.targetId}</span>}
              </>
            )}
          </p>
        </div>
        <time dateTime={event.createdAt} className="text-xs whitespace-nowrap text-neutral-500">
          {formatDateTime(event.createdAt)}
        </time>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={`${BTN.sm} ${BTN.neutral}`}
        >
          Details
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div id={panelId} className="border-t border-neutral-100 bg-neutral-50 p-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {actor && !actor.deleted && (
              <Row label="Person">
                {actor.name}
                {actor.email ? ` · ${actor.email}` : ''}
                {actor.role ? ` · ${roleLabel(actor.role)}` : ''}
              </Row>
            )}
            {event.targetType && <Row label="Done to">{event.targetType}{event.targetId ? ` ${event.targetId}` : ''}</Row>}
            {event.ip && <Row label="Address">{event.ip}</Row>}
            {event.userAgent && <Row label="Browser">{event.userAgent}</Row>}
            {details.map(([name, value]) => (
              <Row key={name} label={humanize(name)}>
                {value !== null && typeof value === 'object' ? (
                  <pre className="max-h-40 overflow-auto rounded bg-white p-2 text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
                ) : value === null || value === undefined || value === '' ? (
                  '—'
                ) : (
                  String(value)
                )}
              </Row>
            ))}
            <Row label="Event">{event._id}</Row>
          </dl>
          {details.length === 0 && <p className="mt-2 text-xs text-neutral-500">No further details were recorded for this action.</p>}
        </div>
      )}
    </li>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="break-words text-neutral-800">{children}</dd>
    </div>
  )
}
