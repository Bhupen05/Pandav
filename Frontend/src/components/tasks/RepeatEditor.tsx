import { useId } from 'react'
import { repeatUnit } from './taskFormat'
import type { RepeatFrequency } from './types'

// The repeat settings while the form is open; null means "does not repeat"
export type RepeatDraft = { frequency: RepeatFrequency; interval: string; until: string }

type Props = {
  value: RepeatDraft | null
  onChange: (next: RepeatDraft | null) => void
  startDate: string
  error?: string
  errorId?: string
}

const FIELD =
  'block w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10'

export default function RepeatEditor({ value, onChange, startDate, error, errorId }: Props) {
  const toggleId = useId()
  const frequencyId = useId()
  const intervalId = useId()
  const untilId = useId()
  const interval = Number(value?.interval)

  return (
    <div>
      <label htmlFor={toggleId} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-700">
        <input
          id={toggleId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked ? { frequency: 'weekly', interval: '1', until: '' } : null)}
          aria-describedby={error ? errorId : undefined}
          className="h-4 w-4 rounded border-neutral-300"
        />
        Repeat this task
      </label>

      {value && (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={frequencyId} className="mb-1.5 block text-sm font-medium text-neutral-700">Repeats</label>
            <select
              id={frequencyId}
              value={value.frequency}
              onChange={(event) => onChange({ ...value, frequency: event.target.value as RepeatFrequency })}
              className={FIELD}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label htmlFor={intervalId} className="mb-1.5 block text-sm font-medium text-neutral-700">
              Every ({repeatUnit(value.frequency, interval || 1)})
            </label>
            <input
              id={intervalId}
              type="number"
              min={1}
              max={12}
              step={1}
              inputMode="numeric"
              value={value.interval}
              onChange={(event) => onChange({ ...value, interval: event.target.value })}
              onKeyDown={(event) => {
                if (['.', ',', 'e', 'E', '-', '+'].includes(event.key)) event.preventDefault()
              }}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor={untilId} className="mb-1.5 block text-sm font-medium text-neutral-700">
              Repeat until <span className="text-xs font-normal text-neutral-500">(optional)</span>
            </label>
            <input
              id={untilId}
              type="date"
              value={value.until}
              min={startDate || undefined}
              onChange={(event) => onChange({ ...value, until: event.target.value })}
              className={FIELD}
            />
          </div>
          <p className="text-xs text-neutral-500 sm:col-span-3">
            When this task starts a new period, Pandav creates the next copy for the same people, with the checklist unticked. Untick
            &quot;Repeat this task&quot; to stop the series.
          </p>
        </div>
      )}
      {error && <p id={errorId} className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  )
}
