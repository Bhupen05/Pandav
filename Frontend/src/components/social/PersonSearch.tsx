import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { errorText, listOf, roleLabel } from './format'
import { inputClass, labelClass } from './styles'
import type { Person } from './types'

export type PickedPerson = { id: string; name: string }

const MIN_CHARACTERS = 2
const WAIT_MS = 300

type Found = { query: string; people: Person[]; error?: string }

// Finds one person by name (admins: by name or email too, GET /users/search,
// at least 2 characters) and hands back their id. Once someone is chosen their
// name shows in place of the box, with a button to take the choice back.
// `self` is the signed-in person: the search leaves them out, so they are
// offered here when what was typed matches them.
export default function PersonSearch({
  label,
  value,
  onChange,
  self,
  placeholder = 'Search by name or email',
}: {
  label: string
  value: PickedPerson | null
  onChange: (person: PickedPerson | null) => void
  self?: Person | null
  placeholder?: string
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [found, setFound] = useState<Found | null>(null)

  // Search once typing pauses
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  useEffect(() => {
    if (query.length < MIN_CHARACTERS) return
    const controller = new AbortController()
    socialV2API.searchPeople(query, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) setFound({ query, people: listOf<Person>(response?.data) })
      },
      (error) => {
        if (!controller.signal.aborted) setFound({ query, people: [], error: errorText(error, 'Couldn’t search for people. Try again.') })
      },
    )
    return () => controller.abort()
  }, [query])

  const typed = text.trim()
  const ready = typed.length >= MIN_CHARACTERS
  const current = ready && found && found.query === typed ? found : null
  const matchesSelf = Boolean(
    self && ready && [self.name, self.email].some((field) => field?.toLowerCase().includes(typed.toLowerCase())),
  )
  const matches = current && !current.error ? current.people : []
  const people = matchesSelf && self && current && !current.error && !matches.some((person) => person._id === self._id) ? [...matches, self] : matches
  const showBox = open && !value && typed.length > 0
  const status = !showBox
    ? ''
    : !ready
      ? `Type at least ${MIN_CHARACTERS} characters.`
      : !current
        ? 'Searching…'
        : current.error
          ? current.error
          : people.length === 0
            ? 'No one found.'
            : ''

  const choose = (person: Person) => {
    onChange({ id: person._id, name: person.name })
    setText('')
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  const clear = () => {
    onChange(null)
    setText('')
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (people.length === 0) return
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length)
      return
    }
    if (event.key === 'Enter' && showBox && people[active]) {
      event.preventDefault()
      choose(people[active])
    }
  }

  if (value) {
    return (
      <div>
        <span id={`${id}-label`} className={labelClass}>{label}</span>
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-1.5 pl-4 pr-1.5 text-sm"
        >
          <span className="min-w-0 truncate py-1.5 font-semibold text-slate-900">{value.name}</span>
          <button
            type="button"
            onClick={clear}
            aria-label={`Show posts by everyone, not only ${value.name}`}
            className="shrink-0 rounded-full p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={boxRef}
      className="relative"
      onBlur={(event) => {
        if (!boxRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <label htmlFor={`${id}-input`} className={labelClass}>{label}</label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="search"
        role="combobox"
        aria-expanded={showBox && people.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showBox && people[active] ? `${id}-option-${people[active]._id}` : undefined}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={inputClass}
      />
      {showBox ? (
        <div className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg">
          {status ? <p role="status" className="px-4 py-2 text-sm text-slate-600">{status}</p> : null}
          <ul id={`${id}-list`} role="listbox" aria-label={`${label}: people found`}>
            {people.map((person, index) => (
              <li
                key={person._id}
                id={`${id}-option-${person._id}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-4 py-2 text-sm ${index === active ? 'bg-sky-50' : ''}`}
              >
                <span className="block break-words font-semibold text-slate-900">
                  {person.name}
                  {person._id === self?._id ? ' (you)' : ''}
                </span>
                <span className="block break-all text-xs text-slate-500">
                  {[person.email, roleLabel(person.role)].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
