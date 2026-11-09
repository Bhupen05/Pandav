import { useId, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { errorText, priorityLabel, taskStatusLabel } from './format'
import { BusyButton } from './ui'
import { hintClass, inputClass, labelClass, primaryButton, secondaryButton } from './styles'
import { TODO_DESCRIPTION_MAX, TODO_TITLE_MAX, type TodoValues } from './todoValues'
import type { PersonalTaskStatus, Priority } from './types'

// The to-do form, to add one or to edit one. `onSubmit` rejects when the
// server refuses; the message is shown under the form.
export default function TodoForm({
  initial,
  submitLabel,
  busyLabel,
  showStatus = false,
  onSubmit,
  onCancel,
}: {
  initial: TodoValues
  submitLabel: string
  busyLabel: string
  // Editing: the status can be changed here too
  showStatus?: boolean
  onSubmit: (values: TodoValues) => Promise<void>
  onCancel?: () => void
}) {
  const id = useId()
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof TodoValues>(key: K, value: TodoValues[K]) => setValues((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const title = values.title.trim()
    if (!title) return setError('Give the to-do a title.')
    setError('')
    setSaving(true)
    try {
      await onSubmit({ ...values, title, description: values.description.trim() })
      // Adding: ready for the next one. Editing: the dialog closes itself.
      if (!onCancel) setValues(initial)
    } catch (submitError) {
      setError(errorText(submitError, 'Couldn’t save the to-do. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div>
        <label htmlFor={`${id}-title`} className={labelClass}>Title</label>
        <input
          id={`${id}-title`}
          value={values.title}
          maxLength={TODO_TITLE_MAX}
          required
          onChange={(event) => set('title', event.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className={labelClass}>Description <span className="font-normal text-slate-500">(optional)</span></label>
        <textarea
          id={`${id}-description`}
          value={values.description}
          maxLength={TODO_DESCRIPTION_MAX}
          rows={3}
          onChange={(event) => set('description', event.target.value)}
          aria-describedby={`${id}-description-hint`}
          className={`${inputClass} rounded-[24px]`}
        />
        <p id={`${id}-description-hint`} className={`${hintClass} text-right`}>{values.description.length}/{TODO_DESCRIPTION_MAX}</p>
      </div>
      <div className={`grid gap-3 ${showStatus ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div>
          <label htmlFor={`${id}-priority`} className={labelClass}>Priority</label>
          <select id={`${id}-priority`} value={values.priority} onChange={(event) => set('priority', event.target.value as Priority)} className={inputClass}>
            {(Object.keys(priorityLabel) as Priority[]).map((priority) => (
              <option key={priority} value={priority}>{priorityLabel[priority]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-due`} className={labelClass}>Due date <span className="font-normal text-slate-500">(optional)</span></label>
          <input id={`${id}-due`} type="date" value={values.dueDate} onChange={(event) => set('dueDate', event.target.value)} className={inputClass} />
        </div>
        {showStatus ? (
          <div>
            <label htmlFor={`${id}-status`} className={labelClass}>Status</label>
            <select id={`${id}-status`} value={values.status} onChange={(event) => set('status', event.target.value as PersonalTaskStatus)} className={inputClass}>
              {(Object.keys(taskStatusLabel) as PersonalTaskStatus[]).map((status) => (
                <option key={status} value={status}>{taskStatusLabel[status]}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={values.autoShare}
          onChange={(event) => set('autoShare', event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span>Offer to share it when I finish it. You read and change the post first; nothing goes out without you.</span>
      </label>

      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
        ) : null}
        <BusyButton
          type="submit"
          busy={saving}
          busyLabel={busyLabel}
          icon={onCancel ? undefined : <Plus className="h-4 w-4" aria-hidden="true" />}
          className={primaryButton}
        >
          {submitLabel}
        </BusyButton>
      </div>
    </form>
  )
}
