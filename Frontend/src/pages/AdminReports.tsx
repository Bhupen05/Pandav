import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Download, Play } from 'lucide-react'
import { adminAPI, type BackgroundJob, type OverviewReport, type ReportFigures, type TeamSummary } from '../api/adminAPI'
import { useFeedback } from '../context/useFeedback'
import { AdminHeader, Badge, Loadable } from '../components/admin/ui'
import { useResource } from '../components/admin/useResource'
import { useBusy } from '../components/admin/useBusy'
import { errorText, formatDateTime, formatDay, formatHours } from '../components/admin/format'
import { TASK_STATUS_LABELS, jobLabel } from '../components/admin/labels'
import { BTN, FIELD, LABEL } from '../components/admin/buttons'

type Applied = { from: string; to: string; team: string }

const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const every = (minutes: number) =>
  minutes === 1 ? 'every minute' : minutes === 60 ? 'every hour' : minutes % 60 === 0 ? `every ${minutes / 60} hours` : `every ${minutes} minutes`

export default function AdminReports() {
  const teams = useResource(useCallback((signal: AbortSignal) => adminAPI.getTeams({ signal }), []))

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <AdminHeader title="Reports" subtitle="How teams are doing, exports, and the background jobs." back={{ to: '/admin', label: 'Back to dashboard' }} />
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-6">
        <Overview teams={teams.data ?? []} />
        <Exports teams={teams.data ?? []} />
        <Jobs />
      </div>
    </div>
  )
}

function TeamSelect({ id, value, onChange, teams, anyLabel }: { id: string; value: string; onChange: (value: string) => void; teams: TeamSummary[]; anyLabel: string }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={FIELD}>
      <option value="">{anyLabel}</option>
      <option value="none">People in no team</option>
      {teams.map((team) => (
        <option key={team._id} value={team._id}>
          {team.name}
          {team.isActive === false ? ' (frozen)' : ''}
        </option>
      ))}
    </select>
  )
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      {description && <p className="mt-0.5 mb-3 text-sm text-neutral-600">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  )
}

// ── Per-team overview ────────────────────────────────────────────────────────

function Overview({ teams }: { teams: TeamSummary[] }) {
  const [draft, setDraft] = useState<Applied>({ from: '', to: '', team: '' })
  const [applied, setApplied] = useState<Applied>({ from: '', to: '', team: '' })
  const [formError, setFormError] = useState('')

  const report = useResource(
    useCallback((signal: AbortSignal) => adminAPI.getOverviewReport({ from: applied.from, to: applied.to, team: applied.team }, { signal }), [applied]),
  )

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.from && draft.to && draft.from > draft.to) {
      setFormError('The start date is after the end date.')
      return
    }
    setFormError('')
    setApplied(draft)
  }

  return (
    <Section title="Teams overview" description="Tasks and approved attendance for each team over a period. Leave the dates empty for the last 30 days.">
      <form onSubmit={onSubmit} aria-label="Choose the period" className="mb-4 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr_auto] lg:items-end">
        <div>
          <label htmlFor="report-from" className={LABEL}>From</label>
          <input id="report-from" type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor="report-to" className={LABEL}>To</label>
          <input id="report-to" type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor="report-team" className={LABEL}>Team</label>
          <TeamSelect id="report-team" value={draft.team} onChange={(team) => setDraft({ ...draft, team })} teams={teams} anyLabel="All teams" />
        </div>
        <button type="submit" disabled={report.loading} className={`${BTN.md} ${BTN.primary}`}>
          Show report
        </button>
        {formError && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-4">
            {formError}
          </p>
        )}
      </form>

      <Loadable
        data={report.data}
        error={report.error}
        loading={report.loading}
        onRetry={report.reload}
        errorFallback="Could not load the report"
        isEmpty={(data) => data.rows.length === 0}
        empty="There is nothing to report for this period."
      >
        {(data) => <OverviewTable report={data} />}
      </Loadable>
    </Section>
  )
}

const avg = (value: number | null) => (value === null ? '—' : `${value} days`)

function Figures({ tasks, attendance }: ReportFigures) {
  return (
    <>
      <td className="px-3 py-3 text-right">{tasks.created}</td>
      <td className="px-3 py-3 text-right">{tasks.completed}</td>
      <td className="px-3 py-3 text-right">{tasks.openOverdue}</td>
      <td className="px-3 py-3 text-right whitespace-nowrap">{avg(tasks.avgDaysToComplete)}</td>
      <td className="border-l border-neutral-100 px-3 py-3 text-right">{attendance.present}</td>
      <td className="px-3 py-3 text-right">{attendance.late}</td>
      <td className="px-3 py-3 text-right">{attendance.halfDay}</td>
      <td className="px-3 py-3 text-right">{attendance.absent}</td>
      <td className="px-3 py-3 text-right">{attendance.leave}</td>
      <td className="px-3 py-3 text-right whitespace-nowrap">{formatHours(attendance.hours)}</td>
    </>
  )
}

