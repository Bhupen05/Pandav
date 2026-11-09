import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export type TabItem<K extends string> = { key: K; label: ReactNode; count?: number | null; icon?: ReactNode }

// Tabs with tab semantics: arrow keys move between them, and the bar
// scrolls sideways on narrow screens instead of widening the page
export function Tabs<K extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
}: {
  id: string
  label: string
  tabs: TabItem<K>[]
  value: K
  onChange: (key: K) => void
}) {
  const refs = useRef(new Map<K, HTMLButtonElement>())

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null
    if (next === null) return
    event.preventDefault()
    const key = tabs[next].key
    onChange(key)
    refs.current.get(key)?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2">
      {tabs.map((tab, index) => {
        const selected = tab.key === value
        return (
          <button
            key={tab.key}
            ref={(node) => {
              if (node) refs.current.set(tab.key, node)
              else refs.current.delete(tab.key)
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              selected ? 'bg-neutral-900 text-white' : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/20' : 'bg-neutral-100 text-neutral-700'}`}>{tab.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`}>
      {children}
    </div>
  )
}
