import { Check, Clock, X, CircleAlert } from 'lucide-react'
import type { AttendanceStatus, LeaveRequestStatus } from '../../api/attendanceAPI'
import { dayTypeLabel, approvalLabel } from './labels'

// Day types and approval states use separate colour families and shapes:
// day types are square-cornered fills, approvals are outlined pills with an
// icon, so "leave" and "awaiting approval" never look alike (UI_REDESIGN 6.2)
const DAY_TYPE_CLASSES: Record<AttendanceStatus, string> = {
  present: 'bg-blue-100 text-blue-800',
  late: 'bg-fuchsia-100 text-fuchsia-800',
  'half-day': 'bg-teal-100 text-teal-800',
  leave: 'bg-violet-100 text-violet-800',
  absent: 'bg-slate-200 text-slate-800',
}

const APPROVAL_CLASSES: Record<LeaveRequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-300',
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  rejected: 'bg-red-50 text-red-800 ring-red-300',
  mixed: 'bg-sky-50 text-sky-800 ring-sky-300',
}

const APPROVAL_ICONS = { pending: Clock, approved: Check, rejected: X, mixed: CircleAlert }

export function DayTypeBadge({ status, detail }: { status: AttendanceStatus; detail?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${DAY_TYPE_CLASSES[status] ?? 'bg-neutral-100 text-neutral-800'}`}>
      {dayTypeLabel(status)}
      {detail ? <span className="ml-1 font-normal">· {detail}</span> : null}
    </span>
  )
}

export function ApprovalBadge({ status }: { status: LeaveRequestStatus }) {
  const Icon = APPROVAL_ICONS[status] ?? Clock
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${APPROVAL_CLASSES[status] ?? 'bg-neutral-50 text-neutral-700 ring-neutral-300'}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{approvalLabel(status)}</span>
    </span>
  )
}

// Small warning chip, for example "No check-out"
export function WarningChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-800">
      <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  )
}
