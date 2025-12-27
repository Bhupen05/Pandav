import type { TaskInput } from './Tasksadd'

type Props = {
	tasks: TaskInput[]
	onEdit?: (index: number) => void
	onDelete?: (index: number) => void
	onStatusChange?: (index: number, next: TaskInput['status']) => void
	isAdmin?: boolean
}

function formatDate(date?: string) {
	if (!date) return null
	const d = new Date(date)
	return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString()
}

function statusClasses(status: TaskInput['status']) {
	switch (status) {
		case 'pending':
			return 'bg-amber-100 text-amber-800'
		case 'in-progress':
			return 'bg-blue-100 text-blue-800'
		case 'completed':
			return 'bg-emerald-100 text-emerald-800'
		case 'completion-requested':
			return 'bg-purple-100 text-purple-800'
		case 'cancelled':
			return 'bg-neutral-200 text-neutral-700'
	}
}

function priorityClasses(priority: TaskInput['priority']) {
	switch (priority) {
		case 'low':
			return 'bg-neutral-100 text-neutral-700'
		case 'medium':
			return 'bg-blue-100 text-blue-800'
		case 'high':
			return 'bg-orange-100 text-orange-800'
		case 'urgent':
			return 'bg-red-100 text-red-800'
	}
}

function priorityIcon(priority: TaskInput['priority']) {
	switch (priority) {
		case 'urgent':
			return '🔥'
		case 'high':
			return '⚡'
		case 'medium':
			return '▶️'
		case 'low':
			return '📌'
	}
}

function statusIcon(status: TaskInput['status']) {
	switch (status) {
		case 'pending':
			return '⏳'
		case 'in-progress':
			return '🔄'
		case 'completed':
			return '✅'
		case 'completion-requested':
			return '🔔'
		case 'cancelled':
			return '❌'
	}
}

export default function Taskscard({ tasks, onEdit, onDelete, onStatusChange, isAdmin = false }: Props) {
	if (!tasks || tasks.length === 0) {
		return (
			<div className="mx-auto max-w-4xl rounded-xl border bg-white p-12 text-center shadow-sm">
				<div className="mb-4 flex justify-center">
					<div className="rounded-full bg-neutral-100 p-4">
						<svg className="h-12 w-12 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
						</svg>
					</div>
				</div>
				<h3 className="mb-2 text-lg font-semibold text-neutral-900">No tasks yet</h3>
				<p className="text-sm text-neutral-600">Create your first task to get started with your workflow!</p>
			</div>
		)
	}

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{tasks.map((task, idx) => {
				const due = formatDate(task.dueDate)
				const isOverdue = due && new Date(task.dueDate!) < new Date() && task.status !== 'completed'
				return (
					<article key={idx} className="group rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md">
						{/* Header */}
						<div className="mb-3 flex items-start gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-blue-600 text-white shadow-sm">
								<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
								</svg>
							</div>
							<div className="flex-1 min-w-0">
								<h2 className="text-base font-semibold text-neutral-900 mb-1">{task.title}</h2>
								<div className="flex flex-wrap items-center gap-2">
									<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${priorityClasses(task.priority)}`}>
										<span>{priorityIcon(task.priority)}</span>
										{task.priority}
									</span>
									<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(task.status)}`}>
										<span>{statusIcon(task.status)}</span>
										{task.status.replace('-', ' ')}
									</span>
								</div>
							</div>
						</div>

						{/* Description */}
						{task.description && (
							<p className="mb-4 line-clamp-2 text-sm text-neutral-600 leading-relaxed">{task.description}</p>
						)}

					{/* Metadata */}
					<div className="mb-4 space-y-2">
						{task.startDate && task.dueDate && (
							<div className="flex items-center gap-2 text-xs text-neutral-600">
								<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
								</svg>
								<span className="font-medium">
									{formatDate(task.startDate)} → {formatDate(task.dueDate)}
									{task.estimatedDays && ` (${task.estimatedDays}d)`}
								</span>
							</div>
						)}
						{due && (
							<div className={`flex items-center gap-2 text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-neutral-500'}`}>
								{isOverdue && <span>⚠️ Overdue</span>}
							</div>
						)}
							{task.tags && task.tags.length > 0 && (
								<div className="flex flex-wrap items-center gap-1.5">
									{task.tags.map((t, i) => (
										<span key={i} className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
											#{t}
										</span>
									))}
								</div>
							)}
						</div>

						{/* Actions */}
						<div className="flex items-center gap-2 border-t pt-3">
						{onStatusChange && (
							<>
								{/* User actions */}
								{!isAdmin && task.status === 'pending' && (
									<button
										className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
										onClick={() => onStatusChange(idx, 'in-progress')}
									>
										▶️ Start Task
									</button>
								)}
								{!isAdmin && task.status === 'in-progress' && (
									<button
										className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors"
										onClick={() => onStatusChange(idx, 'completion-requested')}
									>
										🔔 Request Completion
									</button>
								)}
								{!isAdmin && task.status === 'completion-requested' && (
									<span className="flex-1 text-center text-xs text-purple-600 font-medium py-2">
										⏳ Awaiting Admin Approval
									</span>
								)}
								{!isAdmin && task.status === 'completed' && (
									<span className="flex-1 text-center text-xs text-emerald-600 font-medium py-2">
										✅ Completed
									</span>
								)}
								{!isAdmin && task.status === 'cancelled' && (
									<span className="flex-1 text-center text-xs text-neutral-500 font-medium py-2">
										❌ Cancelled
									</span>
								)}
								
								{/* Admin actions */}
								{isAdmin && task.status === 'completion-requested' && (
									<>
										<button
											className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
											onClick={() => onStatusChange(idx, 'completed')}
										>
											✓ Approve
										</button>
										<button
											className="rounded-lg px-3 py-2 text-xs font-semibold border border-red-500 text-red-600 hover:bg-red-50 transition-colors"
											onClick={() => onStatusChange(idx, 'in-progress')}
										>
											✗ Reject
										</button>
									</>
								)}
								{isAdmin && task.status !== 'completion-requested' && (
									<span className={`flex-1 text-center text-xs font-medium py-2 ${
										task.status === 'completed' ? 'text-emerald-600' :
										task.status === 'in-progress' ? 'text-blue-600' :
										task.status === 'cancelled' ? 'text-neutral-500' :
										'text-amber-600'
									}`}>
										{task.status === 'completed' ? '✅ Completed' :
										 task.status === 'in-progress' ? '🔄 In Progress' :
										 task.status === 'cancelled' ? '❌ Cancelled' :
										 '⏳ Pending'}
									</span>
								)}
							</>
						)}
							{onEdit && (
								<button
									className="rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50 transition-colors"
									onClick={() => onEdit(idx)}
									title="Edit task"
								>
									<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
									</svg>
								</button>
							)}
							{onDelete && (
								<button
									className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 transition-colors"
									onClick={() => onDelete(idx)}
									title="Delete task"
								>
									<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							)}
						</div>
					</article>
				)
			})}
		</div>
	)
}

