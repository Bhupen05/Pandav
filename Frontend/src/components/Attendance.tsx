import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { attendanceAPI, ATTENDANCE_STATUSES, type AttendanceRecord, type AttendanceStatus } from '../api/attendanceAPI'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import { addDays, browserTimeZone, dayKeyIn } from '../utils/date'
import CheckPanel from './attendance/CheckPanel'
import { inputClass } from './attendance/fields'
import { checkInBlockReason, dayTypeLabel, describeError } from './attendance/labels'
import LeavePanel from './attendance/LeavePanel'
import MissedCheckoutBanner from './attendance/MissedCheckoutBanner'
import OwnRecords from './attendance/OwnRecords'
import Pager from './attendance/Pager'
import { EmptyState, ErrorState, Loading } from './attendance/States'
import Tabs from './attendance/Tabs'
import { HolidaysCard, MonthCard, TodayCards } from './attendance/TodaySummary'
import { useLoad } from './attendance/useLoad'

const PAGE_SIZE = 15
const REFRESH_MS = 30000
// Check out still closes last night's check-in for this long (the server's rule)
const OVERNIGHT_MS = 20 * 3600 * 1000

// The signed-in person's own records around today, and which one Check out
// would close. Done here, not while rendering, because it reads the clock.
async function loadRecent(userId: string, today: string) {
  const response = await attendanceAPI.listRecords({ user: userId, startDate: addDays(today, -2), endDate: addDays(today, 1) })
  const records = response.data
  const todayRecord = records.find((record) => record.day === today)
  const now = Date.now()
  const open: AttendanceRecord | undefined = todayRecord?.checkInTime
    ? todayRecord.checkOutTime ? undefined : todayRecord
    : records.find((record) => record.checkInTime && !record.checkOutTime && record.day < today && now - new Date(record.checkInTime).getTime() < OVERNIGHT_MS)
  return { todayRecord, open }
}

