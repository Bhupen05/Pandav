import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogOut, User as UserIcon } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useChat } from '../context/useChat'
import { useFeedback } from '../context/useFeedback'
import { useNotifications } from '../context/useNotifications'
import { getErrorMessage } from '../api/axios'
import { isAppPath, isPublicPath } from '../utils/appPaths'
import { getDashboardRouteForRole } from '../utils/roleRedirect'
import NotificationBell from './NotificationBell'
import Avatar from './shell/Avatar'
import PublicHeader from './shell/PublicHeader'
import { BADGE_WORDS, activeNavIndex, buildNavItems, type NavItem } from './shell/navItems'
import { useNavBadges } from './shell/useNavBadges'

// What the page is called in the top bar when no link of the navigation leads to it
const EXTRA_TITLES: Record<string, string> = { '/profile': 'Profile', '/notifications': 'Notifications' }

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function NavBadge({ count, words }: { count: number; words: string }) {
  if (count <= 0) return null
  return (
    <>
      <span aria-hidden="true" className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-none text-white">
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">{`${count} ${words}`}</span>
    </>
  )
}

// The links of the signed-in navigation: shown in the side rail and in the phone drawer
function NavLinks({
  items,
  activeIndex,
  counts,
  onNavigate,
  label,
}: {
  items: NavItem[]
  activeIndex: number
  counts: Record<string, number>
  onNavigate?: () => void
  label: string
}) {
  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map((item, index) => {
          const active = index === activeIndex
          const Icon = item.icon
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-slate-200 bg-white text-primary'
                    : 'border-transparent text-slate-600 hover:bg-white/70 hover:text-primary'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge && <NavBadge count={counts[item.badge] ?? 0} words={BADGE_WORDS[item.badge]} />}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// The brand; a link to the user's home once the navigation is available
function Logo({ to, onClick }: { to?: string; onClick?: () => void }) {
  const className = 'text-2xl font-extrabold tracking-tight text-primary'
  return to ? (
    <Link to={to} onClick={onClick} className={className}>
      Pandav
    </Link>
  ) : (
    <span className={className}>Pandav</span>
  )
}

// Rail, phone drawer and top bar of the signed-in app
function AppNav() {
  const location = useLocation()
  const { user, loading, logout } = useAuth()
  const { totalUnread } = useChat()
  const { arrivals } = useNotifications()
  const { notify } = useFeedback()

  // Each is open for the page it was opened on: going to another page closes it
  const [drawerOpenAt, setDrawerOpenAt] = useState<string | null>(null)
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null)
  const drawerOpen = drawerOpenAt === location.key
  const menuOpen = menuOpenAt === location.key
  const setDrawerOpen = (open: boolean) => setDrawerOpenAt(open ? location.key : null)
  const setMenuOpen = (open: boolean) => setMenuOpenAt(open ? location.key : null)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const closeDrawerRef = useRef<HTMLButtonElement>(null)
  const menuContainerRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)
  const drawerId = useId()
  const menuId = useId()

  // The links depend on the role, which is confirmed with the server first. Until
  // a new password is chosen nothing else works, so there are no links.
  const ready = !loading && !user?.mustChangePassword
  const items = ready ? buildNavItems(user?.role) : []
  const activeIndex = activeNavIndex(items, location.pathname)
  const home = getDashboardRouteForRole(user?.role)
  const sectionTitle = items[activeIndex]?.label ?? EXTRA_TITLES[location.pathname] ?? ''

  const badges = useNavBadges(user?.role, ready, arrivals)
  const counts: Record<string, number> = { chat: totalUnread, ...badges }

  const closeDrawer = (returnFocus = false) => {
    setDrawerOpen(false)
    if (returnFocus) hamburgerRef.current?.focus()
  }

  // The drawer: focus moves in when it opens, Escape closes it and puts focus
  // back on the button that opened it
  useEffect(() => {
    if (!drawerOpen) return
    closeDrawerRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpenAt(null)
        hamburgerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Tab stays inside the open drawer
  const trapFocus = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !drawerRef.current) return
    const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // The account menu: Escape or a click elsewhere closes it, focus moves in and back
  useEffect(() => {
    if (!menuOpen) return
    menuPanelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpenAt(null)
        menuButtonRef.current?.focus()
      }
    }
    const onPointer = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) setMenuOpenAt(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [menuOpen])

  const handleLogout = async () => {
    setMenuOpen(false)
    try {
      await logout()
    } catch (error) {
      notify(getErrorMessage(error, 'Could not sign out. Please try again.'), 'error')
      return
    }
    // A fresh page load: a client-side navigate('/') loses to the route guard,
    // which sends a signed-out user on a protected page to /login. It also
    // drops anything the previous account left in memory.
    window.location.replace('/')
  }

  return (
    <>
      {/* Permanent side rail (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-slate-50/95 p-4 lg:flex">
        <div className="mb-6"><Logo to={items.length > 0 ? home : undefined} /></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks items={items} activeIndex={activeIndex} counts={counts} label="Primary" />
        </div>
      </aside>

      {/* Phone drawer. Closed, it is inert: its links can't be reached with Tab. */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => closeDrawer(true)} aria-hidden="true" />}
      <aside
        id={drawerId}
        ref={drawerRef}
        inert={!drawerOpen}
        role="dialog"
        aria-modal={drawerOpen}
        aria-label="Menu"
        onKeyDown={trapFocus}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-slate-50 p-4 transition-transform lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <Logo to={items.length > 0 ? home : undefined} onClick={() => closeDrawer()} />
          <button
            ref={closeDrawerRef}
            type="button"
            onClick={() => closeDrawer(true)}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-700"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks items={items} activeIndex={activeIndex} counts={counts} onNavigate={() => closeDrawer()} label="Mobile Primary" />
        </div>
      </aside>

      {/* Floating top bar */}
      <header className="fixed left-0 right-0 top-0 z-20 px-3 py-3 sm:px-4 lg:left-64 lg:px-6">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/80 px-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            {items.length > 0 ? (
              <button
                ref={hamburgerRef}
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white/70 text-slate-700 lg:hidden"
                aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={drawerOpen}
                aria-controls={drawerId}
                onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
              >
                <span className="relative block h-4 w-5" aria-hidden="true">
                  <span className={`absolute left-0 h-0.5 w-full rounded bg-slate-900 transition ${drawerOpen ? 'top-2 rotate-45' : 'top-0'}`}></span>
                  <span className={`absolute left-0 h-0.5 w-full rounded bg-slate-900 transition ${drawerOpen ? 'opacity-0' : 'top-2'}`}></span>
                  <span className={`absolute left-0 h-0.5 w-full rounded bg-slate-900 transition ${drawerOpen ? 'top-2 -rotate-45' : 'top-4'}`}></span>
                </span>
              </button>
            ) : (
              <span className="text-lg font-extrabold tracking-tight text-primary lg:hidden">Pandav</span>
            )}

            {sectionTitle && <p className="hidden truncate text-sm font-semibold text-slate-900 sm:block">{sectionTitle}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {ready && <NotificationBell />}

            <div ref={menuContainerRef} className="relative">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={`${user?.name || 'Account'}, account menu`}
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/70"
              >
                <Avatar name={user?.name} src={user?.profileImage} className="h-8 w-8 text-sm" />
                <span className="hidden max-w-40 truncate text-sm font-semibold text-slate-900 md:block">{user?.name || 'User'}</span>
              </button>

              {menuOpen && (
                <div
                  ref={menuPanelRef}
                  id={menuId}
                  role="region"
                  aria-label="Account"
                  onBlur={(e) => {
                    const next = e.relatedTarget as Node | null
                    if (next && menuContainerRef.current && !menuContainerRef.current.contains(next)) setMenuOpen(false)
                  }}
                  className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-sm"
                >
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="break-words text-sm font-semibold text-slate-900">{user?.name}</p>
                    <p className="break-all text-xs text-slate-600">{user?.email}</p>
                  </div>

                  <Link
                    to="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <UserIcon className="h-4 w-4" aria-hidden="true" />
                    Profile
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  )
}

// The navigation around every page: the marketing header (also for signed-in
// visitors on a public page, with a "Go to dashboard" button), or the app shell.
function Navbar() {
  const { pathname } = useLocation()
  const { isAuthenticated } = useAuth()

  if (isPublicPath(pathname)) return <PublicHeader />
  if (isAuthenticated) return <AppNav />
  // A protected page whose guard is about to send the visitor to sign in: no
  // header flashes first. A page that doesn't exist (404) gets the public one.
  return isAppPath(pathname) ? null : <PublicHeader />
}

export default Navbar
