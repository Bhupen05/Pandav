import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { adminAPI, type PersonMatch } from '../../api/adminAPI'
import { useDebouncedValue } from './useDebouncedValue'
import { errorText } from './format'
import { roleLabel } from './labels'

export type PickedPerson = { id: string; name: string }

// Finds a person by name or email (GET /users/search, at least 2 characters)
export function PersonPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: PickedPerson | null
  onChange: (person: PickedPerson | null) => void
}) {
  const inputId = useId()
  const listId = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebouncedValue(text.trim(), 300)
  const [found, setFound] = useState<{ query: string; people: PersonMatch[]; error?: unknown } | null>(null)

  useEffect(() => {
    if (debounced.length < 2) return
    const controller = new AbortController()
    adminAPI.searchPeople(debounced, { signal: controller.signal }).then(
      (people) => {
        if (!controller.signal.aborted) setFound({ query: debounced, people })
      },
      (error) => {
        if (!controller.signal.aborted) setFound({ query: debounced, people: [], error })
      },
    )
    return () => controller.abort()
  }, [debounced])

  const current = found && found.query === debounced && debounced.length >= 2 ? found : null
  const searching = debounced.length >= 2 && !current
  const showList = open && !value && text.trim().length >= 2

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
      </label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-medium text-neutral-900">{value.name}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setText('')
            }}
            aria-label={`Remove ${value.name} from the filter`}
            className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
          placeholder="Search by name or email"
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
        />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label}: matches`}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {searching && <li className="px-3 py-2 text-sm text-neutral-500">Searching...</li>}
          {current?.error !== undefined && <li className="px-3 py-2 text-sm text-red-600">{errorText(current.error, "Couldn't search people")}</li>}
          {current && current.error === undefined && current.people.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-500">No one found</li>
          )}
          {current?.people.map((person) => (
            <li key={person._id} role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange({ id: person._id, name: person.name })
                  setOpen(false)
                }}
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-medium text-neutral-900">{person.name}</span>
                <span className="text-xs text-neutral-500">
                  {person.email ? `${person.email} · ` : ''}
                  {roleLabel(person.role)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