function Attendance() {
  const { notify, confirm } = useFeedback()
  const { user, isAdmin } = useAuth()
  const userId = user?._id ?? ''

  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'leave' ? 'leave' : 'attendance'
  const changeTab = (id: string) => setSearchParams(id === 'leave' ? { tab: 'leave' } : {}, { replace: true })

  const [statusFilter, setStatusFilter] = useState<'' | AttendanceStatus>('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)

  // Everything here is about the signed-in person, administrators included
  const settings = useLoad(() => attendanceAPI.getSettings(), 'settings')
  // Today is the day it is in the server's time zone, which decides what a record's day is; the
  // browser's own zone only stands in if the settings can't be loaded. Until one of them is
  // known there is no "today" and today's record waits.
  const zone = settings.data?.data.timezone ?? (settings.error ? browserTimeZone() : undefined)
  const today = zone ? dayKeyIn(zone) : ''
  const recent = useLoad(() => (today ? loadRecent(userId, today) : Promise.resolve(null)), `${userId}:${today}`, { refreshMs: REFRESH_MS })
  const summary = useLoad(() => attendanceAPI.getSummary(), `${userId}:${today.slice(0, 7)}`, { refreshMs: REFRESH_MS })
  const holidays = useLoad(() => attendanceAPI.getHolidays(), 'holidays')
  const missed = useLoad(() => attendanceAPI.listRecords({ user: userId, missedCheckout: true }), userId, { refreshMs: REFRESH_MS })
  const list = useLoad(
    () => attendanceAPI.listRecords({ user: userId, status: statusFilter || undefined, page, limit: PAGE_SIZE }),
    `${userId}:${statusFilter}:${page}`,
    { refreshMs: REFRESH_MS },
  )

  const reloadAll = () => Promise.all([recent.refresh(), summary.refresh(), missed.refresh(), list.refresh()])

  const todayRecord = recent.data?.todayRecord
  const holidayList = holidays.data?.data ?? []
  const holidayToday = holidayList.find((holiday) => holiday.day === today)
  const blockedReason = recent.data ? checkInBlockReason(todayRecord, holidayToday) : ''
  const rejectedToday = !!todayRecord && todayRecord.approvalStatus === 'rejected' && !todayRecord.checkInTime

  const handleCheckIn = async () => {
    setBusy(true)
    try {
      const response = await attendanceAPI.checkIn()
      notify(
        `Checked in successfully. Your attendance is pending approval.${response.data?.status === 'late' ? ' You were marked late.' : ''}`,
        'success',
      )
    } catch (error) {
      notify(describeError(error, 'Could not check in.'), 'error')
    }
    await reloadAll()
    setBusy(false)
  }

  const handleCheckOut = async () => {
    setBusy(true)
    try {
      await attendanceAPI.checkOut()
      notify('Checked out successfully. Your work hours have been recorded.', 'success')
    } catch (error) {
      notify(describeError(error, 'Could not check out.'), 'error')
    }
    await reloadAll()
    setBusy(false)
  }

  const records = list.data?.data ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-neutral-900">Attendance Tracking</h1>
          <p className="text-sm text-neutral-700">Check in and out, ask for leave and follow your working hours.</p>
        </div>
        {isAdmin && (
          <Link to="/admin/attendance" className="inline-flex w-fit items-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
            Manage everyone's attendance
          </Link>
        )}
      </div>

      <Tabs
        label="Attendance sections"
        idPrefix="attendance"
        active={tab}
        onChange={changeTab}
        tabs={[
          { id: 'attendance', label: 'My attendance' },
          { id: 'leave', label: 'Leave' },
        ]}
      />

      {tab === 'leave' ? (
        <div role="tabpanel" id="attendance-panel-leave" aria-labelledby="attendance-tab-leave">
          <LeavePanel
            userId={userId}
            settings={settings.data?.data}
            settingsError={settings.error}
            onRetrySettings={settings.reload}
            holidays={holidayList}
            onChanged={reloadAll}
            notify={notify}
            confirm={confirm}
          />
        </div>
      ) : (
        <div role="tabpanel" id="attendance-panel-attendance" aria-labelledby="attendance-tab-attendance" className="space-y-6">
          <MissedCheckoutBanner records={missed.data?.data ?? []} onSent={reloadAll} notify={notify} />

          {recent.error && !recent.data ? (
            <ErrorState message={`Today's record could not be loaded. ${recent.error}`} onRetry={recent.reload} />
          ) : (
            <TodayCards record={todayRecord} holiday={holidayToday} loading={!recent.data} />
          )}

          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2">
              <MonthCard summary={summary.data?.data} loading={summary.loading} error={summary.error} onRetry={summary.reload} />
            </div>
            <HolidaysCard holidays={holidayList} today={today} loading={holidays.loading} error={holidays.error} onRetry={holidays.reload} />
          </div>

          <CheckPanel
            ready={!!recent.data}
            busy={busy}
            record={todayRecord}
            hasOpenCheckIn={!!recent.data?.open}
            blockedReason={blockedReason}
            rejectedToday={rejectedToday}
            settings={settings.data?.data}
            settingsError={settings.error}
            onRetrySettings={settings.reload}
            onCheckIn={handleCheckIn}
            onCheckOut={handleCheckOut}
          />

          <section aria-labelledby="records-title" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <h2 id="records-title" className="text-lg font-semibold text-neutral-900">Attendance records</h2>
              <div className="flex items-center gap-2">
                <label htmlFor="records-filter" className="whitespace-nowrap text-sm text-neutral-700">Day type</label>
                <select
                  id="records-filter"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as '' | AttendanceStatus)
                    setPage(1)
                  }}
                  className={`${inputClass} w-auto`}
                >
                  <option value="">All</option>
                  {ATTENDANCE_STATUSES.map((status) => (
                    <option key={status} value={status}>{dayTypeLabel(status)}</option>
                  ))}
                </select>
              </div>
            </div>

            {list.error && !list.data ? (
              <div className="px-5 pb-5"><ErrorState message={list.error} onRetry={list.reload} /></div>
            ) : list.loading && !list.data ? (
              <Loading label="Loading your records…" />
            ) : records.length === 0 ? (
              <EmptyState>{statusFilter ? 'No days match this filter.' : 'No attendance records yet.'}</EmptyState>
            ) : (
              <>
                <div className={`border-t border-neutral-200 ${list.loading ? 'opacity-60' : ''}`} aria-busy={list.loading}>
                  <OwnRecords records={records} settings={settings.data?.data} today={today} />
                </div>
                <Pager pagination={list.data?.pagination} shown={records.length} noun="records" onPage={setPage} busy={list.loading} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default Attendance
