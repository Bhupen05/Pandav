import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useNotifications, type NotificationItem } from '../context/useNotifications'
import { formatDateTime, timeAgo } from '../utils/formatDateTime'
import { internalPath } from '../utils/roleRedirect'

// The bell in the top bar: how many notifications are unread, and a menu with
// the latest ten. Clicking one marks it read and opens what it is about.
export default function NotificationBell() {
  const { unreadCount, latest, loadingLatest, latestFailed, refresh, markRead, markAllRead } = useNotifications()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'

  // Escape or a click elsewhere closes the menu (Escape also returns focus to the bell)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  // Opening shows the newest ones and moves focus into the menu
  useEffect(() => {
    if (!open) return
    void refresh()
    panelRef.current?.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus()
  }, [open, refresh])

  const openNotification = async (item: NotificationItem) => {
    setOpen(false)
    if (!item.readAt) void markRead(item._id)
    const path = internalPath(item.link)
    if (path) navigate(path)
  }

  const readAll = async () => {
    setMarkingAll(true)
    await markAllRead()
    setMarkingAll(false)
  }

  return (
    <div
      ref={containerRef}
      // On phones the menu is as wide as the top bar (which is its positioning
      // parent); from sm up it hangs under the bell
      className="sm:relative"
      onBlur={(e) => {
        // Tabbing out of the menu closes it
        const next = e.relatedTarget as Node | null
        if (open && next && containerRef.current && !containerRef.current.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white/80 text-slate-700 hover:bg-white"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border border-slate-200 bg-white shadow-lg sm:inset-x-auto sm:right-0 sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
            <button
              type="button"
              onClick={readAll}
              disabled={unreadCount === 0 || markingAll}
              className="rounded text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Mark all as read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {latest.length === 0 && loadingLatest && (
              <p role="status" className="px-4 py-6 text-center text-sm text-slate-500">Loading...</p>
            )}

            {latest.length === 0 && !loadingLatest && latestFailed && (
              <div role="alert" className="px-4 py-6 text-center text-sm text-slate-600">
                <p>We could not load your notifications.</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Retry
                </button>
              </div>
            )}

            {latest.length === 0 && !loadingLatest && !latestFailed && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">You are all caught up.</p>
            )}

            {latest.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {latest.map((item) => (
                  <li key={item._id}>
                    <button
                      type="button"
                      onClick={() => void openNotification(item)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-emerald-600'}`}
                      />
                      <span className="min-w-0 flex-1">
                        {!item.readAt && <span className="sr-only">Unread. </span>}
                        <span className={`block break-words text-sm text-slate-900 ${item.readAt ? '' : 'font-semibold'}`}>{item.title}</span>
                        {item.body && <span className="mt-0.5 line-clamp-2 block break-words text-xs text-slate-600">{item.body}</span>}
                        <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)} className="mt-1 block text-xs text-slate-500">
                          {timeAgo(item.createdAt)}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {latest.length > 0 && latestFailed && (
              <p role="alert" className="border-t border-slate-100 px-4 py-2 text-xs text-red-700">
                Could not refresh the list.{' '}
                <button type="button" onClick={() => void refresh()} className="font-semibold underline">Retry</button>
              </p>
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2.5 text-center">
            <Link to="/notifications" onClick={() => setOpen(false)} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">
              See all
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
