import { Badge } from './ui'
import {
  APPROVAL_CLASSES,
  APPROVAL_LABELS,
  DAY_TYPE_CLASSES,
  DAY_TYPE_LABELS,
  INVITE_STATE_CLASSES,
  INVITE_STATE_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  TASK_STATUS_CLASSES,
  TASK_STATUS_LABELS,
  labelFrom,
} from './format'

const FALLBACK = 'bg-gray-100 text-gray-600'

export function TaskStatusBadge({ status }: { status: string }) {
  return <Badge className={TASK_STATUS_CLASSES[status] ?? FALLBACK}>{labelFrom(TASK_STATUS_LABELS, status)}</Badge>
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge className={PRIORITY_CLASSES[priority] ?? FALLBACK}>{labelFrom(PRIORITY_LABELS, priority)}</Badge>
}

// The kind of day is outlined and the approval state is filled, so the two
// never look alike
export function DayTypeBadge({ status }: { status: string }) {
  return (
    <Badge className={`border bg-white ${DAY_TYPE_CLASSES[status] ?? 'border-gray-300 text-gray-700'}`}>
      {labelFrom(DAY_TYPE_LABELS, status)}
    </Badge>
  )
}

export function ApprovalBadge({ status }: { status?: string }) {
  if (!status) return null
  return <Badge className={APPROVAL_CLASSES[status] ?? FALLBACK}>{labelFrom(APPROVAL_LABELS, status)}</Badge>
}

export function InviteStateBadge({ state }: { state: string }) {
  return <Badge className={INVITE_STATE_CLASSES[state] ?? FALLBACK}>{labelFrom(INVITE_STATE_LABELS, state)}</Badge>
}

export function FrozenBadge() {
  return <Badge className="bg-sky-100 text-sky-800">Frozen</Badge>
}
