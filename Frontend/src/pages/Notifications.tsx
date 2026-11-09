import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { notificationAPI, type NotificationItem } from '../api/notificationAPI'
import { getErrorMessage } from '../api/axios'
import { useNotifications } from '../context/useNotifications'
import { formatDateTime } from '../utils/formatDateTime'
import { internalPath } from '../utils/roleRedirect'
import { errorBoxClass, primaryButtonClass, secondaryButtonClass } from '../components/shell/formStyles'

const actorName = (item: NotificationItem) =>
  item.actor && typeof item.actor === 'object' ? item.actor.name : undefined

export default function Notifications() {
  const { unreadCount, markRead, markAllRead, remove, arrivals } = useNotifications()

  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  // Answers of requests for another filter than the one on screen are dropped
  const requestRef = useRef(0)

  const loadFirstPage = useCallback(async (onlyUnread: boolean) => {
    const request = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const page = await notificationAPI.list({ unread: onlyUnread })
      if (request !== requestRef.current) return
      setItems(page.data)
      setHasMore(page.hasMore)
      setMoreError(null)
    } catch (err) {
      if (request === requestRef.current) setError(getErrorMessage(err, 'We could not load your notifications.'))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFirstPage(unreadOnly)
  }, [unreadOnly, loadFirstPage])

  // Something new arrived while this page is open: put it on top
  const seenArrivals = useRef(arrivals)
  useEffect(() => {
    if (arrivals === seenArrivals.current) return
    seenArrivals.current = arrivals
    notificationAPI
      .list({ unread: unreadOnly, limit: 10 })
      .then((page) =>
        setItems((current) => {
          const known = new Set(current.map((item) => item._id))
          return [...page.data.filter((item) => !known.has(item._id)), ...current]
        }),
      )
      .catch(() => {
        // The list on screen stays as it is
      })
  }, [arrivals, unreadOnly])

  const loadMore = async () => {
    const oldest = items[items.length - 1]
    if (!oldest || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await notificationAPI.list({ before: oldest._id, unread: unreadOnly })
      setItems((current) => {
        const known = new Set(current.map((item) => item._id))
        return [...current, ...page.data.filter((item) => !known.has(item._id))]
      })
      setHasMore(page.hasMore)
    } catch (err) {
      setMoreError(getErrorMessage(err, 'We could not load more notifications.'))
    } finally {
      setLoadingMore(false)
    }
  }

  // Read notifications leave the list when only unread ones are shown
  const markedRead = (id: string) =>
    setItems((current) =>
      unreadOnly
        ? current.filter((item) => item._id !== id)
        : current.map((item) => (item._id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item)),
    )

  const onMarkRead = async (item: NotificationItem) => {
    setBusyId(item._id)
    if (await markRead(item._id)) markedRead(item._id)
    setBusyId(null)
  }

  const onOpen = (item: NotificationItem) => {
    if (!item.readAt) void markRead(item._id).then((ok) => ok && markedRead(item._id))
  }

  const onDelete = async (item: NotificationItem) => {
    setBusyId(item._id)
    if (await remove(item._id)) setItems((current) => current.filter((existing) => existing._id !== item._id))
    setBusyId(null)
  }

  const onMarkAll = async () => {
    setMarkingAll(true)
    if (await markAllRead()) {
      const readAt = new Date().toISOString()
      setItems((current) => (unreadOnly ? [] : current.map((item) => (item.readAt ? item : { ...item, readAt }))))
      if (unreadOnly) setHasMore(false)
    }
    setMarkingAll(false)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-600" aria-live="polite">
            {unreadCount === 0 ? 'Nothing unread.' : `${unreadCount} unread`}
          </p>
        </div>
        <button type="button" onClick={onMarkAll} disabled={unreadCount === 0 || markingAll} className={secondaryButtonClass}>
          {markingAll ? 'Working...' : 'Mark all as read'}
        </button>
      </div>

      <div className="mb-4 flex gap-2" role="group" aria-label="Show">
        {[
          { label: 'All', value: false },
          { label: 'Unread', value: true },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={unreadOnly === option.value}
            onClick={() => setUnreadOnly(option.value)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              unreadOnly === option.value
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading && (
        <div role="status" className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-12 text-sm text-slate-600">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          Loading notifications...
        </div>
      )}

      {!loading && error && (
        <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 ${errorBoxClass}`}>
          <span>{error}</span>
          <button type="button" onClick={() => void loadFirstPage(unreadOnly)} className={secondaryButtonClass}>Retry</button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-600">
          {unreadOnly ? 'No unread notifications. You are all caught up.' : 'No notifications yet. Task, team and attendance updates will show up here.'}
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {items.map((item) => {
              const path = internalPath(item.link)
              const unread = !item.readAt
              const who = actorName(item)
              return (
                <li key={item._id} className={`flex items-start gap-3 px-4 py-3 ${unread ? 'bg-emerald-50/40' : ''}`}>
                  <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-emerald-600' : 'bg-transparent'}`} />
                  <div className="min-w-0 flex-1">
                    {unread && <span className="sr-only">Unread. </span>}
                    {path ? (
                      <Link to={path} onClick={() => onOpen(item)} className={`break-words text-sm text-slate-900 hover:underline ${unread ? 'font-semibold' : ''}`}>
                        {item.title}
                      </Link>
                    ) : (
                      <p className={`break-words text-sm text-slate-900 ${unread ? 'font-semibold' : ''}`}>{item.title}</p>
                    )}
                    {item.body && <p className="mt-0.5 break-words text-sm text-slate-600">{item.body}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      {who ? `${who} · ` : ''}
                      <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {unread && (
                      <button
                        type="button"
                        onClick={() => void onMarkRead(item)}
                        disabled={busyId === item._id}
                        aria-label={`Mark as read: ${item.title}`}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        Mark read
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onDelete(item)}
                      disabled={busyId === item._id}
                      aria-label={`Delete notification: ${item.title}`}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          {moreError && (
            <div role="alert" className={`mt-3 ${errorBoxClass}`}>{moreError}</div>
          )}
          {hasMore && (
            <div className="mt-4 text-center">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={primaryButtonClass}>
                {loadingMore ? 'Loading...' : moreError ? 'Try again' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
