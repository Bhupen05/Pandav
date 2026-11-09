import { useSearchParams } from 'react-router-dom'
import ModerationPosts from './ModerationPosts'
import ReportedMessages from './ReportedMessages'

const TABS = [
  { key: 'posts', label: 'Posts' },
  { key: 'messages', label: 'Reported messages' },
] as const

// Moderation (admins): posts, and chat messages people reported. The tab is
// in the address (?tab=messages), so a notification can open the right one.
export default function ModerationView() {
  const [params, setParams] = useSearchParams()
  const active = params.get('tab') === 'messages' ? 'messages' : 'posts'

  const select = (key: (typeof TABS)[number]['key']) => {
    setParams(key === 'posts' ? {} : { tab: key }, { replace: true })
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div role="tablist" aria-label="Moderation" className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            id={`moderation-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`moderation-panel-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => select(tab.key)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
              event.preventDefault()
              const next = TABS[(TABS.findIndex((item) => item.key === tab.key) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
              select(next.key)
              document.getElementById(`moderation-tab-${next.key}`)?.focus()
            }}
            className={`shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              active === tab.key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`moderation-panel-${active}`} aria-labelledby={`moderation-tab-${active}`}>
        {active === 'messages' ? <ReportedMessages /> : <ModerationPosts />}
      </div>
    </div>
  )
}
