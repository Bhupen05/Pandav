import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorText, formatDateTime, listOf, plural, tone } from './format'
import { useBusy, useResource } from './hooks'
import { Badge, BusyButton, EmptyState, ErrorState, LoadingState, SectionCard } from './ui'
import { dangerButton, secondaryButton, smallButton } from './styles'
import type { ReportedMessage } from './types'

type Page = { rows: ReportedMessage[]; hasMore: boolean }

function MessageCard({ message, onDeleted }: { message: ReportedMessage; onDeleted: (id: string) => void }) {
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()
  const deleted = Boolean(message.deletedAt)
  const where = message.kind === 'team' ? `Team ${message.team?.name ?? ''}`.trim() : `To ${message.receiver?.name ?? 'someone'}`

  const remove = async () => {
    if (!message.team) return
    const teamId = message.team._id
    const sure = await confirm({
      title: 'Delete this team message?',
      message: `It disappears for everyone in ${message.team.name}. The reports stay on this list.`,
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

  return (
    <li className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={message.kind === 'team' ? tone.info : tone.neutral}>{message.kind === 'team' ? 'Team message' : 'Direct message'}</Badge>
        <Badge className={tone.warning}>{plural(message.reportCount, 'report')}</Badge>
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

// Chat messages people reported, newest report first
export default function ReportedMessages() {
  const reports = useResource<Page>(
    async () => {
      const response = await socialV2API.getReportedMessages()
      return { rows: listOf<ReportedMessage>(response?.data), hasMore: Boolean(response?.hasMore) }
    },
    'Couldn’t load the reported messages.',
    { rows: [], hasMore: false },
  )
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState('')
  const { setData } = reports

  async function loadMore() {
    const last = reports.data.rows[reports.data.rows.length - 1]
    if (!last || moreBusy) return
    setMoreBusy(true)
    setMoreError('')
    try {
      const response = await socialV2API.getReportedMessages({ before: last.lastReportedAt, beforeId: last._id })
      const older = listOf<ReportedMessage>(response?.data)
      setData((page) => ({
        rows: [...page.rows, ...older.filter((row) => !page.rows.some((shown) => shown._id === row._id))],
        hasMore: Boolean(response?.hasMore),
      }))
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

  return (
    <SectionCard
      id="reported-messages"
      title="Reported messages"
      description="Direct and team chat messages people reported. A message stays on this list after it is dealt with."
      action={reports.loaded ? <Badge className={tone.neutral}>{plural(reports.data.rows.length, 'message')}{reports.data.hasMore ? '+' : ''}</Badge> : undefined}
    >
      {reports.error ? <div className="mb-4"><ErrorState message={reports.error} onRetry={() => void reports.reload()} retrying={reports.loading} /></div> : null}
      {!reports.loaded && reports.loading ? <LoadingState label="Loading reported messages…" /> : null}
      {reports.loaded && reports.data.rows.length === 0 ? <EmptyState>Nobody has reported a message.</EmptyState> : null}

      <ul className="space-y-3">
        {reports.data.rows.map((message) => (
          <MessageCard key={message._id} message={message} onDeleted={markDeleted} />
        ))}
      </ul>

      {reports.data.hasMore ? (
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
