import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import { getDashboardRouteForRole } from '../../utils/roleRedirect'

const LINKS = [
  { to: '/', label: 'Features', end: true },
  { to: '/service', label: 'Solutions' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
]

const desktopLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm transition-colors hover:text-primary ${isActive ? 'font-semibold text-primary' : 'font-medium text-slate-600'}`

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2.5 text-sm ${isActive ? 'bg-slate-100 font-semibold text-primary' : 'font-medium text-slate-700 hover:bg-slate-50'}`

// The header of the marketing pages and the sign-in screens. Signed-in
// visitors get a "Go to dashboard" button instead of Login and Get Started.
export default function PublicHeader() {
  const { isAuthenticated, user } = useAuth()
  const [open, setOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const home = getDashboardRouteForRole(user?.role)

  // Escape, or a click anywhere else, closes the phone menu
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <header ref={headerRef} className="fixed top-0 z-40 w-full border-b border-slate-200/60 bg-white/80 backdrop-blur-lg">
      <nav aria-label="Main" className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="text-2xl font-black tracking-tight text-primary">
          Pandav
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={desktopLinkClass}>
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {isAuthenticated ? (
            <Link
              to={home}
              className="rounded-xl bg-primary-gradient px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/10 transition-transform active:scale-95 sm:px-5"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <NavLink to="/login" className="px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:text-primary sm:px-4">
                Login
              </NavLink>
              <NavLink
                to="/register"
                className="rounded-xl bg-primary-gradient px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/10 transition-transform active:scale-95 sm:px-5"
              >
                Get Started
              </NavLink>
            </>
          )}

          <button
            ref={buttonRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="public-menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="public-menu" className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 shadow-lg md:hidden">
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} end={link.end} className={mobileLinkClass} onClick={close}>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  )
}
