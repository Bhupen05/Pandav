import { useState } from 'react'
import { taskAPI } from '../../api/taskAPI'
import { getErrorMessage } from '../../api/axios'
import { formatDateTime, personName } from './taskFormat'
import type { Task } from './types'

type Props = {
  task: Task
  // Whether this person may tick items (the people on the task and its managers)
  canTick: boolean
  onTask: (task: Task) => void
  report: (message: string, tone: 'success' | 'error') => void
}

// The checklist of a task, with a checkbox for each step
export default function TaskChecklist({ task, canTick, onTask, report }: Props) {
  const items = task.checklist || []
  const [busyId, setBusyId] = useState<string | null>(null)
  const done = items.filter((item) => item.done).length

  const toggle = async (itemId: string, checked: boolean) => {
    if (busyId) return
    setBusyId(itemId)
    // Show the tick at once; the server's answer replaces it, or it is put back
    const before = task
    onTask({ ...task, checklist: items.map((item) => (item._id === itemId ? { ...item, done: checked } : item)) })
    try {
      const response = await taskAPI.toggleChecklistItem(task._id, itemId, checked)
      onTask(response.data)
    } catch (error) {
      onTask(before)
      report(getErrorMessage(error, "Couldn't update the checklist."), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="task-checklist-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 id="task-checklist-heading" className="text-sm font-semibold text-neutral-900">Checklist</h3>
        <span className="text-xs text-neutral-500">{done} of {items.length} done</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item._id}>
            <label className={`flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm ${canTick ? 'cursor-pointer hover:bg-neutral-50' : ''}`}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canTick || busyId !== null}
                onChange={(event) => toggle(item._id, event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300"
              />
              <span className="min-w-0 flex-1">
                <span className={`wrap-break-word ${item.done ? 'text-neutral-500 line-through' : 'text-neutral-900'}`}>{item.text}</span>
                {item.done && (item.doneBy || item.doneAt) && (
                  <span className="block text-xs text-neutral-500">
                    Ticked{item.doneBy ? ` by ${personName(item.doneBy)}` : ''}
                    {item.doneAt ? ` · ${formatDateTime(item.doneAt)}` : ''}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!canTick && task.status !== 'pending' && task.status !== 'in-progress' && task.status !== 'completion-requested' && (
        <p className="mt-2 text-xs text-neutral-500">Reopen the task to change the checklist.</p>
      )}
    </section>
  )
}
