import { useCallback, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { adminAPI } from '../api/adminAPI'
import { useAuth } from '../context/useAuth'
import { getDashboardRouteForRole } from '../utils/roleRedirect'
import { AdminHeader } from '../components/admin/ui'
import { Tabs, TabPanel, type TabItem } from '../components/admin/Tabs'
import { useResource } from '../components/admin/useResource'
import { useReview, type ReviewArea } from '../components/admin/useReview'
import { TaskQueue } from '../components/admin/approvals/TaskQueue'
import { AttendanceQueue } from '../components/admin/approvals/AttendanceQueue'
import { reviewableRecords } from '../components/admin/approvals/helpers'
import { LeaveQueue } from '../components/admin/approvals/LeaveQueue'
import { CorrectionQueue } from '../components/admin/approvals/CorrectionQueue'
import { PostQueue } from '../components/admin/approvals/PostQueue'

type Tab = ReviewArea
const TAB_KEYS: Tab[] = ['tasks', 'attendance', 'leave', 'corrections', 'posts']
const TASK_PAGE = 20

// Team leaders and admins: everything waiting for their decision in one place.
// Anyone else is sent to their own home.
export default function Approvals() {
  const { user, isAdmin, isTeamLeader } = useAuth()
  if (!isAdmin && !isTeamLeader) return <Navigate to={getDashboardRouteForRole(user?.role)} replace />
  return <Inbox home={getDashboardRouteForRole(user?.role)} />
}

function Inbox({ home }: { home: string }) {
  const [params, setParams] = useSearchParams()
  const [taskPage, setTaskPage] = useState(1)

  const tab: Tab = TAB_KEYS.find((key) => key === params.get('tab')) ?? 'tasks'
  const setTab = (next: Tab) =>
    setParams(
      (previous) => {
        const copy = new URLSearchParams(previous)
        if (next === 'tasks') copy.delete('tab')
        else copy.set('tab', next)
        return copy
      },
      { replace: true },
    )

  // Each list loads on its own, so one failing leaves the others usable
  const tasks = useResource(useCallback((signal: AbortSignal) => adminAPI.getTasksToReview({ page: taskPage, limit: TASK_PAGE }, { signal }), [taskPage]))
  const attendance = useResource(
    useCallback((signal: AbortSignal) => adminAPI.getAttendance({ approvalStatus: 'pending', reviewable: true, page: 1, limit: 200 }, { signal }), []),
  )
  const leave = useResource(useCallback((signal: AbortSignal) => adminAPI.getLeaveRequests({ status: 'pending', page: 1, limit: 100 }, { signal }), []))
  const corrections = useResource(
    useCallback((signal: AbortSignal) => adminAPI.getAttendance({ hasCorrection: true, reviewable: true, page: 1, limit: 100 }, { signal }), []),
  )
  const posts = useResource(useCallback((signal: AbortSignal) => adminAPI.getPostsToApprove({ signal }), []))

  // After a decision only the list it came from is loaded again
  const reloadTasks = tasks.reload
  const reloadAttendance = attendance.reload
  const reloadLeave = leave.reload
  const reloadCorrections = corrections.reload
  const reloadPosts = posts.reload
  const reload = useCallback(
    (area: ReviewArea) => {
      if (area === 'tasks') reloadTasks()
      if (area === 'attendance') reloadAttendance()
      if (area === 'leave') reloadLeave()
      if (area === 'corrections') {
        reloadCorrections()
        // An applied correction can change the record waiting in Attendance too
        reloadAttendance()
      }
      if (area === 'posts') reloadPosts()
    },
    [reloadTasks, reloadAttendance, reloadLeave, reloadCorrections, reloadPosts],
  )
  const review = useReview(reload)

  const counts: Record<Tab, number | null> = {
    tasks: tasks.data ? tasks.data.pagination?.total ?? tasks.data.data.length : null,
    attendance: attendance.data ? reviewableRecords(attendance.data).length : null,
    leave: leave.data ? leave.data.pagination?.total ?? leave.data.data.length : null,
    corrections: corrections.data ? corrections.data.data.length : null,
    posts: posts.data ? posts.data.length : null,
  }

  const tabs: TabItem<Tab>[] = [
    { key: 'tasks', label: 'Tasks', count: counts.tasks },
    { key: 'attendance', label: 'Attendance', count: counts.attendance },
    { key: 'leave', label: 'Leave', count: counts.leave },
    { key: 'corrections', label: 'Corrections', count: counts.corrections },
    { key: 'posts', label: 'Posts', count: counts.posts },
  ]

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <AdminHeader
        title="Approvals"
        subtitle="Everything that is waiting for your decision."
        back={{ to: home, label: 'Back to dashboard' }}
      />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Tabs id="approvals" label="What is waiting" tabs={tabs} value={tab} onChange={setTab} />
        <TabPanel id="approvals" active={tab}>
          {tab === 'tasks' && <TaskQueue resource={tasks} review={review} page={taskPage} onPage={setTaskPage} />}
          {tab === 'attendance' && <AttendanceQueue resource={attendance} review={review} />}
          {tab === 'leave' && <LeaveQueue resource={leave} review={review} />}
          {tab === 'corrections' && <CorrectionQueue resource={corrections} review={review} />}
          {tab === 'posts' && <PostQueue resource={posts} review={review} />}
        </TabPanel>
      </div>
    </div>
  )
}
