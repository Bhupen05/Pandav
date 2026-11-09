import { getErrorMessage } from '../../api/axios'
import { addDays, isoWeekday } from '../../utils/date'
import type { ApprovalStatus, AttendanceRecord, AttendanceSettings, AttendanceStatus, Holiday, LeaveRequestStatus } from '../../api/attendanceAPI'

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

// Workdays from start to end (YYYY-MM-DD, both included), counted as the
// server counts leave: days of the week people work, minus holidays
export const countWorkdays = (start: string, end: string, workdays: number[], holidays: Set<string>) => {
  let count = 0
  for (let day = start, guard = 0; day <= end && guard < 70; day = addDays(day, 1), guard += 1) {
    if (workdays.includes(isoWeekday(day)) && !holidays.has(day)) count += 1
  }
  return count
}

// Why Check in is closed today, or '' when it is open. Mirrors the server: a
// pending or approved leave, half-day or absence request closes it; a rejected
// one doesn't (checking in replaces it). A holiday closes it too.
export const checkInBlockReason = (record: AttendanceRecord | undefined, holiday?: Holiday): string => {
  if (record?.checkInTime) return ''
  if (record && record.approvalStatus !== 'rejected') {
    if (record.status === 'leave') {
      return record.approvalStatus === 'approved'
        ? 'You are on approved leave today, so check-in is closed.'
        : 'You asked for leave today, so check-in is closed. Withdraw the request on the Leave tab if you want to work.'
    }
    if (record.status === 'half-day') return 'You asked for a half day today, so check-in is closed.'
    if (record.status === 'absent') return 'You are marked absent today, so check-in is closed.'
  }
  if (holiday) return `Today is a holiday (${holiday.name}), so check-in is closed.`
  return ''
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
