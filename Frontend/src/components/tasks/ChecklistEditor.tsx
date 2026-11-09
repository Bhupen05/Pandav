import { useId, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT, newDraft, type ChecklistDraft } from './checklistDraft'

type Props = {
  items: ChecklistDraft[]
  onChange: (items: ChecklistDraft[]) => void
  error?: string
  errorId?: string
}

export default function ChecklistEditor({ items, onChange, error, errorId }: Props) {
  const addId = useId()
  const [draft, setDraft] = useState('')
  const full = items.length >= MAX_CHECKLIST_ITEMS

  const add = () => {
    const text = draft.trim()
    if (!text || full) return
    onChange([...items, newDraft(text)])
    setDraft('')
  }

  const move = (index: number, by: -1 | 1) => {
    const target = index + by
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div>
      {items.length > 0 && (
        <ol className="mb-3 space-y-2">
          {items.map((item, index) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-5 shrink-0 text-right text-xs text-neutral-400">{index + 1}</span>
              <input
                type="text"
                value={item.text}
                maxLength={MAX_CHECKLIST_TEXT}
                aria-label={`Checklist item ${index + 1}`}
                onChange={(event) => onChange(items.map((entry) => (entry.key === item.key ? { ...entry, text: event.target.value } : entry)))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
              />
              {item.done && <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">Ticked</span>}
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move item ${index + 1} up`}
                className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
              >
                <ArrowUp aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                aria-label={`Move item ${index + 1} down`}
                className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
              >
                <ArrowDown aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onChange(items.filter((entry) => entry.key !== item.key))}
                aria-label={`Remove item ${index + 1}`}
                className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex gap-2">
        <input
          id={addId}
          type="text"
          value={draft}
          maxLength={MAX_CHECKLIST_TEXT}
          disabled={full}
          aria-label="New checklist item"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          placeholder={full ? `A checklist can have at most ${MAX_CHECKLIST_ITEMS} items` : 'Add a step, then press Enter'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds the step; it must not send the whole form
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={add}
          disabled={full || !draft.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add item
        </button>
      </div>
      {error && <p id={errorId} className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  )
}
