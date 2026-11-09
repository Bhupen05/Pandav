import type { KeyboardEvent } from 'react'

export type TabItem = { id: string; label: string; count?: number }

type Props = {
  label: string
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
  // Prefix of the element ids, so a panel can name its tab (aria-labelledby)
  idPrefix: string
}

// Tab bar with tab semantics and arrow-key movement; it scrolls sideways on a
// phone instead of wrapping or overflowing the page
export default function Tabs({ label, tabs, active, onChange, idPrefix }: Props) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active)
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next < 0) return
    event.preventDefault()
    onChange(tabs[next].id)
    document.getElementById(`${idPrefix}-tab-${tabs[next].id}`)?.focus()
  }

  return (
    <div className="mb-6 overflow-x-auto border-b border-neutral-200">
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              id={`${idPrefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={`relative -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900'
              }`}
            >
              {tab.label}
              {tab.count ? (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                  {tab.count}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
