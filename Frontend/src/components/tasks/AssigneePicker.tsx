import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { getErrorMessage } from '../../api/axios'
import { PEOPLE_WORDS, type PickerWords } from './pickerWords'
import type { AssigneeOption } from './types'

type Props = {
  // Id of the button
  id: string
  // Id of the element that labels the picker; the button is named by it and by what it shows
  labelId?: string
  value: AssigneeOption[]
  onChange: (next: AssigneeOption[]) => void
  // The people matching what was typed ('' lists the first few)
  load: (query: string) => Promise<AssigneeOption[]>
  // Pick one person (or nobody) instead of several
  single?: boolean
  // Shown on the button while nothing is picked
  placeholder: string
  max?: number
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  // What the list is called, if it isn't people
  words?: PickerWords
  // With `single`: whether the list offers "nobody" (the placeholder) as a choice. Off where a choice is required.
  allowEmpty?: boolean
}

// A button that opens a searchable list of people: checkboxes to pick several,
// or radio buttons to pick one. Everything is reachable by keyboard, Escape
// closes the list and returns to the button, and the chips below the button
// name each pick with a button to remove it.
export default function AssigneePicker({
  id,
  labelId,
  value,
  onChange,
  load,
  single = false,
  placeholder,
  max,
  invalid,
  describedBy,
  disabled,
  words = PEOPLE_WORDS,
  allowEmpty = true,
}: Props) {
  const listId = useId()
  const summaryId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<AssigneeOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // Loads the list when it opens and, a moment after typing stops, when the search changes
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const people = await load(query)
        if (!cancelled) setOptions(people)
      } catch (failure) {
        if (!cancelled) setError(getErrorMessage(failure, words.failure))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, query ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, load, reloadKey, words.failure])

  const selectedIds = value.map((person) => person._id)
  const atLimit = !single && max !== undefined && value.length >= max

  const toggle = (person: AssigneeOption) => {
    if (single) {
      onChange([person])
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    onChange(selectedIds.includes(person._id) ? value.filter((entry) => entry._id !== person._id) : [...value, person])
  }

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const summary = single
    ? value[0]?.name || placeholder
    : value.length === 0
      ? placeholder
      : `${value.length} user${value.length > 1 ? 's' : ''} selected`

  return (
    <div
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Close the list, not the dialog around it
          event.stopPropagation()
          event.preventDefault()
          close()
          buttonRef.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId ? `${labelId} ${summaryId}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-neutral-50 px-4 py-2.5 text-left text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10 disabled:opacity-60 ${
          invalid ? 'border-red-400' : 'border-neutral-200'
        }`}
      >
        <span id={summaryId} className={`min-w-0 truncate ${value.length > 0 ? 'text-neutral-900' : 'text-neutral-500'}`}>{summary}</span>
        <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        // tabIndex keeps focus inside when a click lands on the list's own padding or scrollbar
        <div id={listId} role="group" aria-label={words.choose} tabIndex={-1} className="mt-2 rounded-xl border border-neutral-200 bg-white shadow-sm outline-none">
          <div className="border-b border-neutral-100 p-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter in the search box searches; it must not send the form around it
                if (event.key === 'Enter') event.preventDefault()
              }}
              aria-label={words.search}
              placeholder={words.hint}
              autoComplete="off"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
            />
          </div>
          <div className="max-h-52 overflow-y-auto" aria-busy={loading}>
            {single && allowEmpty && (
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-neutral-50">
                <input
                  type="radio"
                  name={listId}
                  checked={value.length === 0}
                  onChange={() => {
                    onChange([])
                    setOpen(false)
                    buttonRef.current?.focus()
                  }}
                  className="h-4 w-4"
                />
                {placeholder}
              </label>
            )}
            {error ? (
              <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-700">
                <span>{error}</span>
                <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-medium underline">
                  Retry
                </button>
              </div>
            ) : loading && options.length === 0 ? (
              <p role="status" className="px-4 py-3 text-sm text-neutral-500">{words.loading}</p>
            ) : options.length === 0 ? (
              <p role="status" className="px-4 py-3 text-sm text-neutral-500">{query ? words.noMatch : words.empty}</p>
            ) : (
              options.map((person) => {
                const checked = selectedIds.includes(person._id)
                return (
                  <label
                    key={person._id}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-50 ${!checked && atLimit ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={single ? listId : undefined}
                      checked={checked}
                      disabled={!checked && atLimit}
                      onChange={() => toggle(person)}
                      className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-900">{person.name}</span>
                      {person.email && <span className="block truncate text-xs text-neutral-500">{person.email}</span>}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {atLimit && <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">A task can have at most {max} people.</p>}
        </div>
      )}

      {!single && value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Chosen people">
          {value.map((person) => (
            <li key={person._id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-1 pl-3 pr-1 text-xs font-medium text-neutral-700">
              {person.name}
              <button
                type="button"
                onClick={() => toggle(person)}
                aria-label={`Remove ${person.name}`}
                className="rounded-full p-1 hover:bg-neutral-200"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {single ? '' : `${value.length} ${value.length === 1 ? 'person' : 'people'} chosen`}
      </span>
    </div>
  )
}
