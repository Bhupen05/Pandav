import { useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Navbar() {
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const toggle = () => setOpen((v) => !v)
  const close = () => setOpen(false)
  const navigate = useNavigate()
  const location = useLocation()

  const { isAuthenticated, isAdmin, isTeamLeader, isTeamMember, logout, user } = useAuth()

  const isPublicRoute = useMemo(() => {
    const publicPaths = ['/', '/about', '/service', '/pricing', '/login', '/register', '/contact']
    return publicPaths.includes(location.pathname)
  }, [location.pathname])

  const breadcrumbs = useMemo(() => {
    if (location.pathname === '/') return ['Home']
    return location.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => part.replace(/-/g, ' '))
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  }, [location.pathname])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-white text-[--color-primary] border border-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-[--color-primary]'}`

  const handleLogout = () => {
    logout()
    close()
    setProfileOpen(false)
    navigate('/')
  }

  if (isPublicRoute && !isAuthenticated) {
    return (
      <header className="fixed top-0 z-40 w-full border-b border-slate-200/60 bg-white/70 backdrop-blur-lg">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <NavLink to="/" className="text-2xl font-black tracking-tight text-[--color-primary]">
            Pandav
          </NavLink>

          <div className="hidden items-center gap-8 md:flex">
            <NavLink to="/" className="text-sm font-semibold text-[--color-primary]">
              Features
            </NavLink>
            <NavLink to="/service" className="text-sm font-medium text-slate-600 transition-colors hover:text-[--color-primary]">
              Solutions
            </NavLink>
            <NavLink to="/pricing" className="text-sm font-medium text-slate-600 transition-colors hover:text-[--color-primary]">
              Pricing
            </NavLink>
          </div>

          <div className="flex items-center gap-3">
            <NavLink to="/login" className="px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:text-[--color-primary]">
              Login
            </NavLink>
            <NavLink to="/register" className="rounded-xl bg-primary-gradient px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/10 transition-transform active:scale-95">
              Get Started
            </NavLink>
          </div>
        </nav>
      </header>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  const navItems = isAdmin
    ? [
        { to: '/dashboard', label: 'Dashboard' },
        { to: '/social', label: 'Social Hub' },
        { to: '/admin/teams', label: 'Teams' },
        { to: '/admin/users', label: 'Users' },
        { to: '/admin/attendance', label: 'Attendance' },
        { to: '/tasks', label: 'Tasks' },
        { to: '/chat', label: 'Chat' },
      ]
    : isTeamLeader
      ? [
          { to: '/dashboard', label: 'Dashboard' },
          { to: '/teams', label: 'Team' },
          { to: '/social', label: 'Social Hub' },
          { to: '/tasks', label: 'Tasks' },
          { to: '/attendance', label: 'Attendance' },
          { to: '/chat', label: 'Chat' },
        ]
      : isTeamMember
        ? [
            { to: '/dashboard', label: 'Dashboard' },
            { to: '/social', label: 'Social Hub' },
            { to: '/tasks', label: 'My Tasks' },
            { to: '/attendance', label: 'My Attendance' },
            { to: '/chat', label: 'Chat' },
          ]
        : [
            { to: '/dashboard', label: 'Dashboard' },
            { to: '/social', label: 'Social Hub' },
            { to: '/tasks', label: 'Tasks' },
            { to: '/attendance', label: 'Attendance' },
            { to: '/chat', label: 'Chat' },
          ]

  return (
    <>
      {/* Permanent side rail (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-slate-50/95 p-4 lg:block">
        <NavLink to="/" className="mb-6 block text-2xl font-extrabold tracking-tight text-[--color-primary]">
          Pandav
        </NavLink>

        <nav aria-label="Primary" className="space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass} onClick={close}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile drawer */}
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={close} />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200 bg-slate-50 p-4 transition-transform lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-4 flex items-center justify-between">
          <NavLink to="/" className="text-2xl font-extrabold tracking-tight text-[--color-primary]" onClick={close}>
            Pandav
          </NavLink>
          <button onClick={close} className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700">
            Close
          </button>
        </div>
        <nav aria-label="Mobile Primary" className="space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass} onClick={close}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Floating top bar */}
      <header className="fixed left-0 right-0 top-0 z-20 px-4 py-3 lg:left-64 lg:px-6">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between rounded-xl border border-slate-200/70 bg-white/70 px-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white/70 text-slate-700 lg:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={toggle}
            >
              <span className="relative block h-4 w-5" aria-hidden="true">
                <span className={`absolute left-0 h-0.5 w-full rounded bg-slate-900 transition ${open ? 'top-2 rotate-45' : 'top-0'}`}></span>
                <span className={`absolute left-0 h-0.5 w-full rounded bg-slate-900 transition ${open ? 'opacity-0' : 'top-2'}`}></span>
                <span className={`absolute left-0 h-0.5 w-full rounded bg-slate-900 transition ${open ? 'top-2 -rotate-45' : 'top-4'}`}></span>
              </span>
            </button>

            <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-2 text-sm">
              {breadcrumbs.map((crumb, index) => (
                <div key={`${crumb}-${index}`} className="flex items-center gap-2">
                  {index > 0 && <span className="text-slate-400">/</span>}
                  <span className={index === breadcrumbs.length - 1 ? 'font-semibold text-slate-900' : 'text-slate-500'}>{crumb}</span>
                </div>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="hidden rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white sm:inline-flex"
            >
              Refresh
            </button>
            <button
              onClick={() => {
                navigate('/profile')
                setProfileOpen(false)
              }}
              className="hidden rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white md:inline-flex"
            >
              Profile
            </button>

            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/70 transition-colors"
              >
                {user?.profileImage ? (
                  <img
                    src={user.profileImage}
                    alt={user.name}
                    className="h-8 w-8 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      const fallback = e.currentTarget.nextElementSibling
                      if (fallback) fallback.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 ${user?.profileImage ? 'hidden' : ''}`}>
                  {user?.name?.split(' ').map((n) => n[0]).join('') || 'U'}
                </div>
                <span className="hidden text-sm font-semibold text-slate-900 md:block">{user?.name || 'User'}</span>
              </button>

              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-sm">
                    <div className="border-b border-slate-100 px-4 py-2">
                      <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
                      <p className="text-xs text-slate-600">{user?.email}</p>
                    </div>

                    <button
                      onClick={() => {
                        navigate('/profile')
                        setProfileOpen(false)
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      View Profile
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  )
}

export default Navbar
