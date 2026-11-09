import { useId, useState, type FormEvent } from 'react'
import { teamAPI } from '../../api/teamAPI'
import { dayIn, PRIORITY_LABELS, SERVER_TIME_ZONE, teamErrorMessage } from './format'
import type { TeamPerson, TeamTask } from './types'
import { inputClass, primaryButton, secondaryButton, TeamDialog } from './ui'

type Props = {
  teamId: string
  // Leaders and members of the team
  people: TeamPerson[]
  // The signed-in leader: they can put themselves on a new task, but a task
  // they are on can't be managed by them
  meId?: string
  // Set when editing an existing task
  task?: TeamTask
  onClose: () => void
  onSaved: () => void
}

// Create a team task, or edit one. Failures show in the dialog: a toast
// would sit behind it.
export default function TaskFormDialog({ teamId, people, meId, task, onClose, onSaved }: Props) {
  const ids = { title: useId(), description: useId(), priority: useId(), start: useId(), due: useId() }
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [assignees, setAssignees] = useState<string[]>(() => task?.assignedTo.map((person) => person._id) ?? [])
  const [priority, setPriority] = useState(task?.priority ?? 'medium')
  const [startDate, setStartDate] = useState(() => task?.startDate?.slice(0, 10) ?? dayIn(SERVER_TIME_ZONE))
  const [dueDate, setDueDate] = useState(() => task?.dueDay ?? task?.dueDate?.slice(0, 10) ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // People who can take the task: not deactivated (unless already on it), and
  // not the leader themselves when editing
  const choices = people.filter(
    (person) => (person.isActive !== false || assignees.includes(person._id)) && !(task && person._id === meId),
  )

  const toggle = (id: string) =>
    setAssignees((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (assignees.length === 0) {
      setError('Choose at least one person for this task.')
      return
    }
    setSaving(true)
    setError('')
    const body = {
      title: title.trim(),
      description: description.trim(),
      assignedTo: assignees,
      priority,
      startDate,
      dueDate,
    }
    try {
      if (task) await teamAPI.updateTask(task._id, body)
      else await teamAPI.createTeamTask(teamId, body)
      onSaved()
    } catch (failure) {
      setError(teamErrorMessage(failure, task ? 'Could not save the task.' : 'Could not create the task.'))
      setSaving(false)
    }
  }

  return (
    <TeamDialog
      title={task ? 'Edit Task' : 'Create Team Task'}
      description={task ? 'Saving a change marks the task as edited by you, with the time.' : undefined}
      onClose={onClose}
      busy={saving}
      wide
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor={ids.title} className="text-sm font-medium text-gray-700">
            Title <span aria-hidden="true">*</span>
          </label>
          <input
            id={ids.title}
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={saving}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={ids.description} className="text-sm font-medium text-gray-700">
            Description <span aria-hidden="true">*</span>
          </label>
          <textarea
            id={ids.description}
            required
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={saving}
            className={inputClass}
          />
        </div>

        <fieldset disabled={saving}>
          <legend className="text-sm font-medium text-gray-700">
            Assign To <span aria-hidden="true">*</span>
          </legend>
          {choices.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">Nobody in the team can be given this task.</p>
          ) : (
            <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-300 p-1">
              {choices.map((person) => (
                <label key={person._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-800 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={assignees.includes(person._id)}
                    onChange={() => toggle(person._id)}
                    className="h-4 w-4 shrink-0 accent-blue-600"
                  />
                  <span className="min-w-0 truncate">
                    {person.name}
                    {person._id === meId ? ' (you)' : ''}
                  </span>
                </label>
              ))}
            </div>
          )}
          {!task && meId && (
            <p className="mt-1 text-xs text-gray-500">
              A task you are on can’t be changed or approved by you: an admin or another leader does that.
            </p>
          )}
        </fieldset>

        <div>
          <label htmlFor={ids.priority} className="text-sm font-medium text-gray-700">
            Priority
          </label>
          <select
            id={ids.priority}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            disabled={saving}
            className={inputClass}
          >
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.start} className="text-sm font-medium text-gray-700">
              Start Date <span aria-hidden="true">*</span>
            </label>
            <input
              id={ids.start}
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              disabled={saving}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={ids.due} className="text-sm font-medium text-gray-700">
              Due Date <span aria-hidden="true">*</span>
            </label>
            <input
              id={ids.due}
              required
              type="date"
              min={startDate || undefined}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={saving}
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? (task ? 'Saving…' : 'Creating…') : task ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </form>
    </TeamDialog>
  )
}
