import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail, Reply, Search, Trash2 } from 'lucide-react'
import { adminAPI, type ContactMessage, type ContactSort, type ContactStatus } from '../api/adminAPI'
import type { ApiError } from '../api/axios'
import { useFeedback } from '../context/useFeedback'
import { AdminHeader, Badge, CollapsibleText, Loadable, Pager } from '../components/admin/ui'
import { useResource } from '../components/admin/useResource'
import { useDebouncedValue } from '../components/admin/useDebouncedValue'
import { useBusy } from '../components/admin/useBusy'
import { errorText, formatDate, formatDateTime } from '../components/admin/format'
import { CONTACT_STATUS_LABELS, contactStatusLabel, contactStatusTone } from '../components/admin/labels'
import { BTN, FIELD, LABEL } from '../components/admin/buttons'

const STATUSES = Object.keys(CONTACT_STATUS_LABELS) as ContactStatus[]
const SORTS: Array<{ value: ContactSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently changed' },
  { value: 'name', label: 'Name, A to Z' },
]
const PAGE_SIZE = 10
const REPLY_LIMIT = 5000

type MailState = 'checking' | 'on' | 'off'

export default function ContactMessages() {
  const [params, setParams] = useSearchParams()

  const status = STATUSES.find((item) => item === params.get('status'))
  const q = params.get('q') ?? ''
  const sort = SORTS.find((item) => item.value === params.get('sort'))?.value ?? 'newest'
  const page = Math.max(1, Number(params.get('page')) || 1)

  const change = useCallback(
    (changes: Record<string, string>, keepPage = false) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          if (!keepPage) next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const [search, setSearch] = useState(q)
  const debounced = useDebouncedValue(search.trim(), 300)
  const appliedQ = useRef(q)
  useEffect(() => {
    appliedQ.current = q
  }, [q])
  useEffect(() => {
    if (debounced !== appliedQ.current) change({ q: debounced })
  }, [debounced, change])

  const messages = useResource(
    useCallback(
      (signal: AbortSignal) => adminAPI.getContacts({ status, q, sort, page, limit: PAGE_SIZE }, { signal }),
      [status, q, sort, page],
    ),
  )
  const stats = useResource(useCallback((signal: AbortSignal) => adminAPI.getContactStats({ signal }), []))
  const config = useResource(useCallback((signal: AbortSignal) => adminAPI.getServerConfig({ signal }), []))
  const mail: MailState = config.data ? (config.data.mailEnabled ? 'on' : 'off') : config.error !== undefined ? 'on' : 'checking'

  const refresh = () => {
    messages.reload()
    stats.reload()
  }

  const countFor = (key: 'all' | ContactStatus) => (stats.data ? (key === 'all' ? stats.data.total : stats.data.byStatus[key] ?? 0) : null)
  const filtered = Boolean(status || q)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    change({ q: search.trim() })
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <AdminHeader title="Contact messages" subtitle="Messages sent through the contact form." back={{ to: '/admin', label: 'Back to dashboard' }} />

      <div className="mx-auto max-w-5xl px-4 py-6">
        <form onSubmit={onSubmit} role="search" aria-label="Find messages" className="mb-4 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <div>
            <label htmlFor="contact-search" className={LABEL}>
              Search messages
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
              <input
                id="contact-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email, subject or text"
                className={`${FIELD} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="contact-sort" className={LABEL}>
              Sort by
            </label>
            <select id="contact-sort" value={sort} onChange={(event) => change({ sort: event.target.value === 'newest' ? '' : event.target.value })} className={FIELD}>
              {SORTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${BTN.md} ${BTN.primary}`}>
            Search
          </button>
        </form>

        <div role="group" aria-label="Filter by status" className="mb-5 flex flex-wrap gap-2">
          {(['all', ...STATUSES] as const).map((key) => {
            const selected = (key === 'all' ? undefined : key) === status
            const count = countFor(key)
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => change({ status: key === 'all' ? '' : key })}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  selected ? 'bg-neutral-900 text-white shadow-lg' : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {key === 'all' ? 'All' : contactStatusLabel(key)}
                {count !== null && <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/20' : 'bg-neutral-100'}`}>{count}</span>}
              </button>
            )
          })}
        </div>

        <Loadable
          data={messages.data}
          error={messages.error}
          loading={messages.loading}
          onRetry={refresh}
          errorFallback="Could not load the messages"
          isEmpty={(data) => data.data.length === 0}
          empty={
            filtered ? (
              <>
                No messages match.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setParams({}, { replace: true })
                  }}
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              'No messages yet.'
            )
          }
        >
          {(data) => (
            <>
              <ul className="space-y-4">
                {data.data.map((message) => (
                  <MessageCard
                    key={message._id}
                    message={message}
                    mail={mail}
                    onChanged={(updated) => {
                      if (updated) {
                        messages.update((current) => ({ ...current, data: current.data.map((item) => (item._id === updated._id ? updated : item)) }))
                        stats.reload()
                      } else {
                        refresh()
                      }
                    }}
                  />
                ))}
              </ul>
              <Pager
                page={data.pagination?.page ?? page}
                pages={data.pagination?.pages ?? 1}
                total={data.pagination?.total}
                label="Message pages"
                onPage={(next) => change({ page: String(next) }, true)}
              />
            </>
          )}
        </Loadable>
      </div>
    </div>
  )
}

