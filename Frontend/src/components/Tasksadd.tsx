import { useState, useEffect } from 'react'
import { taskAPI } from '../api/taskAPI'
import { userAPI } from '../api/userAPI'
import { useAuth } from '../context/AuthContext'

export type TaskInput = {
	_id?: string
	title: string
	description: string
	startDate: string
	dueDate: string
	estimatedDays?: number
	priority: 'low' | 'medium' | 'high' | 'urgent'
	status: 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'completion-requested'
	assignedTo: string[]
	tags?: string[]
	notes?: string
	createdBy?: any
	assigneeProgress?: any[]
}

type Props = {
	isOpen: boolean
	onClose: () => void
	onCreate?: (task: TaskInput) => void
}

function Tasksadd({ isOpen, onClose, onCreate }: Props) {
	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')
	const [startDate, setStartDate] = useState('')
	const [dueDate, setDueDate] = useState('')
	const [estimatedDays, setEstimatedDays] = useState<number>(1)
	const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
	const [status, setStatus] = useState<'pending' | 'in-progress' | 'completed' | 'cancelled' | 'completion-requested'>('pending')
	const [assignedTo, setAssignedTo] = useState<string[]>([])
	const [tags, setTags] = useState('')
	const [notes, setNotes] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [users, setUsers] = useState<any[]>([])
	const [showUserDropdown, setShowUserDropdown] = useState(false)
	
	const { isAdmin } = useAuth()

	useEffect(() => {
		if (isAdmin && isOpen) {
			loadUsers()
		}
	}, [isAdmin, isOpen])

	// Reset form when modal closes
	useEffect(() => {
		if (!isOpen) {
			setError(null)
			setSuccess(null)
		}
	}, [isOpen])

	// Auto-calculate estimated days when dates change
	useEffect(() => {
		if (startDate && dueDate) {
			const start = new Date(startDate)
			const due = new Date(dueDate)
			const diffTime = due.getTime() - start.getTime()
			const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
			setEstimatedDays(diffDays > 0 ? diffDays : 1)
		}
	}, [startDate, dueDate])

	const loadUsers = async () => {
		try {
			const response = await userAPI.getUsers({ isActive: true })
			setUsers(response.data || [])
		} catch (err) {
			console.error('Failed to load users:', err)
		}
	}

	const resetForm = () => {
		setTitle('')
		setDescription('')
		setStartDate('')
		setDueDate('')
		setEstimatedDays(1)
		setPriority('medium')
		setStatus('pending')
		setAssignedTo([])
		setTags('')
		setNotes('')
		setError(null)
		setSuccess(null)
	}

	const handleClose = () => {
		resetForm()
		onClose()
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setSuccess(null)

		if (!title.trim()) {
			setError('Title is required.')
			return
		}

		if (!description.trim()) {
			setError('Description is required.')
			return
		}

		if (!startDate) {
			setError('Start date is required.')
			return
		}

		if (!dueDate) {
			setError('Due date is required.')
			return
		}

		if (assignedTo.length === 0) {
			setError('Please select at least one user to assign the task.')
			return
		}

		const input: TaskInput = {
			title: title.trim(),
			description: description.trim(),
			startDate,
			dueDate,
			estimatedDays,
			priority,
			status,
			assignedTo,
			tags: tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
			notes: notes.trim() || undefined,
		}

		setLoading(true)
		try {
			const response = await taskAPI.createTask(input)
			if (response && !response.success && response.message) {
				throw new Error(response.message)
			}
			
			if (onCreate) {
				onCreate(input)
			}

			setSuccess('Task created successfully!')
			setTimeout(() => {
				resetForm()
				onClose()
			}, 1000)
		} catch (err: any) {
			if (err.response?.status === 204) {
				setSuccess('Task created successfully!')
				setTimeout(() => {
					resetForm()
					onClose()
				}, 1000)
			} else if (err.response?.status === 403) {
				setError('You do not have permission to create tasks. Only admins can create tasks.')
			} else if (err.response?.status === 401) {
				setError('You must be logged in to create tasks.')
			} else {
				setError(err.response?.data?.message || err.message || 'Failed to create task. Please try again.')
			}
		} finally {
			setLoading(false)
		}
	}

	const toggleUserSelection = (userId: string) => {
		setAssignedTo(prev => 
			prev.includes(userId) 
				? prev.filter(id => id !== userId)
				: [...prev, userId]
		)
	}

	if (!isOpen) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			{/* Backdrop */}
			<div 
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={handleClose}
			/>
			
			{/* Modal */}
			<div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
				{/* Header */}
				<div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white">
							<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
							</svg>
						</div>
						<div>
							<h2 className="text-lg font-semibold text-neutral-900">Create New Task</h2>
							<p className="text-xs text-neutral-500">Fill in the details below</p>
						</div>
					</div>
					<button
						onClick={handleClose}
						className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors"
					>
						<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* Body */}
				<div className="p-6">
					{error && (
						<div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
							<svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							{error}
						</div>
					)}

					{success && (
						<div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
							<svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
							</svg>
							{success}
						</div>
					)}

					<form onSubmit={handleSubmit} className="space-y-5">
						{/* Title */}
						<div>
							<label htmlFor="title" className="mb-1.5 block text-sm font-medium text-neutral-700">
								Title <span className="text-red-500">*</span>
							</label>
							<input
								id="title"
								type="text"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								required
								className="block w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								placeholder="Enter task title"
							/>
						</div>

						{/* Description */}
						<div>
							<label htmlFor="description" className="mb-1.5 block text-sm font-medium text-neutral-700">
								Description <span className="text-red-500">*</span>
							</label>
							<textarea
								id="description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								required
								rows={3}
								className="block w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								placeholder="Describe the task in detail"
							/>
						</div>

						{/* Dates Row */}
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<div>
								<label htmlFor="startDate" className="mb-1.5 block text-sm font-medium text-neutral-700">
									Start Date <span className="text-red-500">*</span>
								</label>
								<input
									id="startDate"
									type="date"
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
									required
									className="block w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								/>
							</div>
							<div>
								<label htmlFor="dueDate" className="mb-1.5 block text-sm font-medium text-neutral-700">
									Due Date <span className="text-red-500">*</span>
								</label>
								<input
									id="dueDate"
									type="date"
									value={dueDate}
									onChange={(e) => setDueDate(e.target.value)}
									required
									className="block w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								/>
							</div>
							<div>
								<label htmlFor="estimatedDays" className="mb-1.5 block text-sm font-medium text-neutral-700">
									Est. Days <span className="text-xs text-neutral-400">(auto)</span>
								</label>
								<div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-100 px-4 py-2.5">
									<svg className="h-4 w-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
									</svg>
									<span className="text-sm font-medium text-neutral-700">
										{startDate && dueDate ? (
											<>{estimatedDays} day{estimatedDays !== 1 ? 's' : ''}</>
										) : (
											<span className="text-neutral-400">Select dates</span>
										)}
									</span>
								</div>
							</div>
						</div>

						{/* Priority & Status Row */}
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label htmlFor="priority" className="mb-1.5 block text-sm font-medium text-neutral-700">
									Priority
								</label>
								<div className="flex gap-2">
									{(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
										<button
											key={p}
											type="button"
											onClick={() => setPriority(p)}
											className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium capitalize transition-all ${
												priority === p
													? p === 'low' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500' :
													  p === 'medium' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500' :
													  p === 'high' ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-500' :
													  'bg-red-100 text-red-700 ring-2 ring-red-500'
													: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
											}`}
										>
											{p}
										</button>
									))}
								</div>
							</div>

							<div>
								<label htmlFor="status" className="mb-1.5 block text-sm font-medium text-neutral-700">
									Initial Status
								</label>
								<div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-100 px-4 py-2.5">
									<span className="text-lg">⏳</span>
									<span className="text-sm font-medium text-neutral-700">Pending</span>
									<span className="ml-auto text-xs text-neutral-400">(default)</span>
								</div>
							</div>
						</div>

						{/* Assign To */}
						<div>
							<label className="mb-1.5 block text-sm font-medium text-neutral-700">
								Assign To <span className="text-red-500">*</span>
							</label>
							<div className="relative">
								<button
									type="button"
									onClick={() => setShowUserDropdown(!showUserDropdown)}
									className="flex w-full items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								>
									<span className={assignedTo.length > 0 ? 'text-neutral-900' : 'text-neutral-400'}>
										{assignedTo.length > 0 
											? `${assignedTo.length} user${assignedTo.length > 1 ? 's' : ''} selected`
											: 'Select users to assign'
										}
									</span>
									<svg className={`h-5 w-5 text-neutral-400 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								
								{showUserDropdown && (
									<div className="absolute z-20 mt-2 w-full rounded-xl border border-neutral-200 bg-white shadow-lg max-h-48 overflow-y-auto">
										{users.length === 0 ? (
											<div className="px-4 py-3 text-sm text-neutral-500">No users available</div>
										) : (
											users.map((user) => (
												<label
													key={user._id}
													className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 transition-colors"
												>
													<input
														type="checkbox"
														checked={assignedTo.includes(user._id)}
														onChange={() => toggleUserSelection(user._id)}
														className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
													/>
													<div className="flex-1 min-w-0">
														<p className="text-sm font-medium text-neutral-900 truncate">{user.name}</p>
														<p className="text-xs text-neutral-500 truncate">{user.email}</p>
													</div>
												</label>
											))
										)}
									</div>
								)}
							</div>
							
							{/* Selected users chips */}
							{assignedTo.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-2">
									{assignedTo.map((userId) => {
										const user = users.find(u => u._id === userId)
										return user ? (
											<span
												key={userId}
												className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700"
											>
												{user.name}
												<button
													type="button"
													onClick={() => toggleUserSelection(userId)}
													className="ml-1 rounded-full p-0.5 hover:bg-neutral-200"
												>
													<svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
													</svg>
												</button>
											</span>
										) : null
									})}
								</div>
							)}
						</div>

						{/* Tags */}
						<div>
							<label htmlFor="tags" className="mb-1.5 block text-sm font-medium text-neutral-700">
								Tags
							</label>
							<input
								id="tags"
								type="text"
								value={tags}
								onChange={(e) => setTags(e.target.value)}
								className="block w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								placeholder="frontend, urgent, review (comma-separated)"
							/>
						</div>

						{/* Notes */}
						<div>
							<label htmlFor="notes" className="mb-1.5 block text-sm font-medium text-neutral-700">
								Additional Notes
							</label>
							<textarea
								id="notes"
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								rows={2}
								className="block w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all focus:border-neutral-900 focus:bg-white focus:ring-2 focus:ring-neutral-900/10"
								placeholder="Any additional instructions or notes..."
							/>
						</div>

						{/* Footer Actions */}
						<div className="flex items-center justify-end gap-3 border-t pt-5">
							<button
								type="button"
								onClick={handleClose}
								className="rounded-xl border border-neutral-200 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={loading}
								className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:opacity-90 disabled:opacity-50 transition-all"
							>
								{loading ? (
									<>
										<svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
											<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
										</svg>
										Creating...
									</>
								) : (
									<>
										<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
										</svg>
										Create Task
									</>
								)}
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	)
}

export default Tasksadd

