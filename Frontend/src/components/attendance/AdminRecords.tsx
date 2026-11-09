import { useState } from 'react'
import { Download, Plus } from 'lucide-react'
import {
  attendanceAPI,
  APPROVAL_STATUSES,
  ATTENDANCE_STATUSES,
  type AttendanceFilters,
  type AttendanceRecord,
  type AttendanceSettings,
  type ApprovalStatus,
  type AttendanceStatus,
} from '../../api/attendanceAPI'
import { useFeedback } from '../../context/useFeedback'
import { formatDay, formatHours, todayKey } from '../../utils/date'
import AdminQueue from './AdminQueue'
import AdminRecordDialog from './AdminRecordDialog'
import AdminRecordsTable from './AdminRecordsTable'
import { inputClass, labelClass, primaryButton, secondaryButton } from './fields'
import { approvalLabel, dayTypeLabel, describeError } from './labels'
import Pager from './Pager'
import { EmptyState, ErrorState, Loading } from './States'
import { saveBlob } from './download'
import { useLoad } from './useLoad'
import { useReview } from './useReview'

type FilterState = {
  user: string
  team: string
  status: '' | AttendanceStatus
  approvalStatus: '' | ApprovalStatus
  startDate: string
  endDate: string
  missedCheckout: boolean
}

const NO_FILTERS: FilterState = { user: '', team: '', status: '', approvalStatus: '', startDate: '', endDate: '', missedCheckout: false }
const PAGE_SIZE = 20
const REFRESH_MS = 30000

const toApiFilters = (filters: FilterState): AttendanceFilters => ({
  user: filters.user || undefined,
  team: filters.team || undefined,
  status: filters.status || undefined,
  approvalStatus: filters.approvalStatus || undefined,
  startDate: filters.startDate || undefined,
  endDate: filters.endDate || undefined,
  missedCheckout: filters.missedCheckout || undefined,
})

type Props = {
  meId: string
  settings?: AttendanceSettings
  // Loads the figures at the top of the page again
  onChanged: () => Promise<unknown>
}

