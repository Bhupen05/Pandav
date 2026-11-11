import { useId, useState } from 'react'
import { CheckCheck, RotateCcw, Trash2 } from 'lucide-react'
import { socialV2API, type ReportStatus } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorStatus, errorText, formatDateTime, listOf, plural, tone } from './format'
import { useBusy, useResource } from './hooks'
import { Badge, BusyButton, EmptyState, ErrorState, LoadingState, SectionCard } from './ui'
import { dangerButton, secondaryButton, smallButton, successButton } from './styles'
import type { ReportedMessage } from './types'

type Shown = Exclude<ReportStatus, 'all'>
// The rows are those of `status`: a list for another filter isn't shown while it loads
type Page = { status: Shown; rows: ReportedMessage[]; hasMore: boolean }

const FILTERS: Array<[Shown, string]> = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
]

const NOTE_MAX = 500

function MessageCard({
  message,
  onDeleted,
  onMoved,
  onConflict,
}: {
  message: ReportedMessage
  onDeleted: (id: string) => void
  // The reports were marked as handled or opened again: the row belongs to the other list now
  onMoved: (id: string) => void
  // The server says the reports are not in the state this page thought
  onConflict: () => void
}) {
  const { notify, confirm, prompt } = useFeedback()
  const { busy, run } = useBusy()
  const deleted = Boolean(message.deletedAt)
  const resolved = message.status === 'resolved'
  const where = message.kind === 'team' ? `Team ${message.team?.name ?? ''}`.trim() : `To ${message.receiver?.name ?? 'someone'}`

  const remove = async () => {
    if (!message.team) return
    const teamId = message.team._id
    const sure = await confirm({
      title: 'Delete this team message?',
      message: `It disappears for everyone in ${message.team.name}. The reports stay on this page.`,
      confirmLabel: 'Delete message',
      danger: true,
    })
    if (!sure) return
    await run('delete', async () => {
      try {
        await socialV2API.deleteTeamMessage(teamId, message._id)
        onDeleted(message._id)
        notify('Message deleted.', 'success')
      } catch (error) {
        notify(errorText(error, 'Couldn’t delete the message.'), 'error')
      }
    })
  }

  const decide = async (action: 'resolve' | 'reopen', note?: string) => {
    await run(action, async () => {
      try {
        await socialV2API.resolveReportedMessage(message._id, action, note)
        onMoved(message._id)
        notify(action === 'resolve' ? 'Marked as handled. It is under Resolved now.' : 'Reopened. It is under Open again.', 'success')
      } catch (error) {
        notify(errorText(error, action === 'resolve' ? 'Couldn’t mark the reports as handled.' : 'Couldn’t reopen the reports.'), 'error')
        // Another admin got there first: show what is true now
        if (errorStatus(error) === 409) onConflict()
      }
    })
  }

  const markHandled = async () => {
    const note = await prompt({
      title: 'Mark as handled?',
      message: 'The message stays as it is. The reports move to Resolved, and a new report of this message opens them again.',
      label: 'Note (optional)',
      required: false,
      maxLength: NOTE_MAX,
      confirmLabel: 'Mark as handled',
    })
    if (note === null) return
    await decide('resolve', note.trim() || undefined)
  }

  const resolver = message.resolution?.resolvedBy?.name

  return (
    <li className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={message.kind === 'team' ? tone.info : tone.neutral}>{message.kind === 'team' ? 'Team message' : 'Direct message'}</Badge>
        <Badge className={tone.warning}>{plural(message.reportCount, 'report')}</Badge>
        {resolved ? <Badge className={tone.success}>Handled</Badge> : null}
        {message.isEdited ? <Badge className={tone.neutral}>Edited</Badge> : null}
        {deleted ? <Badge className={tone.danger}>Deleted</Badge> : null}
      </div>
      <p className="mt-2 text-sm text-slate-700">
        <span className="font-semibold">{message.sender?.name ?? 'Someone'}</span>
        <span className="text-slate-500"> · {where} · {formatDateTime(message.sentAt)}</span>
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {deleted ? <span className="italic text-slate-500">This message was deleted{message.deletedAt ? ` on ${formatDateTime(message.deletedAt)}` : ''}.</span> : message.text}
      </p>

      {message.resolution ? (
        <p className="mt-2 break-words rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Handled by <span className="font-semibold">{resolver ?? 'an admin'}</span> on {formatDateTime(message.resolution.resolvedAt)}.
          {message.resolution.note ? <> <span className="font-semibold">Note:</span> {message.resolution.note}</> : null}
        </p>
      ) : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none rounded font-semibold text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          Who reported it ({message.reports.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {message.reports.map((report, index) => (
            <li key={`${report.at}-${index}`} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{report.by?.name ?? 'Someone'}</span> · {formatDateTime(report.at)}
              </p>
              <p className="mt-1 break-words text-sm text-slate-700">{report.reason || 'No reason given.'}</p>
              {report.text && report.text !== message.text ? (
                <p className="mt-1 break-words text-xs text-slate-500">The message then: “{report.text}”</p>
              ) : null}
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {resolved ? (
          <BusyButton
            busy={busy.reopen}
            busyLabel="Reopening…"
            onClick={() => void decide('reopen')}
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            className={`${secondaryButton} ${smallButton}`}
          >
            Reopen
          </BusyButton>
        ) : (
          <BusyButton
            busy={busy.resolve}
            busyLabel="Saving…"
            onClick={() => void markHandled()}
            icon={<CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
            className={`${successButton} ${smallButton}`}
          >
            Mark as handled
          </BusyButton>
        )}
        {message.kind === 'team' && !deleted ? (
          <BusyButton
            busy={busy.delete}
            busyLabel="Deleting…"
            onClick={() => void remove()}
            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            className={`${dangerButton} ${smallButton}`}
          >
            Delete message
          </BusyButton>
        ) : null}
        {message.kind === 'direct' ? (
          <p className="text-xs text-slate-500">Only the sender can delete a direct message. To stop someone, deactivate their account under Users.</p>
        ) : null}
      </div>
    </li>
  )
}

// Chat messages people reported, newest report first: the ones still open,
// or those an admin marked as handled
export default function ReportedMessages() {
  const id = useId()
  const [status, setStatus] = useState<Shown>('open')
  const reports = useResource<Page>(
    async () => {
      const response = await socialV2API.getReportedMessages(status)
      return { status, rows: listOf<ReportedMessage>(response?.data), hasMore: Boolean(response?.hasMore) }
    },
    'Couldn’t load the reported messages.',
    { status: 'open', rows: [], hasMore: false },
    { key: status },
  )
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState('')
  const { setData } = reports
  const showing = reports.data.status === status
  const rows = showing ? reports.data.rows : []
  const hasMore = showing && reports.data.hasMore

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last || moreBusy) return
    setMoreBusy(true)
    setMoreError('')
    try {
      const response = await socialV2API.getReportedMessages(status, { before: last.lastReportedAt, beforeId: last._id })
      const older = listOf<ReportedMessage>(response?.data)
      setData((page) =>
        page.status !== status
          ? page
          : {
              ...page,
              rows: [...page.rows, ...older.filter((row) => !page.rows.some((shown) => shown._id === row._id))],
              hasMore: Boolean(response?.hasMore),
            },
      )
    } catch (error) {
      setMoreError(errorText(error, 'Couldn’t load more reports.'))
    } finally {
      setMoreBusy(false)
    }
  }

  const markDeleted = (messageId: string) =>
    setData((page) => ({
      ...page,
      rows: page.rows.map((row) => (row._id === messageId ? { ...row, text: '', deletedAt: new Date().toISOString() } : row)),
    }))

  // Handled or reopened: it leaves this list for the other one
  const moved = (messageId: string) =>
    setData((page) => ({ ...page, rows: page.rows.filter((row) => row._id !== messageId) }))

  return (
    <SectionCard
      id="reported-messages"
      title="Reported messages"
      description="Chat messages people reported. Mark one as handled once it is dealt with; a new report opens it again."
      action={showing && reports.loaded ? <Badge className={tone.neutral}>{plural(rows.length, 'message')}{hasMore ? '+' : ''}</Badge> : undefined}
    >
      <fieldset className="mb-4">
        <legend className="sr-only">Show reported messages that are</legend>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) => (
            <label
              key={value}
              className={`inline-flex cursor-pointer select-none items-center rounded-full border px-4 py-2 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-400 has-[:focus-visible]:ring-offset-2 ${
                status === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name={`${id}-status`}
                value={value}
                checked={status === value}
                onChange={() => {
                  setStatus(value)
                  setMoreError('')
                }}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {reports.error ? <div className="mb-4"><ErrorState message={reports.error} onRetry={() => void reports.reload()} retrying={reports.loading} /></div> : null}
      {!(showing && reports.loaded) && reports.loading ? <LoadingState label="Loading reported messages…" /> : null}
      {showing && reports.loaded && rows.length === 0 ? (
        <EmptyState>{status === 'open' ? 'No reported messages are waiting for you.' : 'No reported message has been marked as handled yet.'}</EmptyState>
      ) : null}

      <ul aria-busy={reports.loading || undefined} className="space-y-3">
        {rows.map((message) => (
          <MessageCard key={message._id} message={message} onDeleted={markDeleted} onMoved={moved} onConflict={() => void reports.reload()} />
        ))}
      </ul>

      {hasMore ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          {moreError ? <p role="alert" className="text-sm text-rose-700">{moreError}</p> : null}
          <BusyButton busy={moreBusy} busyLabel="Loading…" onClick={() => void loadMore()} className={secondaryButton}>
            Load more
          </BusyButton>
        </div>
      ) : null}
    </SectionCard>
  )
}
