import { useState, useEffect } from 'react'
import { taskAPI } from '../api/taskAPI'
import { userAPI } from '../api/userAPI'
import { useAuth } from '../context/AuthContext'

export type TaskInput = {
	_id?: string
	title: string
	description?: string
	dueDate?: string
	priority: 'low' | 'medium' | 'high' | 'urgent'
	status: 'pending' | 'in-progress' | 'completed'
	assignedTo: string
	tags?: string[]
}

type Props = {
	onCreate?: (task: TaskInput) => void
}

function Tasksadd({ onCreate }: Props) {
	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')
	const [dueDate, setDueDate] = useState('')
	const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
	const [status, setStatus] = useState<'pending' | 'in-progress' | 'completed'>('pending')
	const [assignedTo, setAssignedTo] = useState('')
	const [tags, setTags] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [users, setUsers] = useState<any[]>([])
	
	const { isAdmin } = useAuth()

	useEffect(() => {
		if (isAdmin) {
			loadUsers()
		}
	}, [isAdmin])

	const loadUsers = async () => {
		try {
			const response = await userAPI.getUsers({ isActive: true })
			setUsers(response.data || [])
		} catch (err) {
			console.error('Failed to load users:', err)
		}
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setSuccess(null)

		if (!title.trim()) {
			setError('Title is required.')
			return
		}

		if (!assignedTo) {
			setError('Please select a user to assign the task.')
			return
		}

		const input: TaskInput = {
			title: title.trim(),
			description: description.trim() || '',
			dueDate: dueDate || undefined,
			priority,
			status,
			assignedTo,
			tags: tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
		}

		setLoading(true)
		try {
			if (onCreate) {
				onCreate(input)
			} else {
				const response = await taskAPI.createTask(input)
				// Handle both success responses and 204 No Content
				if (response && !response.success && response.message) {
					throw new Error(response.message)
				}
			}

			setSuccess('Task added successfully!')
			setTitle('')
			setDescription('')
			setDueDate('')
			setPriority('medium')
			setStatus('pending')
			setAssignedTo('')
			setTags('')
		} catch (err: any) {
			// Handle 204 No Content as success
			if (err.response?.status === 204) {
				setSuccess('Task added successfully!')
				setTitle('')
				setDescription('')
				setDueDate('')
				setPriority('medium')
				setStatus('pending')
				setAssignedTo('')
				setTags('')
			} else {
				setError(err.response?.data?.message || err.message || 'Failed to create task. Please try again.')
			}
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8">
			<h1 className="mb-2 text-2xl font-semibold text-neutral-900">Add Task</h1>
			<p className="mb-6 text-sm text-neutral-600">Create a new task.</p>

			{error && (
				<div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{error}
				</div>
			)}

			{success && (
				<div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
					{success}
				</div>
			)}

			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="title" className="mb-1 block text-sm font-medium text-neutral-800">
						Title
					</label>
					<input
						id="title"
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						required
						className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
						placeholder="Task title"
					/>
				</div>

				<div>
					<label htmlFor="description" className="mb-1 block text-sm font-medium text-neutral-800">
						Description
					</label>
					<textarea
						id="description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={4}
						className="block w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
						placeholder="Optional details"
					/>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div>
						<label htmlFor="dueDate" className="mb-1 block text-sm font-medium text-neutral-800">
							Due Date
						</label>
						<input
							id="dueDate"
							type="date"
							value={dueDate}
							onChange={(e) => setDueDate(e.target.value)}
							className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
						/>
					</div>

					<div>
						<label htmlFor="priority" className="mb-1 block text-sm font-medium text-neutral-800">
							Priority
						</label>
						<select
							id="priority"
							value={priority}
							onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high' | 'urgent')}
							className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
						>
							<option value="low">Low</option>
							<option value="medium">Medium</option>
							<option value="high">High</option>
							<option value="urgent">Urgent</option>
						</select>
					</div>

					<div>
						<label htmlFor="status" className="mb-1 block text-sm font-medium text-neutral-800">
							Status
						</label>
						<select
							id="status"
							value={status}
							onChange={(e) => setStatus(e.target.value as 'pending' | 'in-progress' | 'completed')}
							className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
						>
							<option value="pending">Pending</option>
							<option value="in-progress">In Progress</option>
							<option value="completed">Completed</option>
						</select>
					</div>
				</div>

				<div>
					<label htmlFor="assignedTo" className="mb-1 block text-sm font-medium text-neutral-800">
						Assign To
					</label>
					<select
						id="assignedTo"
						value={assignedTo}
						onChange={(e) => setAssignedTo(e.target.value)}
						required
						className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
					>
						<option value="">Select User</option>
						{users.map((user) => (
							<option key={user._id} value={user._id}>
								{user.name} ({user.email})
							</option>
						))}
					</select>
				</div>

				<div>
					<label htmlFor="tags" className="mb-1 block text-sm font-medium text-neutral-800">
						Tags (comma-separated)
					</label>
					<input
						id="tags"
						type="text"
						value={tags}
						onChange={(e) => setTags(e.target.value)}
						className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
						placeholder="work, urgent, personal"
					/>
				</div>

				<div className="flex items-center justify-end gap-3">
					<button
						type="reset"
						onClick={() => {
							setTitle('')
							setDescription('')
							setDueDate('')
							setPriority('medium')
							setStatus('pending')
							setAssignedTo('')
							setTags('')
							setError(null)
							setSuccess(null)
						}}
						className="rounded-md border px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
					>
						Clear
					</button>
					<button
						type="submit"
						disabled={loading}
						className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
					>
						{loading ? 'Adding...' : 'Add Task'}
					</button>
				</div>
			</form>
		</div>
	)
}

export default Tasksadd

