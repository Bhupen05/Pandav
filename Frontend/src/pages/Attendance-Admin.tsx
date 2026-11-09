import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarCheck, ClipboardCheck, ClockAlert, PlaneTakeoff, type LucideIcon } from 'lucide-react'
import { attendanceAPI } from '../api/attendanceAPI'
import { useAuth } from '../context/useAuth'
import AdminCorrections from '../components/attendance/AdminCorrections'
import AdminHolidays from '../components/attendance/AdminHolidays'
import AdminLeave from '../components/attendance/AdminLeave'
import AdminRecords from '../components/attendance/AdminRecords'
import AdminSettings from '../components/attendance/AdminSettings'
import Tabs from '../components/attendance/Tabs'
import { useLoad } from '../components/attendance/useLoad'

const TABS = ['records', 'leave', 'corrections', 'settings', 'holidays'] as const
type TabId = (typeof TABS)[number]

function Figure({ icon: Icon, label, value, tone, loading }: { icon: LucideIcon; label: string; value?: number; tone: string; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-neutral-700">{label}</p>
          <p className="text-xl font-bold text-neutral-900">{value ?? (loading ? '…' : '—')}</p>
        </div>
      </div>
    </div>
  )
}

export default function AttendanceAdmin() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const meId = user?._id ?? ''

  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: TabId = TABS.find((id) => id === requested) ?? 'records'
  const changeTab = (id: string) => setSearchParams(id === 'records' ? {} : { tab: id }, { replace: true })

  // The figures at the top, and the counts on the tabs
  const figures = useLoad(() => attendanceAPI.getStats(), 'figures', { refreshMs: 30000 })
  const leaveWaiting = useLoad(() => attendanceAPI.getLeaveRequests({ status: 'pending', page: 1, limit: 1 }), 'leave-waiting', { refreshMs: 30000 })
  const fixesWaiting = useLoad(() => attendanceAPI.listRecords({ hasCorrection: true, page: 1, limit: 1 }), 'fixes-waiting', { refreshMs: 30000 })
  // Settings are used by several tabs (leave types, labels)
  const settings = useLoad(() => attendanceAPI.getSettings(), 'settings')

  const refreshFigures = () => Promise.all([figures.refresh(), leaveWaiting.refresh(), fixesWaiting.refresh()])

  const leaveCount = leaveWaiting.data?.pagination?.total
  const fixCount = fixesWaiting.data?.pagination?.total
  const stats = figures.data?.data

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <div className="bg-linear-to-r from-blue-700 to-emerald-700 text-white">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <CalendarCheck className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold md:text-3xl">Attendance Management</h1>
                <p className="text-sm text-white">Attendance, leave and the rules for everyone</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/25"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Figure icon={ClipboardCheck} label="Checked in today" value={stats?.checkedInToday} tone="bg-emerald-100 text-emerald-800" loading={figures.loading} />
          <Figure icon={ClockAlert} label="Waiting for approval" value={stats?.pendingCount} tone="bg-amber-100 text-amber-800" loading={figures.loading} />
          <Figure icon={PlaneTakeoff} label="Leave requests waiting" value={leaveCount} tone="bg-violet-100 text-violet-800" loading={leaveWaiting.loading} />
          <Figure icon={ClockAlert} label="Check-out fixes waiting" value={fixCount} tone="bg-orange-100 text-orange-800" loading={fixesWaiting.loading} />
        </div>
        {figures.error && !figures.data && (
          <p role="alert" className="-mt-3 mb-5 text-sm text-red-700">
            The figures could not be loaded. {figures.error}{' '}
            <button type="button" onClick={figures.reload} className="font-medium underline">Retry</button>
          </p>
        )}

        <Tabs
          label="Attendance management sections"
          idPrefix="admin-attendance"
          active={tab}
          onChange={changeTab}
          tabs={[
            { id: 'records', label: 'Records', count: stats?.pendingCount },
            { id: 'leave', label: 'Leave requests', count: leaveCount },
            { id: 'corrections', label: 'Corrections', count: fixCount },
            { id: 'settings', label: 'Settings' },
            { id: 'holidays', label: 'Holidays' },
          ]}
        />

        <div role="tabpanel" id={`admin-attendance-panel-${tab}`} aria-labelledby={`admin-attendance-tab-${tab}`}>
          {tab === 'records' && <AdminRecords meId={meId} settings={settings.data?.data} onChanged={refreshFigures} />}
          {tab === 'leave' && <AdminLeave meId={meId} settings={settings.data?.data} onChanged={refreshFigures} />}
          {tab === 'corrections' && <AdminCorrections onChanged={refreshFigures} />}
          {tab === 'settings' && (
            <AdminSettings settings={settings.data?.data} error={settings.error} onRetry={settings.reload} onSaved={settings.refresh} />
          )}
          {tab === 'holidays' && <AdminHolidays />}
        </div>
      </div>
    </div>
  )
}
