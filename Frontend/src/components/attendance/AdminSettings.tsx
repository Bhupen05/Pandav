import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { attendanceAPI, type AttendanceSettings } from '../../api/attendanceAPI'
import { useFeedback } from '../../context/useFeedback'
import { formatDateTime } from '../../utils/date'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { describeError, describeShift, WEEKDAYS } from './labels'
import { ErrorState, Loading } from './States'

type TypeRow = { key: string; label: string; daysPerYear: string; unlimited: boolean; isNew: boolean }

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,29}$/

function SettingsForm({ settings, onSaved }: { settings: AttendanceSettings; onSaved: () => void }) {
  const { notify } = useFeedback()
  const [workdays, setWorkdays] = useState<number[]>(settings.workdays)
  const [shiftStart, setShiftStart] = useState(settings.shiftStart ?? '')
  const [noShift, setNoShift] = useState(settings.shiftStart === null)
  const [lateAfter, setLateAfter] = useState(String(settings.lateAfterMinutes))
  const [halfDayHours, setHalfDayHours] = useState(settings.halfDayHours === null ? '' : String(settings.halfDayHours))
  const [noHalfDay, setNoHalfDay] = useState(settings.halfDayHours === null)
  const [autoAbsent, setAutoAbsent] = useState(settings.autoAbsent)
  const [types, setTypes] = useState<TypeRow[]>(
    settings.leaveTypes.map((type) => ({
      key: type.key,
      label: type.label,
      daysPerYear: type.daysPerYear === null ? '' : String(type.daysPerYear),
      unlimited: type.daysPerYear === null,
      isNew: false,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleDay = (day: number) =>
    setWorkdays((previous) => (previous.includes(day) ? previous.filter((value) => value !== day) : [...previous, day].sort((a, b) => a - b)))

  const updateType = (index: number, change: Partial<TypeRow>) =>
    setTypes((previous) => previous.map((row, position) => (position === index ? { ...row, ...change } : row)))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const late = Number(lateAfter)
    if (workdays.length === 0) return setError('Choose at least one working day.')
    if (!noShift && !shiftStart) return setError("Choose when the shift starts, or tick 'No fixed start time'.")
    if (!Number.isInteger(late) || late < 0 || late > 720) return setError('Late after must be a whole number of minutes from 0 to 720.')
    const half = Number(halfDayHours)
    if (!noHalfDay && !(half > 0 && half <= 24)) return setError("Half-day hours must be above 0 and at most 24, or tick 'Off'.")
    if (types.length === 0) return setError('Keep at least one type of leave.')
    if (types.length > 20) return setError('There can be at most 20 types of leave.')
    const keys = new Set<string>()
    for (const row of types) {
      if (!KEY_PATTERN.test(row.key)) return setError(`The code "${row.key}" must start with a lowercase letter and use only lowercase letters, digits, - or _ (30 characters at most).`)
      if (keys.has(row.key)) return setError(`The code "${row.key}" is used twice.`)
      keys.add(row.key)
      if (!row.label.trim() || row.label.trim().length > 60) return setError(`Give "${row.key}" a name of up to 60 characters.`)
      if (!row.unlimited) {
        const days = Number(row.daysPerYear)
        if (row.daysPerYear === '' || !Number.isInteger(days) || days < 0 || days > 366) return setError(`Days a year for "${row.label || row.key}" must be a whole number from 0 to 366, or tick 'No limit'.`)
      }
    }

    setSaving(true)
    setError('')
    try {
      await attendanceAPI.updateSettings({
        workdays,
        shiftStart: noShift ? null : shiftStart,
        lateAfterMinutes: late,
        halfDayHours: noHalfDay ? null : half,
        autoAbsent,
        leaveTypes: types.map((row) => ({ key: row.key, label: row.label.trim(), daysPerYear: row.unlimited ? null : Number(row.daysPerYear) })),
      })
      notify('Attendance settings saved.', 'success')
      onSaved()
    } catch (failure) {
      setError(describeError(failure, 'Could not save the settings.'))
    } finally {
      setSaving(false)
    }
  }

  const preview = describeShift({ ...settings, shiftStart: noShift ? null : shiftStart || null, lateAfterMinutes: Number(lateAfter) || 0 })

  return (
    <form onSubmit={onSubmit} className="space-y-8 p-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-neutral-900">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <label
              key={day.value}
              className={`relative flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-neutral-900 focus-within:ring-offset-2 ${workdays.includes(day.value) ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-800'}`}
            >
              <input type="checkbox" checked={workdays.includes(day.value)} onChange={() => toggleDay(day.value)} className="sr-only" />
              <span aria-hidden="true">{day.short}</span>
              <span className="sr-only">{day.long}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-neutral-600">Leave requests skip the other days, and nobody is marked absent on them.</p>
      </fieldset>

      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <label htmlFor="settings-shift" className={labelClass}>Shift start</label>
          <input
            id="settings-shift"
            type="time"
            value={shiftStart}
            onChange={(event) => {
              setShiftStart(event.target.value)
              setNoShift(false)
            }}
            className={inputClass}
          />
          <label htmlFor="settings-no-shift" className="mt-2 flex items-center gap-2 text-sm text-neutral-800">
            <input id="settings-no-shift" type="checkbox" checked={noShift} onChange={(event) => setNoShift(event.target.checked)} className="h-4 w-4" />
            No fixed start time (nobody is marked late)
          </label>
        </div>
        <div>
          <label htmlFor="settings-late" className={labelClass}>Late after (minutes)</label>
          <input id="settings-late" type="number" min={0} max={720} step={1} value={lateAfter} onChange={(event) => setLateAfter(event.target.value)} className={inputClass} />
          <p className="mt-1 text-xs text-neutral-600">Grace minutes after the shift starts.</p>
        </div>
        <div>
          <label htmlFor="settings-half" className={labelClass}>Half-day hours</label>
          <input
            id="settings-half"
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            value={halfDayHours}
            onChange={(event) => {
              setHalfDayHours(event.target.value)
              setNoHalfDay(false)
            }}
            className={inputClass}
          />
          <label htmlFor="settings-no-half" className="mt-2 flex items-center gap-2 text-sm text-neutral-800">
            <input id="settings-no-half" type="checkbox" checked={noHalfDay} onChange={(event) => setNoHalfDay(event.target.checked)} className="h-4 w-4" />
            Off (a short day stays a full day)
          </label>
        </div>
      </div>
      <p className="-mt-4 text-sm text-neutral-700" aria-live="polite">{preview}</p>

      <div>
        <label htmlFor="settings-auto" className="flex items-center gap-2 text-sm font-medium text-neutral-900">
          <input id="settings-auto" type="checkbox" checked={autoAbsent} onChange={(event) => setAutoAbsent(event.target.checked)} className="h-4 w-4" />
          Mark people absent automatically
        </label>
        <p className="mt-1 text-xs text-neutral-600">On a working day, people with no record the next morning are marked absent.</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-neutral-900">Types of leave</legend>
        <ul className="space-y-3">
          {types.map((row, index) => (
            <li key={index} className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 sm:grid-cols-[1fr_1.5fr_1fr_auto] sm:items-end">
              <div>
                <label htmlFor={`type-key-${index}`} className="mb-1 block text-xs font-medium text-neutral-700">Code</label>
                <input
                  id={`type-key-${index}`}
                  type="text"
                  value={row.key}
                  readOnly={!row.isNew}
                  maxLength={30}
                  onChange={(event) => updateType(index, { key: event.target.value.toLowerCase() })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`type-label-${index}`} className="mb-1 block text-xs font-medium text-neutral-700">Name</label>
                <input id={`type-label-${index}`} type="text" value={row.label} maxLength={60} onChange={(event) => updateType(index, { label: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor={`type-days-${index}`} className="mb-1 block text-xs font-medium text-neutral-700">Days a year</label>
                <input
                  id={`type-days-${index}`}
                  type="number"
                  min={0}
                  max={366}
                  step={1}
                  value={row.daysPerYear}
                  disabled={row.unlimited}
                  onChange={(event) => updateType(index, { daysPerYear: event.target.value })}
                  className={inputClass}
                />
                <label htmlFor={`type-unlimited-${index}`} className="mt-1 flex items-center gap-2 text-xs text-neutral-700">
                  <input id={`type-unlimited-${index}`} type="checkbox" checked={row.unlimited} onChange={(event) => updateType(index, { unlimited: event.target.checked })} className="h-3.5 w-3.5" />
                  No limit
                </label>
              </div>
              <button
                type="button"
                onClick={() => setTypes((previous) => previous.filter((_, position) => position !== index))}
                disabled={types.length === 1}
                aria-label={`Remove ${row.label || 'this type of leave'}`}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setTypes((previous) => [...previous, { key: '', label: '', daysPerYear: '', unlimited: true, isNew: true }])}
          disabled={types.length >= 20}
          className={`${secondaryButton} mt-3`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a type of leave
        </button>
        <p className="mt-2 text-xs text-neutral-600">Removing a type does not change days already recorded; they just stop appearing in balances.</p>
      </fieldset>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {settings.updatedAt && <p className="text-xs text-neutral-600">Last saved {formatDateTime(settings.updatedAt)}</p>}
      </div>
    </form>
  )
}

// The "Settings" tab: the rules for the whole organisation. The page loads
// them (other tabs use the leave types), so a save refreshes it there too.
type Props = {
  settings?: AttendanceSettings
  error?: string
  onRetry: () => void
  onSaved: () => void
}

export default function AdminSettings({ settings, error, onRetry, onSaved }: Props) {
  return (
    <section aria-labelledby="settings-title" className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <h2 id="settings-title" className="font-semibold text-neutral-900">Attendance rules</h2>
        <p className="text-sm text-neutral-700">One set of rules for everyone.</p>
      </div>
      {error && !settings ? (
        <div className="p-4"><ErrorState message={error} onRetry={onRetry} /></div>
      ) : !settings ? (
        <Loading label="Loading the rules…" />
      ) : (
        <SettingsForm key={settings.updatedAt ?? 'defaults'} settings={settings} onSaved={onSaved} />
      )}
    </section>
  )
}
