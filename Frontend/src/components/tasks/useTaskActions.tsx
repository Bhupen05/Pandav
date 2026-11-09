import { useRef, useState, type ReactNode } from 'react'
import { taskAPI } from '../../api/taskAPI'
import { getErrorMessage } from '../../api/axios'
import { useFeedback } from '../../context/useFeedback'
import NoteDialog from './NoteDialog'
import type { Task } from './types'

type Options = {
  // Says how an action went: a toast on the list, a line inside the open panel
  report: (message: string, tone: 'success' | 'error') => void
  // After an action worked; `task` is the task as the server now has it
  onChanged: (task?: Task) => void
  onDeleted?: (id: string) => void
}

type Result = { data?: Task; message?: string }

// Start, request completion, approve, reject, cancel, reopen and delete, the
// same on the list and in the task panel. `dialogs` must be rendered by the
// caller (it holds the note dialog).
export function useTaskActions({ report, onChanged, onDeleted }: Options) {
  const { confirm, prompt } = useFeedback()
  // The task an action is running on: its buttons stay disabled meanwhile
  const [busyId, setBusyId] = useState<string | null>(null)
  const running = useRef(false)
  const [noteFor, setNoteFor] = useState<Task | null>(null)

  const run = async (task: Task, job: () => Promise<Result>, done: string, failed: string) => {
    if (running.current) return
    running.current = true
    setBusyId(task._id)
    try {
      const response = await job()
      report(response.message || done, 'success')
      onChanged(response.data)
    } catch (error) {
      report(getErrorMessage(error, failed), 'error')
    } finally {
      running.current = false
      setBusyId(null)
    }
  }

  const start = (task: Task) =>
    run(task, () => taskAPI.updateTask(task._id, { status: 'in-progress' }), 'You started your part.', "Couldn't start the task.")

  // Asks for an optional note first
  const requestCompletion = (task: Task) => setNoteFor(task)

  const sendRequest = async (note: string) => {
    if (!noteFor) return
    const task = noteFor
    const response = await taskAPI.requestCompletion(task._id, note || undefined)
    report(response.message || 'Your part is marked as done.', 'success')
    setNoteFor(null)
    onChanged(response.data)
  }

  const approve = (task: Task) =>
    run(task, () => taskAPI.approveCompletion(task._id), 'Task approved.', "Couldn't approve the task.")

  const reject = async (task: Task) => {
    const reason = await prompt({
      title: 'Reject this task?',
      message: 'It goes back to in progress. Say what still needs doing; the people on the task will see it.',
      label: 'Reason',
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return
    await run(task, () => taskAPI.rejectCompletion(task._id, { rejectionReason: reason.trim() || undefined }), 'Task sent back.', "Couldn't reject the task.")
  }

  const cancel = async (task: Task) => {
    const reason = await prompt({
      title: 'Cancel this task?',
      message: 'Nobody can work on it until it is reopened. The people on it are told why.',
      label: 'Reason',
      confirmLabel: 'Cancel task',
      danger: true,
    })
    if (reason === null) return
    await run(task, () => taskAPI.cancelTask(task._id, reason.trim()), 'Task cancelled.', "Couldn't cancel the task.")
  }

  const reopen = async (task: Task) => {
    const ok = await confirm({
      title: 'Reopen this task?',
      message: task.status === 'completed' ? 'It goes back to in progress and needs approval again.' : 'It goes back to pending.',
      confirmLabel: 'Reopen',
    })
    if (!ok) return
    await run(task, () => taskAPI.reopenTask(task._id), 'Task reopened.', "Couldn't reopen the task.")
  }

  const remove = async (task: Task) => {
    const ok = await confirm({
      title: 'Delete this task?',
      message: `"${task.title}" will be removed for everyone, with its comments and files. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok || running.current) return
    running.current = true
    setBusyId(task._id)
    try {
      await taskAPI.deleteTask(task._id)
      report('Task deleted.', 'success')
      onDeleted?.(task._id)
    } catch (error) {
      report(getErrorMessage(error, "Couldn't delete the task."), 'error')
    } finally {
      running.current = false
      setBusyId(null)
    }
  }

  const dialogs: ReactNode = noteFor && (
    <NoteDialog
      title="Request completion"
      message={`Tell the reviewer your part of "${noteFor.title}" is done.`}
      label="Note for the reviewer (optional)"
      confirmLabel="Send request"
      maxLength={1000}
      onSubmit={sendRequest}
      onClose={() => setNoteFor(null)}
    />
  )

  return { busyId, start, requestCompletion, approve, reject, cancel, reopen, remove, dialogs }
}
