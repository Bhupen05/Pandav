import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { taskAPI, type TaskPayload } from '../api/taskAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import type { AssigneeProgress } from '../utils/taskProgress'
import AssigneePicker from './tasks/AssigneePicker'
import ChecklistEditor from './tasks/ChecklistEditor'
import RepeatEditor, { type RepeatDraft } from './tasks/RepeatEditor'
import { usePeopleLoader } from './tasks/usePeopleLoader'
import { MAX_CHECKLIST_ITEMS, newDraft, type ChecklistDraft } from './tasks/checklistDraft'
import type { AssigneeOption, ChecklistItem, Recurrence, TaskPriority } from './tasks/types'

// The API returns populated users; freshly built inputs hold plain ids
export type UserRef = { _id: string; name?: string; email?: string; profileImage?: string }

export type TaskInput = {
	_id?: string
	title: string
	description: string
	startDate: string
	dueDate: string
	// The due day as the server works it out (YYYY-MM-DD)
	dueDay?: string
	estimatedDays?: number
	priority: 'low' | 'medium' | 'high' | 'urgent'
	status: 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'completion-requested'
	assignedTo: Array<string | UserRef>
	tags?: string[]
	notes?: string
	createdBy?: string | UserRef
	assigneeProgress?: AssigneeProgress[]
	checklist?: ChecklistItem[]
	recurrence?: Recurrence | null
	// Last change to the details by an admin or team leader
	editedBy?: string | UserRef
	editedAt?: string
}

type Props = {
	isOpen: boolean
	onClose: () => void
	// Called with the task as the server saved it, just before the form closes
	onCreate?: (task: TaskInput) => void
	// When set, the modal edits this task instead of creating a new one
	task?: TaskInput | null
}

type FieldKey = 'title' | 'description' | 'startDate' | 'dueDate' | 'estimatedDays' | 'assignedTo' | 'checklist' | 'recurrence'
type Errors = Partial<Record<FieldKey, string>>

const MAX_ASSIGNEES = 50

const FIELD =
	'block w-full rounded-xl border bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10'
const fieldBorder = (invalid: boolean) => (invalid ? 'border-red-400' : 'border-neutral-200')

const PRIORITY_ACTIVE: Record<TaskPriority, string> = {
	low: 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500',
	medium: 'bg-blue-100 text-blue-700 ring-2 ring-blue-500',
	high: 'bg-orange-100 text-orange-700 ring-2 ring-orange-500',
	urgent: 'bg-red-100 text-red-700 ring-2 ring-red-500',
}

// Both ends count: a task that starts and is due on the same day is one day
const inclusiveDays = (start: string, due: string) => {
	if (!start || !due) return null
	const diff = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
	return Number.isFinite(diff) && diff >= 0 ? Math.round(diff) + 1 : null
}

// Which field a server message is about, so it can be shown beside that field
const fieldOf = (message: string): FieldKey | null => {
	const text = message.toLowerCase()
	if (text.includes('title')) return 'title'
	if (text.includes('description')) return 'description'
	if (text.includes('due date')) return 'dueDate'
	if (text.includes('start date')) return 'startDate'
	if (text.includes('checklist')) return 'checklist'
	if (/repeat|recurrence|daily, weekly/.test(text)) return 'recurrence'
	if (/assign|account|your team|team member|deactivated|at least one/.test(text)) return 'assignedTo'
	return null
}

const toOption = (ref: string | UserRef): AssigneeOption =>
	typeof ref === 'string' ? { _id: ref, name: 'Someone' } : { _id: ref._id, name: ref.name || 'Someone', email: ref.email }