function MessageCard({ message, mail, onChanged }: { message: ContactMessage; mail: MailState; onChanged: (updated?: ContactMessage) => void }) {
  const { notify, confirm } = useFeedback()
  const { run, isBusy } = useBusy()
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const [replyError, setReplyError] = useState<unknown>(undefined)
  const statusId = `status-${message._id}`
  const replyId = `reply-${message._id}`
  const replies = message.replies ?? []
  const mailto = `mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`

  const changeStatus = (status: ContactStatus) => {
    if (status === message.status) return
    void run('status', async () => {
      try {
        const updated = await adminAPI.setContactStatus(message._id, status)
        notify(`Marked as ${contactStatusLabel(status).toLowerCase()}.`, 'success')
        onChanged(updated)
      } catch (error) {
        notify(errorText(error, 'Could not change the status'), 'error')
      }
    })
  }

  const sendReply = (event: FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body) {
      setReplyError({ message: 'Write a reply first.' })
      return
    }
    setReplyError(undefined)
    void run('reply', async () => {
      try {
        const updated = await adminAPI.replyToContact(message._id, body)
        notify(`Reply sent to ${message.email}.`, 'success')
        setText('')
        setReplying(false)
        onChanged(updated)
      } catch (error) {
        setReplyError(error)
        // A reply the mail server refused is still kept, so the thread has changed
        if ((error as ApiError)?.status === 502) onChanged()
      }
    })
  }

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this message?',
      message: `"${message.subject}" from ${message.name} and its replies are removed. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    void run('delete', async () => {
      try {
        await adminAPI.deleteContact(message._id)
        notify('Message deleted.', 'success')
        onChanged()
      } catch (error) {
        notify(errorText(error, 'Could not delete the message'), 'error')
      }
    })
  }

  return (
    <li>
      <article aria-label={message.subject} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-semibold break-words text-neutral-900">{message.subject}</h2>
            <p className="text-sm break-words text-neutral-600">
              {message.name} ·{' '}
              <a href={`mailto:${message.email}`} className="text-emerald-700 hover:underline">
                {message.email}
              </a>
              {message.phone && <> · {message.phone}</>}
            </p>
            <p className="text-xs text-neutral-500">{formatDateTime(message.createdAt)}</p>
          </div>
          <Badge tone={contactStatusTone(message.status)} className="self-start">
            {contactStatusLabel(message.status)}
          </Badge>
        </div>

        <CollapsibleText text={message.message} className="mb-4" />

        {message.status === 'resolved' && message.resolvedBy && (
          <p className="mb-4 text-xs text-neutral-500">
            Resolved by {message.resolvedBy.name}
            {message.resolvedAt && ` on ${formatDate(message.resolvedAt)}`}
          </p>
        )}

        {replies.length > 0 && (
          <section aria-label={`Replies to ${message.subject}`} className="mb-4 space-y-2 border-l-2 border-emerald-200 pl-4">
            <h3 className="text-xs font-semibold text-neutral-600">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </h3>
            {replies.map((reply) => (
              <div key={reply._id} className="rounded-lg bg-neutral-50 p-3">
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-700">{reply.by?.name ?? 'Deleted user'}</span>
                  <span>{formatDateTime(reply.at)}</span>
                  {!reply.sent && <Badge tone="red">Not emailed</Badge>}
                </p>
                <CollapsibleText text={reply.message} limit={300} />
              </div>
            ))}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
          <label htmlFor={statusId} className="text-xs text-neutral-600">
            Status
          </label>
          <select
            id={statusId}
            value={message.status}
            disabled={isBusy('status')}
            onChange={(event) => changeStatus(event.target.value as ContactStatus)}
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {contactStatusLabel(status)}
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={replying}
              aria-controls={replyId}
              onClick={() => setReplying((value) => !value)}
              className={`${BTN.sm} ${BTN.neutral}`}
            >
              <Reply className="h-3.5 w-3.5" aria-hidden="true" />
              Reply
            </button>
            <button type="button" onClick={remove} disabled={isBusy('delete')} aria-label={`Delete ${message.subject}`} className={`${BTN.sm} ${BTN.danger}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>

        {replying && (
          <div id={replyId} className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            {mail === 'off' ? (
              <div role="note">
                <p className="text-sm text-neutral-800">
                  Email isn&apos;t set up on this server, so Pandav can&apos;t send replies. You can answer {message.name} from your own mail app instead.
                </p>
                <a href={mailto} className={`${BTN.sm} ${BTN.primary} mt-3`}>
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Reply from my mail app
                </a>
              </div>
            ) : mail === 'checking' ? (
              <p className="text-sm text-neutral-600">Checking whether email is set up...</p>
            ) : (
              <form onSubmit={sendReply}>
                <label htmlFor={`${replyId}-text`} className={LABEL}>
                  Your reply to {message.name}
                </label>
                <textarea
                  id={`${replyId}-text`}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
                  }}
                  maxLength={REPLY_LIMIT}
                  rows={5}
                  className={`${FIELD} resize-y`}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  It is emailed to {message.email}, with their message quoted below it. {text.length}/{REPLY_LIMIT}
                </p>
                {replyError !== undefined && (
                  <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {errorText(replyError, 'Could not send the reply')}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="submit" disabled={isBusy('reply')} className={`${BTN.sm} ${BTN.success}`}>
                    {isBusy('reply') ? 'Sending...' : 'Send reply'}
                  </button>
                  <button type="button" onClick={() => setReplying(false)} className={`${BTN.sm} ${BTN.neutral}`}>
                    Cancel
                  </button>
                  <a href={mailto} className={`${BTN.sm} ${BTN.neutral} sm:ml-auto`}>
                    Use my mail app instead
                  </a>
                </div>
              </form>
            )}
          </div>
        )}
      </article>
    </li>
  )
}
