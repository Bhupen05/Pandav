import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { SECTIONS } from './sections'

// One address per view: the tab bar is a row of links, which scrolls on its
// own on a phone instead of widening the page
export default function SocialTabs({ isAdmin }: { isAdmin: boolean }) {
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  // On a phone the current tab may start off screen: bring it into the bar
  useEffect(() => {
    const bar = nav.current
    const active = bar?.querySelector<HTMLElement>('[aria-current="page"]')
    if (bar && active) bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2
  }, [pathname])

  return (
    <nav
      ref={nav}
      aria-label="Social Hub sections"
      className="relative mt-5 overflow-x-auto rounded-[22px] border border-white/70 bg-white/85 p-1.5 shadow-sm backdrop-blur"
    >
      <ul className="flex min-w-max gap-1">
        {SECTIONS.filter((section) => !section.adminOnly || isAdmin).map((section) => (
          <li key={section.key}>
            <NavLink
              to={section.to}
              end
              className={({ isActive }) =>
                `block whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