function OverviewTable({ report }: { report: OverviewReport }) {
  const head = 'px-3 py-2 text-right font-semibold'
  return (
    <>
      <p className="mb-2 text-sm text-neutral-600">
        {formatDay(report.from)} to {formatDay(report.to)}
      </p>
      <div role="region" aria-label="Teams overview table" tabIndex={0} className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">Tasks and attendance for each team</caption>
          <thead className="bg-neutral-50 text-xs text-neutral-600">
            <tr>
              <th scope="col" rowSpan={2} className="px-4 py-2 text-left font-semibold">Team</th>
              <th scope="col" rowSpan={2} className={head}>People</th>
              <th scope="colgroup" colSpan={4} className="px-3 py-2 text-center font-semibold">Tasks</th>
              <th scope="colgroup" colSpan={6} className="border-l border-neutral-100 px-3 py-2 text-center font-semibold">Approved attendance</th>
            </tr>
            <tr>
              <th scope="col" className={head}>Created</th>
              <th scope="col" className={head}>Completed</th>
              <th scope="col" className={head}>Overdue</th>
              <th scope="col" className={head}>Average time</th>
              <th scope="col" className={`${head} border-l border-neutral-100`}>Present</th>
              <th scope="col" className={head}>Late</th>
              <th scope="col" className={head}>Half day</th>
              <th scope="col" className={head}>Absent</th>
              <th scope="col" className={head}>Leave</th>
              <th scope="col" className={head}>Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {report.rows.map((row, index) => (
              <tr key={row.team?._id ?? `none-${index}`}>
                <th scope="row" className="px-4 py-3 text-left font-medium text-neutral-900">
                  {row.team ? row.team.name : 'People in no team'}
                  {row.team && !row.team.isActive && <Badge tone="sky" className="ml-2">Frozen</Badge>}
                </th>
                <td className="px-3 py-3 text-right">{row.members}</td>
                <Figures tasks={row.tasks} attendance={row.attendance} />
              </tr>
            ))}
          </tbody>
          {report.rows.length > 1 && (
            <tfoot className="bg-neutral-50 font-semibold">
              <tr>
                <th scope="row" className="px-4 py-3 text-left">All together</th>
                <td className="px-3 py-3 text-right">{report.totals.members}</td>
                <Figures tasks={report.totals.tasks} attendance={report.totals.attendance} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}

// ── Exports ──────────────────────────────────────────────────────────────────

function Exports({ teams }: { teams: TeamSummary[] }) {
  const { notify } = useFeedback()
  const { run, isBusy } = useBusy()
  const [filters, setFilters] = useState({ from: '', to: '', status: '', team: '' })
  const [formError, setFormError] = useState('')

  const exportUsers = () =>
    run('users', async () => {
      try {
        await adminAPI.exportUsers()
        notify('The list of people was downloaded.', 'success')
      } catch (error) {
        notify(errorText(error, 'Could not export the list of people'), 'error')
      }
    })

  const exportTasks = (event: FormEvent) => {
    event.preventDefault()
    if (filters.from && filters.to && filters.from > filters.to) {
      setFormError('The start date is after the end date.')
      return
    }
    setFormError('')
    void run('tasks', async () => {
      try {
        await adminAPI.exportTasks(filters)
        notify('The tasks were downloaded.', 'success')
      } catch (error) {
        notify(errorText(error, 'Could not export the tasks'), 'error')
      }
    })
  }

  return (
    <Section title="Exports" description="CSV files that open in a spreadsheet. Each export is recorded in the audit log.">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="font-semibold text-neutral-900">People</h3>
          <p className="mt-1 mb-4 text-sm text-neutral-600">Every account with its role, department, team and last sign-in.</p>
          <button type="button" onClick={exportUsers} disabled={isBusy('users')} className={`${BTN.md} ${BTN.neutral}`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {isBusy('users') ? 'Exporting...' : 'Export people'}
          </button>
        </div>

        <form onSubmit={exportTasks} aria-label="Export tasks" className="rounded-xl border border-neutral-200 bg-white p-4 lg:col-span-1">
          <h3 className="font-semibold text-neutral-900">Tasks</h3>
          <p className="mt-1 mb-3 text-sm text-neutral-600">Choose which tasks to include, or leave everything open for all of them.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="export-from" className={LABEL}>Created from</label>
              <input id="export-from" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={FIELD} />
            </div>
            <div>
              <label htmlFor="export-to" className={LABEL}>Created to</label>
              <input id="export-to" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={FIELD} />
            </div>
            <div>
              <label htmlFor="export-status" className={LABEL}>Status</label>
              <select id="export-status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={FIELD}>
                <option value="">Any status</option>
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="export-team" className={LABEL}>Team</label>
              <TeamSelect id="export-team" value={filters.team} onChange={(team) => setFilters({ ...filters, team })} teams={teams} anyLabel="Any team" />
            </div>
          </div>
          {formError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {formError}
            </p>
          )}
          <button type="submit" disabled={isBusy('tasks')} className={`${BTN.md} ${BTN.neutral} mt-4`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {isBusy('tasks') ? 'Exporting...' : 'Export tasks'}
          </button>
        </form>

        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="font-semibold text-neutral-900">Attendance</h3>
          <p className="mt-1 mb-4 text-sm text-neutral-600">The attendance export lives with the attendance records, where it follows the filters you choose there.</p>
          <Link to="/admin/attendance" className={`${BTN.md} ${BTN.neutral}`}>
            Go to attendance
          </Link>
        </div>
      </div>
    </Section>
  )
}

// ── Background jobs ──────────────────────────────────────────────────────────

function ResultView({ result }: { result: unknown }) {
  if (result === null || result === undefined) return <p className="text-sm text-neutral-600">Done. There was nothing to do.</p>
  if (typeof result !== 'object' || Array.isArray(result)) {
    return <p className="text-sm break-words text-neutral-800">{typeof result === 'object' ? JSON.stringify(result) : String(result)}</p>
  }
  const entries = Object.entries(result as Record<string, unknown>)
  if (entries.length === 0) return <p className="text-sm text-neutral-600">Done. There was nothing to do.</p>
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {entries.map(([name, value]) => (
        <div key={name} className="min-w-0">
          <dt className="text-xs text-neutral-500">{humanize(name)}</dt>
          <dd className="break-words text-neutral-800">
            {value !== null && typeof value === 'object' ? (
              <code className="text-xs">{JSON.stringify(value)}</code>
            ) : value === null || value === undefined || value === '' ? (
              '—'
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Jobs() {
  const { notify } = useFeedback()
  const { run, isBusy } = useBusy()
  const jobs = useResource(useCallback((signal: AbortSignal) => adminAPI.getJobs({ signal }), []))
  // What each job answered when it was run from this page
  const [results, setResults] = useState<Record<string, { at: string; result: unknown }>>({})

  const runNow = (job: BackgroundJob) =>
    run(job.name, async () => {
      const { title } = jobLabel(job.name)
      try {
        const result = await adminAPI.runJob(job.name)
        setResults((previous) => ({ ...previous, [job.name]: { at: new Date().toISOString(), result } }))
        notify(`${title} ran.`, 'success')
        jobs.reload()
      } catch (error) {
        notify(errorText(error, `Could not run ${title.toLowerCase()}`), 'error')
      }
    })

  return (
    <Section title="Background jobs" description="Work Pandav does by itself on a timer. Run one now to see what it does.">
      <Loadable
        data={jobs.data}
        error={jobs.error}
        loading={jobs.loading}
        onRetry={jobs.reload}
        errorFallback="Could not load the background jobs"
        isEmpty={(data) => data.length === 0}
        empty="There are no background jobs."
      >
        {(data) => (
          <ul className="grid gap-4 lg:grid-cols-2">
            {data.map((job) => {
              const { title, description } = jobLabel(job.name)
              const ran = results[job.name]
              return (
                <li key={job.name} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-neutral-900">{title}</h3>
                      <p className="text-xs text-neutral-500">Runs {every(job.everyMinutes)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.running && <Badge tone="blue">Running now</Badge>}
                      <button
                        type="button"
                        onClick={() => runNow(job)}
                        disabled={isBusy(job.name) || job.running}
                        aria-label={`Run ${title} now`}
                        className={`${BTN.sm} ${BTN.neutral}`}
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        {isBusy(job.name) ? 'Running...' : 'Run now'}
                      </button>
                    </div>
                  </div>
                  {description && <p className="mt-2 text-sm text-neutral-600">{description}</p>}
                  <p className="mt-2 text-xs text-neutral-500">{job.lastRunAt ? `Last run ${formatDateTime(job.lastRunAt)}` : 'Not run yet since the server started'}</p>
                  {job.lastError && (
                    <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      Last run failed: {job.lastError}
                    </p>
                  )}
                  {ran ? (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3" role="status">
                      <p className="mb-1 text-xs font-semibold text-emerald-800">Result of the run at {formatDateTime(ran.at)}</p>
                      <ResultView result={ran.result} />
                    </div>
                  ) : (
                    job.lastRunAt &&
                    job.lastResult !== undefined &&
                    job.lastResult !== null && (
                      <div className="mt-3 rounded-lg bg-neutral-50 p-3">
                        <p className="mb-1 text-xs font-semibold text-neutral-600">Last result</p>
                        <ResultView result={job.lastResult} />
                      </div>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Loadable>
    </Section>
  )
}
