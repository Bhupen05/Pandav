import { useEffect, useId, useState } from 'react'
import { Search } from 'lucide-react'
import { teamErrorMessage } from './format'
import { useDebounced } from './hooks'
import { Avatar } from './ui'

export type PickerPerson = {
  _id: string
  name: string
  email?: string
  department?: string
  profileImage?: string
  // A line under the name, e.g. "Member of this team"
  note?: string
  // Listed, but can't be picked (e.g. an invite is already waiting)
  unavailable?: boolean
}

type Props = {
  label: string
  // Wrap in useCallback: a new function starts a new search
  search: (query: string) => Promise<PickerPerson[]>
  value: PickerPerson | null
  onChange: (person: PickerPerson) => void
  // Characters to type before searching (0: people are listed at once)
  minChars?: number
  hint?: string
  disabled?: boolean
}

type Found = { query: string; people: PickerPerson[]; error: string }

// Search for a person and pick one of the results. Nobody is listed unless
// the search finds them, so the picker never offers someone the server would
// refuse.
export default function PersonPicker({ label, search, value, onChange, minChars = 0, hint, disabled }: Props) {
  const inputId = useId()
  const hintId = useId()
  const groupName = useId()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [attempt, setAttempt] = useState(0)

  const debounced = useDebounced(query).trim()
  const ready = debounced.length >= minChars
  const current = found && found.query === debounced ? found : null
  const searching = ready && (!current || query.trim() !== debounced)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    search(debounced).then(
      (people) => {
        if (!cancelled) setFound({ query: debounced, people, error: '' })
      },
      (error) => {
        if (!cancelled) {
          setFound({ query: debounced, people: [], error: teamErrorMessage(error, 'Could not search for people.') })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [debounced, ready, search, attempt])

  const people = ready && current ? current.people : []

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
          placeholder={minChars > 0 ? `Type at least ${minChars} letters` : 'Search by name or email'}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
        />
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      )}

      <div className="mt-2" aria-live="polite">
        {!ready && minChars > 0 && <p className="text-sm text-gray-500">Type at least {minChars} letters to see people.</p>}
        {searching && !current && <p className="text-sm text-gray-500">Searching…</p>}
        {ready && current?.error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p>{current.error}</p>
            <button
              type="button"
              onClick={() => {
                setFound(null)
                setAttempt((count) => count + 1)
              }}
              className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}
        {ready && current && !current.error && people.length === 0 && (
          <p className="text-sm text-gray-500">
            {debounced ? `Nobody matches "${debounced}".` : 'Nobody is available right now.'}
          </p>
        )}
      </div>

      {people.length > 0 && (
        <fieldset className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1">
          <legend className="sr-only">{label}: results</legend>
          {people.map((person) => {
            const details = [person.department, person.email, person.note].filter(Boolean).join(' · ')
            const selected = value?._id === person._id
            return (
              <label
                key={person._id}
                className={`flex items-center gap-3 rounded-lg border px-2 py-2 ${
                  person.unavailable
                    ? 'cursor-not-allowed border-transparent opacity-60'
                    : selected
                      ? 'cursor-pointer border-blue-500 bg-blue-50'
                      : 'cursor-pointer border-transparent hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  checked={selected}
                  disabled={disabled || person.unavailable}
                  onChange={() => onChange(person)}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <Avatar name={person.name} src={person.profileImage} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{person.name}</span>
                  {details && <span className="block truncate text-xs text-gray-500">{details}</span>}
                </span>
              </label>
            )
          })}
        </fieldset>
      )}

      {value && (
        <p className="mt-2 text-sm text-gray-700">
          Selected: <span className="font-medium text-gray-900">{value.name}</span>
        </p>
      )}
    </div>
  )
}