// The "Records" tab: the waiting queue, the filtered and paged list, adding,
// editing and deleting, and the CSV export
export default function AdminRecords({ meId, settings, onChanged }: Props) {
  const { notify, confirm, prompt } = useFeedback()
  const today = todayKey()
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS)
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<{ record?: AttendanceRecord } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [overviewOpen, setOverviewOpen] = useState(false)

  const people = useLoad(() => attendanceAPI.listPeople(), 'people')
  const teams = useLoad(() => attendanceAPI.listTeams(), 'teams')
  const queue = useLoad(() => attendanceAPI.listRecords({ approvalStatus: 'pending', reviewable: true, page: 1, limit: 50 }), 'queue', { refreshMs: REFRESH_MS })
  const list = useLoad(
    () => attendanceAPI.listRecords({ ...toApiFilters(filters), page, limit: PAGE_SIZE }),
    JSON.stringify([filters, page]),
    { refreshMs: REFRESH_MS },
  )
  const overview = useLoad(
    async () => (overviewOpen ? await attendanceAPI.getStats({ startDate: filters.startDate, endDate: filters.endDate, team: filters.team }) : null),
    JSON.stringify([overviewOpen, filters.startDate, filters.endDate, filters.team]),
  )

  const refreshAll = () => Promise.all([queue.refresh(), list.refresh(), overview.refresh(), onChanged()])
  const review = useReview({ notify, prompt, onChanged: refreshAll })

  const setFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setPage(1)
  }
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const file = await attendanceAPI.exportCsv(toApiFilters(filters))
      saveBlob(file.blob, file.filename)
      notify(`Downloaded ${file.filename}.`, 'success')
    } catch (error) {
      notify(describeError(error, 'Could not export the records.'), 'error')
    } finally {
      setExporting(false)
    }
  }

  const deleteRecord = async (record: AttendanceRecord) => {
    const ok = await confirm({
      title: 'Delete this attendance record?',
      message: `${record.user?.name || 'Unknown'}, ${formatDay(record.day)}. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setDeletingId(record._id)
    try {
      await attendanceAPI.deleteAttendance(record._id)
      notify('Attendance record deleted.', 'success')
    } catch (error) {
      notify(describeError(error, 'Could not delete this record.'), 'error')
    }
    await refreshAll()
    setDeletingId('')
  }

  const records = list.data?.data ?? []
  const personList = people.data?.data ?? []
  const stats = overview.data?.data

  return (
    <div className="space-y-6">
      {queue.error && !queue.data ? (
        <ErrorState message={`The waiting list could not be loaded. ${queue.error}`} onRetry={queue.reload} />
      ) : (
        <AdminQueue
          records={queue.data?.data ?? []}
          total={queue.data?.pagination?.total ?? queue.data?.count ?? 0}
          meId={meId}
          today={today}
          busyId={review.busyId}
          onApprove={review.approve}
          onReject={review.reject}
          onChanged={refreshAll}
          notify={notify}
          confirm={confirm}
          prompt={prompt}
        />
      )}

      <section aria-labelledby="filters-title" className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 id="filters-title" className="sr-only">Filter the records</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="filter-user" className={labelClass}>Person</label>
            <select id="filter-user" value={filters.user} onChange={(event) => setFilter('user', event.target.value)} className={inputClass}>
              <option value="">Everyone</option>
              {personList.map((person) => (
                <option key={person._id} value={person._id}>{person.name}</option>
              ))}
            </select>
            {people.error && !people.data && (
              <p className="mt-1 text-xs text-red-700">The list of people did not load. <button type="button" onClick={people.reload} className="font-medium underline">Retry</button></p>
            )}
          </div>
          <div>
            <label htmlFor="filter-team" className={labelClass}>Team</label>
            <select id="filter-team" value={filters.team} onChange={(event) => setFilter('team', event.target.value)} className={inputClass}>
              <option value="">All teams</option>
              {(teams.data?.data ?? []).map((team) => (
                <option key={team._id} value={team._id}>{team.name}</option>
              ))}
            </select>
            {teams.error && !teams.data && (
              <p className="mt-1 text-xs text-red-700">The list of teams did not load. <button type="button" onClick={teams.reload} className="font-medium underline">Retry</button></p>
            )}
          </div>
          <div>
            <label htmlFor="filter-status" className={labelClass}>Day type</label>
            <select id="filter-status" value={filters.status} onChange={(event) => setFilter('status', event.target.value as '' | AttendanceStatus)} className={inputClass}>
              <option value="">All</option>
              {ATTENDANCE_STATUSES.map((status) => (
                <option key={status} value={status}>{dayTypeLabel(status)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-approval" className={labelClass}>Approval</label>
            <select id="filter-approval" value={filters.approvalStatus} onChange={(event) => setFilter('approvalStatus', event.target.value as '' | ApprovalStatus)} className={inputClass}>
              <option value="">All</option>
              {APPROVAL_STATUSES.map((status) => (
                <option key={status} value={status}>{approvalLabel(status)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-start" className={labelClass}>From</label>
            <input id="filter-start" type="date" value={filters.startDate} onChange={(event) => setFilter('startDate', event.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="filter-end" className={labelClass}>To</label>
            <input id="filter-end" type="date" value={filters.endDate} min={filters.startDate || undefined} onChange={(event) => setFilter('endDate', event.target.value)} className={inputClass} />
          </div>
          <div className="flex items-end">
            <label htmlFor="filter-missed" className="flex items-center gap-2 pb-2 text-sm text-neutral-800">
              <input id="filter-missed" type="checkbox" checked={filters.missedCheckout} onChange={(event) => setFilter('missedCheckout', event.target.checked)} className="h-4 w-4" />
              Missed check-outs only
            </label>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => { setFilters(NO_FILTERS); setPage(1) }} disabled={!filtered} className={`${secondaryButton} w-full`}>
              Clear filters
            </button>
          </div>
        </div>
      </section>

      <details onToggle={(event) => setOverviewOpen(event.currentTarget.open)} className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-900">
          Per-person totals
          <span className="ml-2 font-normal text-neutral-600">(approved days only, for the team and dates chosen above)</span>
        </summary>
        <div className="border-t border-neutral-200">
          {overview.error && !overview.data ? (
            <div className="p-4"><ErrorState message={overview.error} onRetry={overview.reload} /></div>
          ) : overview.loading && !overview.data ? (
            <Loading label="Adding up the days…" />
          ) : !stats || stats.people.length === 0 ? (
            <EmptyState>No approved days in this period.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs font-semibold uppercase text-neutral-700">
                  <tr>
                    <th scope="col" className="px-4 py-2">Person</th>
                    <th scope="col" className="px-4 py-2">Present</th>
                    <th scope="col" className="px-4 py-2">Late</th>
                    <th scope="col" className="px-4 py-2">Half day</th>
                    <th scope="col" className="px-4 py-2">Absent</th>
                    <th scope="col" className="px-4 py-2">Leave</th>
                    <th scope="col" className="px-4 py-2">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {stats.people.map((person) => (
                    <tr key={person.user._id}>
                      <td className="px-4 py-2 font-medium text-neutral-900">
                        {person.user.name}
                        {person.user.isActive === false && <span className="ml-2 text-xs font-normal text-neutral-600">(deactivated)</span>}
                      </td>
                      <td className="px-4 py-2">{person.present}</td>
                      <td className="px-4 py-2">{person.late}</td>
                      <td className="px-4 py-2">{person.halfDay}</td>
                      <td className="px-4 py-2">{person.absent}</td>
                      <td className="px-4 py-2">{person.leave}</td>
                      <td className="whitespace-nowrap px-4 py-2">{formatHours(person.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <section aria-labelledby="records-title" className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
          <h2 id="records-title" className="font-semibold text-neutral-900">Attendance records</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportCsv} disabled={exporting} className={secondaryButton}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button type="button" onClick={() => setDialog({})} className={primaryButton}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add record
            </button>
          </div>
        </div>

        {list.error && !list.data ? (
          <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>
        ) : list.loading && !list.data ? (
          <Loading label="Loading the records…" />
        ) : records.length === 0 ? (
          <EmptyState>{filtered ? 'No records match these filters.' : 'No attendance records yet.'}</EmptyState>
        ) : (
          <>
            <div className={list.loading ? 'opacity-60' : ''} aria-busy={list.loading}>
              <AdminRecordsTable
                records={records}
                settings={settings}
                today={today}
                meId={meId}
                busyId={review.busyId || deletingId}
                onApprove={review.approve}
                onReject={review.reject}
                onEdit={(record) => setDialog({ record })}
                onDelete={deleteRecord}
              />
            </div>
            <Pager pagination={list.data?.pagination} shown={records.length} noun="records" onPage={setPage} busy={list.loading} />
          </>
        )}
      </section>

      {dialog && (
        <AdminRecordDialog
          record={dialog.record}
          people={personList}
          settings={settings}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null)
            notify(message, 'success')
            refreshAll()
          }}
        />
      )}
    </div>
  )
}
