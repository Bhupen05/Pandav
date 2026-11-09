import { useEffect, useMemo, useRef, useState } from 'react'
import { userAPI } from '../../api/userAPI'
import { getErrorMessage } from '../../api/axios'
import { localDayKey } from '../../utils/formatDateTime'
import { errorBoxClass, secondaryButtonClass } from './formStyles'

// The parts of a task and an attendance record this page reads
interface ProfileTask {
  status: string
  createdAt?: string
  updatedAt?: string
}

interface ProfileAttendance {
  day?: string
  date?: string
  checkInTime?: string
  approvalStatus?: string
  workHours?: number
}

type DayEntry = { date: string; count: number }

const DAYS_SHOWN = 120

// One colour for every level, so the levels can be told apart
const COLOR_SCALE = ['bg-neutral-200', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400', 'bg-emerald-500', 'bg-emerald-700']

const colorForCount = (count: number) => COLOR_SCALE[Math.min(count, COLOR_SCALE.length - 1)]

// A YYYY-MM-DD day as a date in the browser's time zone
const parseDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

const alignToSunday = (date: Date) => {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function buildCalendar(entries: DayEntry[]) {
  if (entries.length === 0) return []
  const counts = new Map(entries.map((entry) => [entry.date, entry.count]))
  const today = parseDay(entries[entries.length - 1].date)
  const cells: DayEntry[] = []
  for (let d = alignToSunday(parseDay(entries[0].date)); d <= today; d.setDate(d.getDate() + 1)) {
    const key = localDayKey(d)
    cells.push({ date: key, count: counts.get(key) ?? 0 })
  }
  const weeks: DayEntry[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

function streaks(entries: DayEntry[]) {
  let best = 0
  let run = 0
  for (const entry of entries) {
    run = entry.count > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  let current = 0
  for (let i = entries.length - 1; i >= 0 && entries[i].count > 0; i--) current += 1
  return { current, best }
}

const dayLabels = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat']

const TASK_PARTS = [
  { key: 'completed', label: 'Completed', bar: 'bg-emerald-500' },
  { key: 'in-progress', label: 'In progress', bar: 'bg-blue-500' },
  { key: 'completion-requested', label: 'Awaiting review', bar: 'bg-purple-500' },
  { key: 'pending', label: 'Pending', bar: 'bg-amber-500' },
  { key: 'cancelled', label: 'Cancelled', bar: 'bg-neutral-400' },
] as const

// The figures under the profile's overview: task numbers, a bar of tasks by
// status, and a heatmap of the last 120 days. The tasks and the attendance are
// read separately, so one failing does not blank the other.
// Tasks and attendance, each with its own error when it could not be read
interface ActivityData {
  tasks: ProfileTask[] | null
  attendance: ProfileAttendance[] | null
  tasksError: string | null
  attendanceError: string | null
}

const fetchActivity = async (userId: string, previous: ActivityData | null): Promise<ActivityData> => {
  const [taskResult, attendanceResult] = await Promise.allSettled([userAPI.getTasksOf(userId), userAPI.getAttendanceOf(userId)])
  const listOf = <T,>(value: { data?: unknown }): T[] => (Array.isArray(value?.data) ? (value.data as T[]) : [])
  return {
    // A part that failed keeps what was shown before
    tasks: taskResult.status === 'fulfilled' ? listOf<ProfileTask>(taskResult.value) : (previous?.tasks ?? null),
    attendance: attendanceResult.status === 'fulfilled' ? listOf<ProfileAttendance>(attendanceResult.value) : (previous?.attendance ?? null),
    tasksError: taskResult.status === 'rejected' ? getErrorMessage(taskResult.reason, 'Could not load your tasks.') : null,
    attendanceError: attendanceResult.status === 'rejected' ? getErrorMessage(attendanceResult.reason, 'Could not load your attendance.') : null,
  }
}

// The figures under the profile's overview: task numbers, a bar of tasks by
// status, and a heatmap of the last 120 days. The tasks and the attendance are
// read separately, so one failing does not blank the other.
export default function ProfileActivity({ userId }: { userId: string }) {
  const [data, setData] = useState<ActivityData | null>(null)
  // Changes when "Retry" is pressed
  const [attempt, setAttempt] = useState(0)
  const dataRef = useRef<ActivityData | null>(null)

  useEffect(() => {
    let active = true
    void fetchActivity(userId, dataRef.current).then((fresh) => {
      if (!active) return
      dataRef.current = fresh
      setData(fresh)
    })
    return () => {
      active = false
    }
  }, [userId, attempt])

  const tasks = data?.tasks ?? null
  const attendance = data?.attendance ?? null
  const tasksError = data?.tasksError ?? null
  const attendanceError = data?.attendanceError ?? null
  const loading = data === null

  const stats = useMemo(() => {
    const list = tasks ?? []
    const counts: Record<string, number> = {}
    list.forEach((task) => {
      counts[task.status] = (counts[task.status] ?? 0) + 1
    })
    const completed = counts.completed ?? 0
    const cancelled = counts.cancelled ?? 0
    const countable = list.length - cancelled
    return {
      total: list.length,
      counts,
      completionRate: countable > 0 ? Math.round((completed / countable) * 100) : 0,
    }
  }, [tasks])

  const attendanceStats = useMemo(() => {
    const approved = (attendance ?? []).filter((record) => record.approvalStatus === 'approved')
    const hours = approved.reduce((sum, record) => sum + (record.workHours || 0), 0)
    return { avgWorkHours: approved.length > 0 ? Math.round((hours / approved.length) * 10) / 10 : 0 }
  }, [attendance])

  const entries = useMemo(() => {
    const activity = new Map<string, number>()
    const add = (key: string) => activity.set(key, (activity.get(key) ?? 0) + 1)

    ;(tasks ?? []).forEach((task) => {
      if ((task.status === 'completed' || task.status === 'completion-requested') && task.updatedAt) add(localDayKey(new Date(task.updatedAt)))
      if (task.createdAt) add(localDayKey(new Date(task.createdAt)))
    })
    ;(attendance ?? []).forEach((record) => {
      // `day` is the server's day for the record; older records only have a time
      if (record.day) add(record.day)
      else if (record.date || record.checkInTime) add(localDayKey(new Date((record.date || record.checkInTime)!)))
    })

    const today = new Date()
    const result: DayEntry[] = []
    for (let i = DAYS_SHOWN; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = localDayKey(d)
      result.push({ date: key, count: activity.get(key) ?? 0 })
    }
    return result
  }, [tasks, attendance])

  const weeks = useMemo(() => buildCalendar(entries), [entries])
  const { current, best } = streaks(entries)
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  const failed = tasksError || attendanceError

  return (
    <>
      {failed && (
        <div role="alert" className={`mb-6 flex flex-wrap items-center justify-between gap-3 ${errorBoxClass}`}>
          <span>{tasksError && attendanceError ? 'Could not load your tasks and attendance.' : tasksError || attendanceError}</span>
          <button type="button" onClick={() => setAttempt((count) => count + 1)} className={secondaryButtonClass}>Retry</button>
        </div>
      )}

      {/* Stats Grid */}
      <section aria-label="Your figures" className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { icon: '📋', tint: 'bg-blue-100', value: stats.total, label: 'Total Tasks' },
          { icon: '✅', tint: 'bg-emerald-100', value: `${stats.completionRate}%`, label: 'Completion' },
          { icon: '⏱️', tint: 'bg-amber-100', value: `${attendanceStats.avgWorkHours}h`, label: 'Avg Hours' },
          { icon: '🔥', tint: 'bg-purple-100', value: current, label: 'Day Streak' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl ${stat.tint}`}>{stat.icon}</div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-neutral-900">{stat.value}</p>
                <p className="text-xs text-neutral-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Task Progress Bar */}
      <section aria-labelledby="task-progress-title" className="mb-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 id="task-progress-title" className="mb-4 text-lg font-semibold text-neutral-900">Task Progress</h2>
        <div className="mb-4 h-3 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
          <div className="flex h-full">
            {TASK_PARTS.map((part) => (
              <div
                key={part.key}
                className={`${part.bar} transition-all`}
                style={{ width: `${stats.total > 0 ? ((stats.counts[part.key] ?? 0) / stats.total) * 100 : 0}%` }}
              ></div>
            ))}
          </div>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {TASK_PARTS.map((part) => (
            <li key={part.key} className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-3 w-3 rounded-full ${part.bar}`}></span>
              <span className="text-neutral-600">{part.label} ({stats.counts[part.key] ?? 0})</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Activity Heatmap */}
      {loading ? (
        <div role="status" aria-label="Loading your activity" className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
        </div>
      ) : (
        <section aria-labelledby="activity-title" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="activity-title" className="text-lg font-semibold text-neutral-900">Activity</h2>
              <p className="text-sm text-neutral-500">{total} {total === 1 ? 'activity' : 'activities'} in the last {DAYS_SHOWN} days</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-700">{current}</p>
                <p className="text-xs text-neutral-500">Current streak</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-amber-700">{best}</p>
                <p className="text-xs text-neutral-500">Best streak</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto pb-1">
            <div
              role="img"
              aria-label={`Activity over the last ${DAYS_SHOWN} days: ${total} in all. Current streak ${current} days, best streak ${best} days.`}
              className="flex w-max gap-1"
            >
              <div className="flex w-8 flex-col gap-0.75 text-[10px] text-neutral-500" aria-hidden="true">
                {dayLabels.map((d, i) => (
                  <span key={i} className="h-3.25 leading-3.25">{d}</span>
                ))}
              </div>
              <div className="flex gap-0.75">
                {weeks.map((week, i) => (
                  <div key={i} className="flex flex-col gap-0.75">
                    {week.map((day) => (
                      <div
                        key={day.date}
                        className={`h-3.25 w-3.25 rounded-sm ${colorForCount(day.count)} transition-colors hover:ring-1 hover:ring-neutral-400`}
                        title={`${parseDay(day.date).toLocaleDateString([], { dateStyle: 'medium' })}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}`}
                      ></div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-1 text-xs text-neutral-500" aria-hidden="true">
            <span>Less</span>
            {COLOR_SCALE.map((c) => (
              <span key={c} className={`h-3.25 w-3.25 rounded-sm ${c}`}></span>
            ))}
            <span>More</span>
          </div>
        </section>
      )}
    </>
  )
}
