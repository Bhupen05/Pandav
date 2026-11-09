import { useState } from 'react'
import { CheckCheck, Pencil, Play, RotateCcw, Share2, Trash2 } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import ShareTaskDialog, { type ShareOffer } from '../ShareTaskDialog'
import {
  autoPostLabel,
  dueDay,
  errorText,
  formatDay,
  listOf,
  plural,
  priorityLabel,
  priorityTone,
  taskStatusLabel,
  taskStatusTone,
  todayKey,
  tone,
} from './format'
import { useBusy, useResource, useShowMore } from './hooks'
import Modal from './Modal'
import TodoForm from './TodoForm'
import { blankTodo, shareDraftOf, todoValuesOf, type TodoValues } from './todoValues'
import { Badge, BusyButton, EmptyState, ErrorState, LoadingState, SectionCard, ShowMore } from './ui'
import { dangerButton, secondaryButton, smallButton, successButton } from './styles'
import type { AutoShare, PersonalTask, PersonalTaskStatus } from './types'

type Filter = 'all' | PersonalTaskStatus

const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['todo', taskStatusLabel.todo],
  ['in_progress', taskStatusLabel.in_progress],
  ['completed', taskStatusLabel.completed],
]

// Your private to-do list. Finishing a to-do can offer to share it as a post;
// nothing is posted until you have read the text.
export default function TodoView() {
  const { user } = useAuth()
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()
  const tasks = useResource<PersonalTask[]>(
    async () => listOf<PersonalTask>((await socialV2API.getPersonalTasks())?.data),
    'Couldn’t load your to-dos.',
    [],
  )
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<PersonalTask | null>(null)
  // A finished to-do's share draft, waiting for its owner to confirm it
  const [shareOffer, setShareOffer] = useState<ShareOffer | null>(null)
  const { limit, initial, more, less } = useShowMore(10)
  const { setData } = tasks

  const counts = (status: Filter) => (status === 'all' ? tasks.data.length : tasks.data.filter((task) => task.status === status).length)
  const visible = tasks.data.filter((task) => filter === 'all' || task.status === filter)

  // What the server sent back for a to-do: show it, and offer to share it when it was just finished
  const applyResponse = (taskId: string, response: { data?: PersonalTask; autoShare?: AutoShare }) => {
    const fresh = response?.data
    if (fresh) setData((list) => list.map((task) => (task._id === taskId ? { ...task, ...fresh } : task)))
    const share = response?.autoShare
    if (share && 'suggested' in share) setShareOffer({ taskId, draft: share.draft })
  }

  const changeStatus = (task: PersonalTask, status: PersonalTaskStatus, done: string) =>
    run(`${status}-${task._id}`, async () => {
      try {
        applyResponse(task._id, await socialV2API.updatePersonalTask(task._id, { status }))
        notify(done, 'success')
      } catch (error) {
        notify(errorText(error, 'Couldn’t update the to-do.'), 'error')
      }
    })

  const remove = async (task: PersonalTask) => {
    const sure = await confirm({
      title: 'Delete this to-do?',
      message: `“${task.title}” is deleted for good. A post you already made from it stays.`,
      confirmLabel: 'Delete to-do',
      danger: true,
    })
    if (!sure) return
    await run(`delete-${task._id}`, async () => {
      try {
        await socialV2API.deletePersonalTask(task._id)
        setData((list) => list.filter((item) => item._id !== task._id))
        notify('To-do deleted.', 'success')
      } catch (error) {
        notify(errorText(error, 'Couldn’t delete the to-do.'), 'error')
      }
    })
  }

  async function create(values: TodoValues) {
    const response = await socialV2API.createPersonalTask({
      title: values.title,
      description: values.description,
      priority: values.priority,
      dueDate: values.dueDate || null,
      autoGenerateLinkedInPost: values.autoShare,
    })
    if (response?.data) setData((list) => [response.data as PersonalTask, ...list])
    notify('To-do added.', 'success')
  }

  async function save(task: PersonalTask, values: TodoValues) {
    // Only what changed is sent
    const before = todoValuesOf(task)
    const changes: Parameters<typeof socialV2API.updatePersonalTask>[1] = {}
    if (values.title !== before.title) changes.title = values.title
    if (values.description !== before.description) changes.description = values.description
    if (values.priority !== before.priority) changes.priority = values.priority
    if (values.dueDate !== before.dueDate) changes.dueDate = values.dueDate || null
    if (values.autoShare !== before.autoShare) changes.autoGenerateLinkedInPost = values.autoShare
    if (values.status !== before.status) changes.status = values.status
    if (Object.keys(changes).length > 0) {
      applyResponse(task._id, await socialV2API.updatePersonalTask(task._id, changes))
      notify('To-do saved.', 'success')
    }
    setEditing(null)
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <SectionCard id="add-todo" title="Add a to-do" description="A private list for yourself. Nobody else sees it.">
        <TodoForm initial={blankTodo} submitLabel="Add to-do" busyLabel="Adding…" onSubmit={create} />
      </SectionCard>

      <SectionCard
        id="todos"
        title="My to-dos"
        description="Move them along, and share the ones you finish."
        action={tasks.loaded ? <Badge className={tone.neutral}>{plural(tasks.data.length, 'to-do')}</Badge> : undefined}
      >
        <div role="group" aria-label="Filter to-dos" className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                filter === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label} ({counts(value)})
            </button>
          ))}
        </div>

        {tasks.error ? <div className="mb-4"><ErrorState message={tasks.error} onRetry={() => void tasks.reload()} retrying={tasks.loading} /></div> : null}
        {!tasks.loaded && tasks.loading ? <LoadingState label="Loading your to-dos…" /> : null}
        {tasks.loaded && visible.length === 0 ? (
          <EmptyState>{tasks.data.length === 0 ? 'No to-dos yet. Add your first one above.' : 'No to-dos with this status.'}</EmptyState>
        ) : null}

        <ul className="space-y-3">
          {visible.slice(0, limit).map((task) => {
            const day = dueDay(task.dueDate)
            const overdue = Boolean(day) && task.status !== 'completed' && day < todayKey()
            const shareable = task.status === 'completed' && !task.lastAutoGeneratedPost && (!task.autoPostStatus || task.autoPostStatus === 'none')
            const posted = task.autoPostStatus && task.autoPostStatus !== 'none' ? autoPostLabel[task.autoPostStatus] : ''
            return (
              <li key={task._id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 break-words font-bold text-slate-900">{task.title}</h3>
                  <Badge className={taskStatusTone[task.status]}>{taskStatusLabel[task.status]}</Badge>
                  <Badge className={priorityTone[task.priority]}>{priorityLabel[task.priority]}</Badge>
                  {overdue ? <Badge className={tone.danger}>Overdue</Badge> : null}
                </div>
                {task.description ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{task.description}</p> : null}
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  {day ? <span>Due {formatDay(day)}</span> : <span>No due date</span>}
                  {task.autoGenerateLinkedInPost ? <span>Offers to share when finished</span> : null}
                  {posted ? <span>{posted}</span> : null}
                </p>
                {task.autoPostStatus === 'failed' && task.autoPostMessage ? (
                  <p className="mt-1 text-xs text-rose-700">{task.autoPostMessage}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {task.status === 'todo' ? (
                    <BusyButton
                      busy={busy[`in_progress-${task._id}`]}
                      busyLabel="Starting…"
                      onClick={() => void changeStatus(task, 'in_progress', 'Marked as in progress.')}
                      icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
                      className={`${secondaryButton} ${smallButton}`}
                    >
                      Start
                    </BusyButton>
                  ) : null}
                  {task.status !== 'completed' ? (
                    <BusyButton
                      busy={busy[`completed-${task._id}`]}
                      busyLabel="Finishing…"
                      onClick={() => void changeStatus(task, 'completed', 'Marked as done.')}
                      icon={<CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                      className={`${successButton} ${smallButton}`}
                    >
                      Complete
                    </BusyButton>
                  ) : (
                    <BusyButton
                      busy={busy[`todo-${task._id}`]}
                      busyLabel="Reopening…"
                      onClick={() => void changeStatus(task, 'todo', 'Moved back to your to-dos.')}
                      icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                      className={`${secondaryButton} ${smallButton}`}
                    >
                      Reopen
                    </BusyButton>
                  )}
                  {shareable ? (
                    <button
                      type="button"
                      onClick={() => setShareOffer({ taskId: task._id, draft: shareDraftOf(task, user?.name ?? '') })}
                      className={`${secondaryButton} ${smallButton}`}
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Share as a post
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setEditing(task)} className={`${secondaryButton} ${smallButton}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </button>
                  <BusyButton
                    busy={busy[`delete-${task._id}`]}
                    busyLabel="Deleting…"
                    onClick={() => void remove(task)}
                    icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    className={`${dangerButton} ${smallButton}`}
                  >
                    Delete
                  </BusyButton>
                </div>
              </li>
            )
          })}
        </ul>
        <ShowMore limit={limit} initial={initial} total={visible.length} onMore={more} onLess={less} noun="more to-dos" />
      </SectionCard>

      {editing ? (
        <Modal title="Edit to-do" onClose={() => setEditing(null)}>
          <TodoForm
            initial={todoValuesOf(editing)}
            submitLabel="Save changes"
            busyLabel="Saving…"
            showStatus
            onSubmit={(values) => save(editing, values)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      ) : null}

      {shareOffer ? (
        <ShareTaskDialog
          offer={shareOffer}
          onClose={() => setShareOffer(null)}
          onShared={(summary) => {
            setShareOffer(null)
            notify(summary, 'success')
            void tasks.reload()
          }}
        />
      ) : null}
    </div>
  )
}
