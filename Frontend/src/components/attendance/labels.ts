import { getErrorMessage } from '../../api/axios'
import type { ApprovalStatus, AttendanceSettings, AttendanceStatus, LeaveRequestStatus } from '../../api/attendanceAPI'

// One label per value, everywhere (UI_REDESIGN 6.2)
export const DAY_TYPE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  'half-day': 'Half day',
  leave: 'Leave',
  absent: 'Absent',
}

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  ...APPROVAL_LABELS,
  mixed: 'Partly approved',
}

export const dayTypeLabel = (status?: string | null) =>
  (status && DAY_TYPE_LABELS[status as AttendanceStatus]) || 'Unknown'

export const approvalLabel = (status?: string | null) =>
  (status && LEAVE_STATUS_LABELS[status as LeaveRequestStatus]) || 'Unknown'

// ISO weekdays (1 is Monday)
export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
]

// "Mon–Fri", or "Mon, Wed, Fri"
export const describeWorkdays = (workdays: number[] = []) => {
  const days = [...new Set(workdays)].sort((a, b) => a - b)
  if (days.length === 0) return 'No workdays'
  if (days.length === 7) return 'Every day'
  const consecutive = days.every((day, index) => index === 0 || day === days[index - 1] + 1)
  const short = (day: number) => WEEKDAYS[day - 1]?.short ?? String(day)
  if (consecutive && days.length > 2) return `${short(days[0])}–${short(days[days.length - 1])}`
  return days.map(short).join(', ')
}

// 'HH:MM' plus some minutes, as 'HH:MM'
export const addMinutes = (time: string, minutes: number) => {
  const [hours, mins] = time.split(':').map(Number)
  const total = (((hours * 60 + mins + (minutes || 0)) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// "Shift starts 09:30 · Late after 09:45", or that late marking is off
export const describeShift = (settings?: AttendanceSettings | null) => {
  if (!settings) return ''
  if (!settings.shiftStart) return 'No fixed start time: nobody is marked late'
  const lateAfter = addMinutes(settings.shiftStart, settings.lateAfterMinutes)
  return `Shift starts ${settings.shiftStart} · Late after ${lateAfter}`
}

export const leaveTypeLabel = (settings: AttendanceSettings | null | undefined, key?: string | null, fallback?: string) => {
  if (!key) return ''
  return settings?.leaveTypes.find((type) => type.key === key)?.label || fallback || key
}

// "3 days", "1 day", "Half a day"
export const formatDays = (days: number) => {
  if (days === 0.5) return 'Half a day'
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

// The server's message, with the hourly limit on leave and correction
// requests explained
export const describeError = (error: unknown, fallback: string) => {
  const message = getErrorMessage(error, fallback)
  const status = (error as { status?: number })?.status
  if (status === 429) {
    return `${message} Each person can send 30 leave or correction requests an hour.`
  }
  return message
}

// Initials for an avatar: at most two, upper case
export const initials = (name?: string) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
