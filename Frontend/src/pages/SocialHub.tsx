import { useLocation } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import FeedView from '../components/social/FeedView'
import IntegrationsView from '../components/social/IntegrationsView'
import ModerationView from '../components/social/ModerationView'
import NetworkView from '../components/social/NetworkView'
import PublishingView from '../components/social/PublishingView'
import SocialTabs from '../components/social/SocialTabs'
import TodoView from '../components/social/TodoView'
import { SECTIONS, sectionOf } from '../components/social/sections'
import { EmptyState } from '../components/social/ui'
import { useAuth } from '../context/useAuth'

// The Social Hub: one tab bar and one view per address (the routes in
// App.tsx all open this page). Each view loads its own data, so a request
// that fails only breaks its own section.
export default function SocialHub() {
  const { user, isAdmin } = useAuth()
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  const current = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0]

  if (!user) return null

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.18),_transparent_25%),linear-gradient(180deg,#f8fafc_0%,#edf4ff_48%,#f8fafc_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 xl:px-8">
        <header className="overflow-hidden rounded-[32px] border border-slate-200/70 bg-slate-950 p-6 text-white shadow-[0_30px_120px_-40px_rgba(2,6,23,0.65)] lg:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Social Hub
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-white md:text-4xl">{current.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">{current.description}</p>
        </header>

        <SocialTabs isAdmin={isAdmin} />

        <div id="social-view" className="mt-6">
          {section === 'feed' ? <FeedView /> : null}
          {section === 'todo' ? <TodoView /> : null}
          {section === 'network' ? <NetworkView /> : null}
          {section === 'integrations' ? <IntegrationsView /> : null}
          {section === 'publishing' ? <PublishingView /> : null}
          {section === 'moderation' ? (
            isAdmin ? (
              <ModerationView />
            ) : (
              <div className="mx-auto max-w-3xl">
                <EmptyState>Only admins can moderate posts.</EmptyState>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
