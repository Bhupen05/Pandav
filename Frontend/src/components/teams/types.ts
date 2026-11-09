// Shapes of the team API's responses, as the team pages use them

export type TeamPerson = {
  _id: string
  name: string
  email?: string
  role?: string
  department?: string
  profileImage?: string
  // false: the account is deactivated (it stays in its team)
  isActive?: boolean
}

export type TeamCounts = {
  leaders: number
  members: number
  // Pending, unexpired invites; only for admins and the team's leaders
  openInvites?: number
}

export type Team = {
  _id: string
  name: string
  description?: string
  leaders: TeamPerson[]
  members: TeamPerson[]
  // false: an admin froze the team; it can be read but not changed
  isActive?: boolean
  createdAt?: string
  createdBy?: { _id?: string; name?: string; email?: string } | string | null
  counts?: TeamCounts
}

export type InviteState = 'pending' | 'expired' | 'accepted' | 'declined' | 'withdrawn'

// An invite a team has sent
export type SentInvite = {
  _id: string
  invitedUser?: TeamPerson | null
  invitedBy?: { _id: string; name: string } | null
  withdrawnBy?: { _id: string; name: string } | null
  status: string
  state: InviteState
  expiresAt?: string
  respondedAt?: string
  createdAt?: string
  updatedAt?: string
}

// An invite the signed-in user has received
export type ReceivedInvite = {
  _id: string
  // null if the team was deleted meanwhile
  team: { _id: string; name: string; description?: string; isActive?: boolean } | null
  invitedBy?: { _id: string; name: string; email?: string; profileImage?: string } | null
  status: string
  expiresAt?: string
  createdAt?: string
}

// Someone a team could invite
export type InviteCandidate = {
  _id: string
  name: string
  department?: string
  profileImage?: string
  email?: string
  // This team's invite is already waiting for them
  invitePending?: boolean
}

export type PersonRef = { _id: string; name: string; email?: string }

export type AssigneeProgress = {
  user: string | { _id: string; name?: string }
  status: 'not-started' | 'in-progress' | 'completion-requested' | 'completed'
  completionRequestedAt?: string
  notes?: string
}

export type TeamTask = {
  _id: string
  title: string
  description?: string
  status: string
  priority: string
  assignedTo: PersonRef[]
  createdBy?: PersonRef
  team?: string | null
  startDate?: string
  dueDate?: string
  dueDay?: string
  isOverdue?: boolean
  assigneeCount?: number
  doneCount?: number
  assigneeProgress?: AssigneeProgress[]
  editedBy?: { _id: string; name: string }
  editedAt?: string
  completionRequestedBy?: PersonRef
  completionRequestedAt?: string
  reviewRequestedAt?: string
  rejectionReason?: string
  rejectedBy?: PersonRef
  rejectedAt?: string
}

export type AttendanceRecord = {
  _id: string
  user: { _id: string; name: string; email?: string; department?: string; profileImage?: string } | null
  team?: { _id: string; name: string } | string | null
  date: string
  day?: string
  status: string
  approvalStatus?: string
  checkInTime?: string
  checkOutTime?: string
  workHours?: number
  remarks?: string
  reviewRemarks?: string
  approvedBy?: { _id: string; name: string } | null
  reviewedAt?: string
  leaveType?: string | null
  missedCheckout?: boolean
}

export type AttendanceSummary = {
  user: string
  month: string
  days: { present: number; late: number; halfDay: number; absent: number; leave: number }
  approvedHours: number
  pendingHours: number
  pendingCount: number
  rejectedCount: number
}

export type Pagination = { page: number; limit: number; total: number; pages: number }

export type ListResponse<T> = { success?: boolean; count?: number; data: T[]; pagination?: Pagination }

export const idOf = (value: string | { _id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?._id

// Leaders first, then members, each person once
export const teamPeople = (team: Team): TeamPerson[] => [
  ...team.leaders,
  ...team.members.filter((member) => !team.leaders.some((leader) => leader._id === member._id)),
]

// Leaders who can still sign in; a team always keeps at least one
export const activeLeaders = (team: Team) => team.leaders.filter((leader) => leader.isActive !== false)