function TaskFormDialog({ task, isAdmin, onClose, onCreate }: { task: TaskInput | null; isAdmin: boolean; onClose: () => void; onCreate?: (task: TaskInput) => void }) {
	const { notify } = useFeedback()
	const isEditing = !!task?._id
	const uid = useId()
	const id = (name: string) => `${uid}-${name}`
	const dialogRef = useRef<HTMLDialogElement>(null)
	const formRef = useRef<HTMLFormElement>(null)

	const startDay = task?.startDate?.slice(0, 10) || ''
	const dueDay = task?.dueDay || task?.dueDate?.slice(0, 10) || ''
	const [title, setTitle] = useState(task?.title || '')
	const [description, setDescription] = useState(task?.description || '')
	const [startDate, setStartDate] = useState(startDay)
	const [dueDate, setDueDate] = useState(dueDay)
	const [estimatedDays, setEstimatedDays] = useState(String(task?.estimatedDays ?? 1))
	// Once the estimate is typed in, changing the dates no longer overwrites it
	const [estimateEdited, setEstimateEdited] = useState(task?.estimatedDays !== undefined)
	const [priority, setPriority] = useState<TaskPriority>(task?.priority || 'medium')
	const [assignees, setAssignees] = useState<AssigneeOption[]>(() => (task?.assignedTo || []).map(toOption))
	const [tags, setTags] = useState(task?.tags?.join(', ') || '')
	const [notes, setNotes] = useState(task?.notes || '')
	const [checklist, setChecklist] = useState<ChecklistDraft[]>(() => (task?.checklist || []).map((item) => newDraft(item.text, item)))
	const [repeat, setRepeat] = useState<RepeatDraft | null>(() =>
		task?.recurrence
			? { frequency: task.recurrence.frequency, interval: String(task.recurrence.interval || 1), until: task.recurrence.until?.slice(0, 10) || '' }
			: null,
	)
	const [errors, setErrors] = useState<Errors>({})
	const [formError, setFormError] = useState('')
	const [saving, setSaving] = useState(false)

	// showModal keeps focus inside the dialog and closes it on Escape
	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
		return () => dialog?.close()
	}, [])

	// Admins pick from every active account; leaders from the people in their team
	const loadPeople = usePeopleLoader(isAdmin)

	const changeDates = (nextStart: string, nextDue: string) => {
		setStartDate(nextStart)
		setDueDate(nextDue)
		if (!estimateEdited) {
			const days = inclusiveDays(nextStart, nextDue)
			if (days) setEstimatedDays(String(days))
		}
	}

	const clearError = (key: FieldKey) => setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current))

	const validate = (): Errors => {
		const found: Errors = {}
		if (!title.trim()) found.title = 'Enter a title.'
		if (!description.trim()) found.description = 'Enter a description.'
		if (!startDate) found.startDate = 'Choose a start date.'
		if (!dueDate) found.dueDate = 'Choose a due date.'
		// Both are YYYY-MM-DD, so string comparison is date order
		else if (startDate && dueDate < startDate) found.dueDate = 'The due date cannot be before the start date.'
		if (estimatedDays.trim() !== '' && !(Number(estimatedDays) > 0)) found.estimatedDays = 'Enter a number of days above zero.'
		if (assignees.length === 0) found.assignedTo = 'Choose at least one person for this task.'
		else if (assignees.length > MAX_ASSIGNEES) found.assignedTo = `A task can have at most ${MAX_ASSIGNEES} people.`
		if (checklist.some((item) => !item.text.trim())) found.checklist = 'Every checklist item needs some text.'
		if (repeat) {
			const every = Number(repeat.interval)
			if (!Number.isInteger(every) || every < 1 || every > 12) found.recurrence = 'Repeat every 1 to 12 days, weeks or months.'
			else if (repeat.until && startDate && repeat.until < startDate) found.recurrence = "The repeat end date can't be before the start date."
		}
		return found
	}

	const focusFirstProblem = () =>
		setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault()
		if (saving) return
		setFormError('')

		const found = validate()
		setErrors(found)
		if (Object.keys(found).length > 0) {
			setFormError('Fix the highlighted fields and try again.')
			focusFirstProblem()
			return
		}

		const payload: TaskPayload = {
			title: title.trim(),
			description: description.trim(),
			startDate,
			dueDate,
			priority,
			assignedTo: assignees.map((person) => person._id),
			tags: [...new Set(tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
		}
		if (estimatedDays.trim() !== '') payload.estimatedDays = Number(estimatedDays)
		// An edit sends the notes, the checklist and the repeat settings as they now are, so removing them works
		if (isEditing) {
			payload.notes = notes.trim()
			payload.checklist = checklist.map((item) => ({ ...(item._id ? { _id: item._id } : {}), text: item.text.trim() }))
			if (repeat) payload.recurrence = { frequency: repeat.frequency, interval: Number(repeat.interval), until: repeat.until || null }
			else if (task?.recurrence) payload.recurrence = null
		} else {
			if (notes.trim()) payload.notes = notes.trim()
			if (checklist.length > 0) payload.checklist = checklist.map((item) => ({ text: item.text.trim() }))
			if (repeat) payload.recurrence = { frequency: repeat.frequency, interval: Number(repeat.interval), until: repeat.until || null }
		}

		setSaving(true)
		try {
			// An edit leaves the status out, so it can't undo a change made meanwhile
			const response = isEditing ? await taskAPI.updateTask(task!._id!, payload) : await taskAPI.createTask(payload)
			notify(isEditing ? 'Task saved.' : 'Task created.', 'success')
			onCreate?.(response.data)
			onClose()
		} catch (failure) {
			const message = getErrorMessage(failure, 'The task could not be saved. Please try again.')
			const field = fieldOf(message)
			if (field) {
				setErrors({ [field]: message })
				focusFirstProblem()
			}
			setFormError(message)
			setSaving(false)
		}
	}

	const titleId = id('heading')
	const describe = (key: FieldKey) => (errors[key] ? id(`${key}-error`) : undefined)
	const fieldError = (key: FieldKey) =>
		errors[key] ? (
			<p id={id(`${key}-error`)} className="mt-1.5 text-sm text-red-600">
				{errors[key]}
			</p>
		) : null

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault()
				if (!saving) onClose()
			}}
			className="m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-2xl overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex open:flex-col"
		>
			<div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4 py-4 sm:px-6">
				<div>
					<h2 id={titleId} className="text-lg font-semibold text-neutral-900">{isEditing ? 'Edit Task' : 'Create New Task'}</h2>
					<p className="text-xs text-neutral-500">{isEditing ? 'Update the details below' : 'Fill in the details below'}. Fields marked * are required.</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					disabled={saving}
					aria-label="Close"
					className="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
				>
					<X aria-hidden="true" className="h-5 w-5" />
				</button>
			</div>

			<form ref={formRef} onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
					{formError && (
						<div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
							{formError}
						</div>
					)}

					<div>
						<label htmlFor={id('title')} className="mb-1.5 block text-sm font-medium text-neutral-700">
							Title <span aria-hidden="true" className="text-red-500">*</span>
						</label>
						<input
							id={id('title')}
							type="text"
							value={title}
							onChange={(e) => {
								setTitle(e.target.value)
								clearError('title')
							}}
							aria-required="true"
							aria-invalid={errors.title ? true : undefined}
							aria-describedby={describe('title')}
							placeholder="Enter task title"
							className={`${FIELD} ${fieldBorder(!!errors.title)}`}
						/>
						{fieldError('title')}
					</div>

					<div>
						<label htmlFor={id('description')} className="mb-1.5 block text-sm font-medium text-neutral-700">
							Description <span aria-hidden="true" className="text-red-500">*</span>
						</label>
						<textarea
							id={id('description')}
							value={description}
							onChange={(e) => {
								setDescription(e.target.value)
								clearError('description')
							}}
							rows={3}
							aria-required="true"
							aria-invalid={errors.description ? true : undefined}
							aria-describedby={describe('description')}
							placeholder="Describe the task in detail"
							className={`${FIELD} resize-none ${fieldBorder(!!errors.description)}`}
						/>
						{fieldError('description')}
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<div>
							<label htmlFor={id('startDate')} className="mb-1.5 block text-sm font-medium text-neutral-700">
								Start Date <span aria-hidden="true" className="text-red-500">*</span>
							</label>
							<input
								id={id('startDate')}
								type="date"
								value={startDate}
								onChange={(e) => {
									changeDates(e.target.value, dueDate)
									clearError('startDate')
								}}
								aria-required="true"
								aria-invalid={errors.startDate ? true : undefined}
								aria-describedby={describe('startDate')}
								className={`${FIELD} ${fieldBorder(!!errors.startDate)}`}
							/>
							{fieldError('startDate')}
						</div>
						<div>
							<label htmlFor={id('dueDate')} className="mb-1.5 block text-sm font-medium text-neutral-700">
								Due Date <span aria-hidden="true" className="text-red-500">*</span>
							</label>
							<input
								id={id('dueDate')}
								type="date"
								value={dueDate}
								min={startDate || undefined}
								onChange={(e) => {
									changeDates(startDate, e.target.value)
									clearError('dueDate')
								}}
								aria-required="true"
								aria-invalid={errors.dueDate ? true : undefined}
								aria-describedby={describe('dueDate')}
								className={`${FIELD} ${fieldBorder(!!errors.dueDate)}`}
							/>
							{fieldError('dueDate')}
						</div>
						<div>
							<label htmlFor={id('estimatedDays')} className="mb-1.5 block text-sm font-medium text-neutral-700">
								Estimated days
							</label>
							<input
								id={id('estimatedDays')}
								type="number"
								min={0}
								step="any"
								inputMode="decimal"
								value={estimatedDays}
								onChange={(e) => {
									setEstimatedDays(e.target.value)
									setEstimateEdited(true)
									clearError('estimatedDays')
								}}
								aria-invalid={errors.estimatedDays ? true : undefined}
								aria-describedby={describe('estimatedDays')}
								className={`${FIELD} ${fieldBorder(!!errors.estimatedDays)}`}
							/>
							{fieldError('estimatedDays')}
						</div>
					</div>

					<div>
						<span id={id('priority')} className="mb-1.5 block text-sm font-medium text-neutral-700">Priority</span>
						<div role="group" aria-labelledby={id('priority')} className="grid grid-cols-4 gap-2">
							{(['low', 'medium', 'high', 'urgent'] as const).map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setPriority(value)}
									aria-pressed={priority === value}
									className={`rounded-lg px-2 py-2 text-xs font-medium capitalize transition-all ${
										priority === value ? PRIORITY_ACTIVE[value] : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
									}`}
								>
									{value}
								</button>
							))}
						</div>
						{!isEditing && <p className="mt-1.5 text-xs text-neutral-500">New tasks start as Pending.</p>}
					</div>

					<div>
						<span id={id('assignees-label')} className="mb-1.5 block text-sm font-medium text-neutral-700">
							Assign To <span aria-hidden="true" className="text-red-500">*</span>
						</span>
						<AssigneePicker
							id={id('assignees')}
							labelId={id('assignees-label')}
							value={assignees}
							onChange={(next) => {
								setAssignees(next)
								clearError('assignedTo')
							}}
							load={loadPeople}
							placeholder="Select users to assign"
							max={MAX_ASSIGNEES}
							invalid={!!errors.assignedTo}
							describedBy={describe('assignedTo')}
						/>
						{fieldError('assignedTo')}
					</div>

					<div>
						<label htmlFor={id('tags')} className="mb-1.5 block text-sm font-medium text-neutral-700">Tags</label>
						<input
							id={id('tags')}
							type="text"
							value={tags}
							onChange={(e) => setTags(e.target.value)}
							className={`${FIELD} border-neutral-200`}
							placeholder="frontend, urgent, review (comma-separated)"
						/>
					</div>

					<div>
						<label htmlFor={id('notes')} className="mb-1.5 block text-sm font-medium text-neutral-700">Additional Notes</label>
						<textarea
							id={id('notes')}
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
							className={`${FIELD} resize-none border-neutral-200`}
							placeholder="Any additional instructions or notes..."
						/>
					</div>

					<fieldset className="min-w-0 rounded-xl border border-neutral-200 p-4">
						<legend className="px-1 text-sm font-medium text-neutral-700">
							Checklist <span className="text-xs font-normal text-neutral-500">(optional, up to {MAX_CHECKLIST_ITEMS} steps)</span>
						</legend>
						<ChecklistEditor items={checklist} onChange={(next) => { setChecklist(next); clearError('checklist') }} error={errors.checklist} errorId={id('checklist-error')} />
					</fieldset>

					<fieldset className="min-w-0 rounded-xl border border-neutral-200 p-4">
						<legend className="px-1 text-sm font-medium text-neutral-700">Repeat</legend>
						<RepeatEditor value={repeat} onChange={(next) => { setRepeat(next); clearError('recurrence') }} startDate={startDate} error={errors.recurrence} errorId={id('recurrence-error')} />
					</fieldset>
				</div>

				<div className="flex shrink-0 flex-col-reverse gap-3 border-t border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-xl border border-neutral-200 px-5 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving}
						className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90 disabled:opacity-50"
					>
						{saving ? (
							<>
								<span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
								{isEditing ? 'Saving…' : 'Creating…'}
							</>
						) : isEditing ? (
							'Save Changes'
						) : (
							'Create Task'
						)}
					</button>
				</div>
			</form>
		</dialog>
	)
}

// The form for a new task, or for editing `task`. Open it with isOpen; it
// starts fresh every time it opens.
function Tasksadd({ isOpen, onClose, onCreate, task }: Props) {
	const { isAdmin, user } = useAuth()
	const canCreateTasks = isAdmin || user?.role === 'team_leader'
	if (!isOpen || !canCreateTasks) return null
	return <TaskFormDialog key={task?._id ?? 'new'} task={task ?? null} isAdmin={isAdmin} onClose={onClose} onCreate={onCreate} />
}

export default Tasksadd
