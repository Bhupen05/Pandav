import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Navbar() {
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const toggle = () => setOpen((v) => !v)
  const close = () => setOpen(false)
  const navigate = useNavigate()
  
  const { isAuthenticated, isAdmin, logout, user } = useAuth()

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-emerald-50 text-emerald-700' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'}`

  const handleLogout = () => {
    logout()
    close()
    navigate('/')
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <NavLink to="/" className="text-xl font-bold text-transparent bg-linear-to-r from-emerald-600 to-blue-600 bg-clip-text" onClick={close}>
          Pandav
        </NavLink>

        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 hover:bg-neutral-50 transition-colors md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="relative block h-4 w-5" aria-hidden="true">
            <span className={`absolute left-0 h-0.5 w-full rounded bg-neutral-900 transition ${open ? 'top-2 rotate-45' : 'top-0'}`}></span>
            <span className={`absolute left-0 h-0.5 w-full rounded bg-neutral-900 transition ${open ? 'opacity-0' : 'top-2'}`}></span>
            <span className={`absolute left-0 h-0.5 w-full rounded bg-neutral-900 transition ${open ? 'top-2 -rotate-45' : 'top-4'}`}></span>
          </span>
        </button>

        <nav
          className={`${open ? 'flex' : 'hidden'} absolute left-0 right-0 top-16 flex-col gap-1 border-b bg-white px-4 py-4 shadow-md md:static md:flex md:h-auto md:flex-row md:items-center md:gap-1 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
          aria-label="Primary"
        >
          {!isAuthenticated && (
            <>
              <NavLink to="/" className={linkClass} onClick={close}>
                Home
              </NavLink>
              <NavLink to="/about" className={linkClass} onClick={close}>
                About
              </NavLink>
              <NavLink to="/service" className={linkClass} onClick={close}>
                Services
              </NavLink>
              <NavLink to="/contact" className={linkClass} onClick={close}>
                Contact
              </NavLink>
            </>
          )}
          
          {isAuthenticated && !isAdmin && (
            <>
              <NavLink to="/tasks" className={linkClass} onClick={close}>
                Tasks
              </NavLink>
              <NavLink to="/attendance" className={linkClass} onClick={close}>
                Attendance
              </NavLink>
            </>
          )}
          
          {isAdmin && (
            <>
              <NavLink to="/admin" className={linkClass} onClick={close}>
                Admin Panel
              </NavLink>
              
            </>
          )}
          
          {isAuthenticated ? (
            <div className="relative md:ml-2">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50 transition-colors"
              >
                {user?.profileImage ? (
                  <img
                    src={user.profileImage}
                    alt={user.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                    {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                  </div>
                )}
                <span className="hidden text-sm font-medium text-neutral-900 md:block">
                  {user?.name || 'User'}
                </span>
                <svg
                  className={`hidden h-4 w-4 text-neutral-600 transition-transform md:block ${profileOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {profileOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border bg-white py-1 shadow-lg">
                    <div className="border-b px-4 py-2">
                      <p className="text-sm font-medium text-neutral-900">{user?.name}</p>
                      <p className="text-xs text-neutral-600">{user?.email}</p>
                    </div>
                    
                      <button
                        onClick={() => {
                          navigate('/profile')
                          setProfileOpen(false)
                          close()
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        View Profile
                      </button>
                    
                    <button
                      onClick={() => {
                        handleLogout()
                        setProfileOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <NavLink to="/login" className={linkClass} onClick={close}>
              Login
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  )
}

export default Navbar