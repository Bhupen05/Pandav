import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { attendanceAPI, type Holiday } from '../../api/attendanceAPI'
import { useFeedback } from '../../context/useFeedback'
import { formatDay } from '../../utils/date'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { describeError } from './labels'
import { EmptyState, ErrorState, Loading } from './States'
import { useLoad } from './useLoad'

// The "Holidays" tab: days nobody is expected to work, listed by year
export default function AdminHolidays() {
  const { notify, confirm } = useFeedback()
  const [year, setYear] = useState(new Date().getFullYear())
  const [day, setDay] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [formError, setFormError] = useState('')
  const [deletingId, setDeletingId] = useState('')

  const holidays = useLoad(() => attendanceAPI.getHolidays(year), String(year))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!day) return setFormError('Choose the date of the holiday.')
    if (!name.trim()) return setFormError('Give the holiday a name.')
    setAdding(true)
    setFormError('')
    try {
      await attendanceAPI.createHoliday({ day, name: name.trim() })
      notify(`Added the holiday ${name.trim()} on ${formatDay(day)}.`, 'success')
      const addedYear = Number(day.slice(0, 4))
      setDay('')
      setName('')
      if (addedYear !== year && addedYear >= 2000) setYear(addedYear)
      else holidays.refresh()
    } catch (failure) {
      setFormError(describeError(failure, 'Could not add the holiday.'))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (holiday: Holiday) => {
    const ok = await confirm({
      title: 'Remove this holiday?',
      message: `${holiday.name}, ${formatDay(holiday.day)}. People will be expected to work that day again.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setDeletingId(holiday._id)
    try {
      await attendanceAPI.deleteHoliday(holiday._id)
      notify(`Removed the holiday ${holiday.name}.`, 'success')
      await holidays.refresh()
    } catch (failure) {
      notify(describeError(failure, 'Could not remove the holiday.'), 'error')
    } finally {
      setDeletingId('')
    }
  }

  const list = holidays.data?.data ?? []

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section aria-labelledby="holiday-add-title" className="h-fit rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 id="holiday-add-title" className="font-semibold text-neutral-900">Add a holiday</h2>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="holiday-day" className={labelClass}>Date</label>
            <input id="holiday-day" type="date" value={day} onChange={(event) => setDay(event.target.value)} required className={inputClass} />
          </div>
          <div>
            <label htmlFor="holiday-name" className={labelClass}>Holiday name</label>
            <input id="holiday-name" type="text" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required className={inputClass} />
          </div>
          {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
          <button type="submit" disabled={adding} className={primaryButton}>
            {adding ? 'Adding…' : 'Add holiday'}
          </button>
        </form>
      </section>

      <section aria-labelledby="holiday-list-title" className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
          <h2 id="holiday-list-title" className="font-semibold text-neutral-900">Holidays in {year}</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setYear(year - 1)} className={secondaryButton} aria-label="Previous year">‹</button>
            <label htmlFor="holiday-year" className="sr-only">Year</label>
            <input
              id="holiday-year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (value >= 2000 && value <= 2100) setYear(value)
              }}
              className={`${inputClass} w-24 text-center`}
            />
            <button type="button" onClick={() => setYear(year + 1)} className={secondaryButton} aria-label="Next year">›</button>
          </div>
        </div>

        {holidays.error && !holidays.data ? (
          <div className="p-4"><ErrorState message={holidays.error} onRetry={holidays.reload} /></div>
        ) : holidays.loading && !holidays.data ? (
          <Loading label="Loading the holidays…" />
        ) : list.length === 0 ? (
          <EmptyState>No holidays are set for {year}.</EmptyState>
        ) : (
          <ul className={`divide-y divide-neutral-200 ${holidays.loading ? 'opacity-60' : ''}`}>
            {list.map((holiday) => (
              <li key={holiday._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-neutral-900">{holiday.name}</p>
                  <p className="text-sm text-neutral-700">{formatDay(holiday.day)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(holiday)}
                  disabled={deletingId === holiday._id}
                  aria-label={`Remove the holiday ${holiday.name}`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
