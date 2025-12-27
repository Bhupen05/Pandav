import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { userAPI } from '../api/userAPI'
import { taskAPI } from '../api/taskAPI'
import { attendanceAPI } from '../api/attendanceAPI'

type DayEntry = {
  date: string
  count: number
}

type TaskStats = {
  total: number
  completed: number
  inProgress: number
  pending: number
}

type AttendanceStats = {
  totalDays: number
  presentDays: number
  avgWorkHours: number
}

const COLOR_SCALE = [
  'bg-neutral-200',
  'bg-emerald-500',
  'bg-emerald-300',
  'bg-emerald-400',
  'bg-emerald-500',
  'bg-emerald-600',
]

function colorForCount(count: number) {
  if (count === 0) return COLOR_SCALE[0]
  if (count >= 5) return COLOR_SCALE[5]
  if (count >= 4) return COLOR_SCALE[4]
  if (count >= 3) return COLOR_SCALE[3]
  if (count >= 2) return COLOR_SCALE[2]
  return COLOR_SCALE[1]
}

function alignToSunday(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d
}

function buildCalendar(entries: DayEntry[]) {
  const map = new Map(entries.map((e) => [e.date, e.count]))
  const today = new Date()
  const start = alignToSunday(new Date(today.getFullYear(), today.getMonth(), today.getDate() - entries.length))
  const cells: DayEntry[] = []
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    cells.push({ date: iso, count: map.get(iso) ?? 0 })
  }
  const weeks: DayEntry[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return { weeks, today }
}

function streaks(entries: DayEntry[]) {
  let max = 0
  let temp = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].count > 0) {
      temp += 1
      if (temp > max) max = temp
    } else {
      temp = 0
    }
  }

  // Calculate current streak from today backwards
  let current = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].count > 0) current += 1
    else break
  }
  return { current, best: max }
}

const dayLabels = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat']

type UserProfile = {
  name: string
  email: string
  phone: string
  role: string
  joinedDate: string
  profileImage?: string
}

export default function Profile() {
  const { user, updateUser } = useAuth()
  const [activityData, setActivityData] = useState<DayEntry[]>([])
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [taskStats, setTaskStats] = useState<TaskStats>({ total: 0, completed: 0, inProgress: 0, pending: 0 })
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats>({ totalDays: 0, presentDays: 0, avgWorkHours: 0 })
  
  const { weeks } = buildCalendar(activityData)
  const { current, best } = streaks(activityData)
  const total = activityData.reduce((sum, d) => sum + d.count, 0)

  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showImagePreview, setShowImagePreview] = useState(false)
  const [profile, setProfile] = useState<UserProfile>({
    name: user?.name || 'User',
    email: user?.email || '',
    phone: user?.phone || '',
    role: user?.role || 'User',
    joinedDate: user?.createdAt || new Date().toISOString(),
    profileImage: user?.profileImage || '',
  })

  const [editedProfile, setEditedProfile] = useState<UserProfile>(profile)

  useEffect(() => {
    if (user) {
      const userProfile: UserProfile = {
        name: user.name || 'User',
        email: user.email || '',
        phone: user.phone || '',
        role: user.role || 'User',
        joinedDate: user.createdAt || new Date().toISOString(),
        profileImage: user.profileImage || '',
      }
      setProfile(userProfile)
      setEditedProfile(userProfile)
      loadAllData()
    }
  }, [user])

  const loadAllData = async () => {
    if (!user?._id) return
    setLoadingActivity(true)
    
    try {
      // Activity map to track all activities by date
      const activityMap = new Map<string, number>()
      
      // Load tasks
      const taskResponse = await taskAPI.getTasks({ assignedTo: user._id })
      if (taskResponse.success && Array.isArray(taskResponse.data)) {
        const tasks = taskResponse.data
        
        // Calculate task stats
        setTaskStats({
          total: tasks.length,
          completed: tasks.filter((t: any) => t.status === 'completed').length,
          inProgress: tasks.filter((t: any) => t.status === 'in-progress').length,
          pending: tasks.filter((t: any) => t.status === 'pending').length,
        })
        
        // Count activities from tasks: completed, completion-requested, or any status change
        tasks.forEach((task: any) => {
          // Count completed tasks
          if ((task.status === 'completed' || task.status === 'completion-requested') && task.updatedAt) {
            const date = new Date(task.updatedAt).toISOString().slice(0, 10)
            activityMap.set(date, (activityMap.get(date) || 0) + 1)
          }
          // Also count task creation as activity
          if (task.createdAt) {
            const date = new Date(task.createdAt).toISOString().slice(0, 10)
            activityMap.set(date, (activityMap.get(date) || 0) + 1)
          }
        })
      }

      // Load attendance and add to activity
      try {
        const attendanceResponse = await attendanceAPI.getAttendance()
        if (attendanceResponse.success && Array.isArray(attendanceResponse.data)) {
          const records = attendanceResponse.data
          const approvedRecords = records.filter((r: any) => r.status === 'approved')
          const totalHours = approvedRecords.reduce((sum: number, r: any) => sum + (r.totalHours || 0), 0)
          
          setAttendanceStats({
            totalDays: records.length,
            presentDays: approvedRecords.length,
            avgWorkHours: approvedRecords.length > 0 ? Math.round((totalHours / approvedRecords.length) * 10) / 10 : 0,
          })
          
          // Add attendance check-ins to activity map
          records.forEach((record: any) => {
            if (record.date || record.checkIn) {
              const dateStr = record.date 
                ? new Date(record.date).toISOString().slice(0, 10)
                : new Date(record.checkIn).toISOString().slice(0, 10)
              activityMap.set(dateStr, (activityMap.get(dateStr) || 0) + 1)
            }
          })
        }
      } catch (err) {
        console.error('Failed to load attendance:', err)
      }
      
      // Fill in the last 120 days
      const todayDate = new Date()
      const entries: DayEntry[] = []
      for (let i = 120; i >= 0; i--) {
        const d = new Date(todayDate)
        d.setDate(todayDate.getDate() - i)
        const iso = d.toISOString().slice(0, 10)
        entries.push({ date: iso, count: activityMap.get(iso) || 0 })
      }
      setActivityData(entries)
      
    } catch (error) {
      console.error('Failed to load data:', error)
      const todayDate = new Date()
      const entries: DayEntry[] = []
      for (let i = 120; i >= 0; i--) {
        const d = new Date(todayDate)
        d.setDate(todayDate.getDate() - i)
        entries.push({ date: d.toISOString().slice(0, 10), count: 0 })
      }
      setActivityData(entries)
    } finally {
      setLoadingActivity(false)
    }
  }

  const handleEdit = () => {
    setEditedProfile(profile)
    setIsEditing(true)
  }

  const handleCancel = () => {
    setEditedProfile(profile)
    setIsEditing(false)
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result as string
      setPreviewImage(base64String)
      setShowImagePreview(true)
    }
    reader.readAsDataURL(file)
  }

  const handleImageConfirm = async () => {
    if (!previewImage || !user?._id) return

    setUploadingImage(true)
    try {
      const response = await userAPI.updateUser(user._id, { profileImage: previewImage })
      if (response.success) {
        const updatedProfile = { ...profile, profileImage: previewImage }
        setProfile(updatedProfile)
        setEditedProfile(updatedProfile)
        if (updateUser) {
          updateUser({ ...user, profileImage: previewImage })
        }
        setShowImagePreview(false)
        setPreviewImage(null)
      } else {
        alert(response.message || 'Failed to update profile picture')
      }
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to upload image')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleImageCancel = () => {
    setPreviewImage(null)
    setShowImagePreview(false)
  }

  const handleSave = async () => {
    if (!user?._id) {
      alert('User not found')
      return
    }

    setLoading(true)
    try {
      const response = await userAPI.updateUser(user._id, {
        name: editedProfile.name,
        email: editedProfile.email,
        phone: editedProfile.phone,
      })

      if (response.success) {
        setProfile(editedProfile)
        setIsEditing(false)
        if (updateUser) {
          updateUser({
            ...user,
            name: editedProfile.name,
            email: editedProfile.email,
            phone: editedProfile.phone,
          })
        }
      } else {
        alert(response.message || 'Failed to update profile')
      }
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const completionRate = taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0
  const memberSince = new Date(profile.joinedDate)
  const daysAsMember = Math.floor((new Date().getTime() - memberSince.getTime()) / (1000 * 60 * 60 * 24))

  return (
    <main className="min-h-screen bg-neutral-50">
      {/* Hero Header */}
      <div className="bg-linear-to-r from-emerald-600 to-teal-600">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
            {/* Profile Picture */}
            <div className="relative">
              {profile.profileImage ? (
                <img
                  src={profile.profileImage}
                  alt={profile.name}
                  className="h-28 w-28 rounded-full border-4 border-white object-cover shadow-lg"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                    const fallback = e.currentTarget.nextElementSibling
                    if (fallback) fallback.classList.remove('hidden')
                  }}
                />
              ) : null}
              <div className={`flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-white text-3xl font-bold text-emerald-600 shadow-lg ${profile.profileImage ? 'hidden' : ''}`}>
                {profile.name.split(' ').map(n => n[0]).join('').toUpperCase()}
              </div>
              <label
                htmlFor="profile-image"
                className="absolute bottom-1 right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white text-emerald-600 shadow-md hover:bg-emerald-50 transition-colors"
              >
                {uploadingImage ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </label>
              <input id="profile-image" type="file" accept="image/*" onChange={handleImageSelect} disabled={uploadingImage} className="hidden" />
            </div>

            {/* User Info */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-2xl font-bold text-white md:text-3xl">{profile.name}</h1>
              <p className="mt-1 text-emerald-100">{profile.email}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                  👤 {profile.role}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                  📅 {daysAsMember} days
                </span>
                {profile.phone && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                    📞 {profile.phone}
                  </span>
                )}
              </div>
            </div>

            {/* Edit Button */}
            <button
              onClick={isEditing ? handleCancel : handleEdit}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              {isEditing ? 'Cancel' : 'Edit Profile'}
            </button>
          </div>
        </div>
      </div>

      {/* Image Preview Modal */}
      {showImagePreview && previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-neutral-900">Update Profile Picture</h3>
            
            <div className="mb-6 grid grid-cols-2 gap-4">
              {/* Current Image */}
              <div className="text-center">
                <p className="mb-2 text-sm font-medium text-neutral-500">Current</p>
                <div className="mx-auto h-32 w-32 overflow-hidden rounded-full border-2 border-neutral-200">
                  {profile.profileImage ? (
                    <img src={profile.profileImage} alt="Current" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-emerald-100 text-2xl font-bold text-emerald-600">
                      {profile.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Arrow */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block">
              </div>
              
              {/* New Image */}
              <div className="text-center">
                <p className="mb-2 text-sm font-medium text-emerald-600">New</p>
                <div className="mx-auto h-32 w-32 overflow-hidden rounded-full border-2 border-emerald-500">
                  <img src={previewImage} alt="New" className="h-full w-full object-cover" />
                </div>
              </div>
            </div>
            
            {/* Arrow between images */}
            <div className="mb-4 flex justify-center">
              <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleImageCancel}
                className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImageConfirm}
                disabled={uploadingImage}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {uploadingImage ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Saving...
                  </span>
                ) : (
                  'Confirm Change'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Edit Form */}
        {isEditing && (
          <section className="mb-6 rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-neutral-900">Edit Profile</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">Full Name</label>
                <input
                  type="text"
                  value={editedProfile.name}
                  onChange={(e) => setEditedProfile({ ...editedProfile, name: e.target.value })}
                  className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">Email</label>
                  <input
                    type="email"
                    value={editedProfile.email}
                    onChange={(e) => setEditedProfile({ ...editedProfile, email: e.target.value })}
                    className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">Phone</label>
                  <input
                    type="tel"
                    value={editedProfile.phone}
                    onChange={(e) => setEditedProfile({ ...editedProfile, phone: e.target.value })}
                    className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={handleCancel} className="rounded-lg border px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Stats Grid */}
        <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-xl">📋</div>
              <div>
                <p className="text-2xl font-bold text-neutral-900">{taskStats.total}</p>
                <p className="text-xs text-neutral-500">Total Tasks</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-xl">✅</div>
              <div>
                <p className="text-2xl font-bold text-neutral-900">{completionRate}%</p>
                <p className="text-xs text-neutral-500">Completion</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-xl">⏱️</div>
              <div>
                <p className="text-2xl font-bold text-neutral-900">{attendanceStats.avgWorkHours}h</p>
                <p className="text-xs text-neutral-500">Avg Hours</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-xl">🔥</div>
              <div>
                <p className="text-2xl font-bold text-neutral-900">{current}</p>
                <p className="text-xs text-neutral-500">Day Streak</p>
              </div>
            </div>
          </div>
        </section>

        {/* Task Progress Bar */}
        <section className="mb-6 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">Task Progress</h2>
          <div className="mb-4 h-3 overflow-hidden rounded-full bg-neutral-100">
            <div className="flex h-full">
              <div className="bg-emerald-500 transition-all" style={{ width: `${taskStats.total > 0 ? (taskStats.completed / taskStats.total) * 100 : 0}%` }}></div>
              <div className="bg-blue-500 transition-all" style={{ width: `${taskStats.total > 0 ? (taskStats.inProgress / taskStats.total) * 100 : 0}%` }}></div>
              <div className="bg-amber-500 transition-all" style={{ width: `${taskStats.total > 0 ? (taskStats.pending / taskStats.total) * 100 : 0}%` }}></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500"></span>
              <span className="text-neutral-600">Completed ({taskStats.completed})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-blue-500"></span>
              <span className="text-neutral-600">In Progress ({taskStats.inProgress})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-amber-500"></span>
              <span className="text-neutral-600">Pending ({taskStats.pending})</span>
            </div>
          </div>
        </section>

        {/* Activity Heatmap */}
        {loadingActivity ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
          </div>
        ) : (
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">Activity</h2>
                <p className="text-sm text-neutral-500">{total} activities in the last 120 days</p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <p className="text-xl font-bold text-emerald-600">{current}</p>
                  <p className="text-xs text-neutral-500">Current</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-amber-600">{best}</p>
                  <p className="text-xs text-neutral-500">Best</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="flex gap-1">
                <div className="flex w-8 flex-col gap-0.75 text-[10px] text-neutral-400">
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
                          title={`${day.date}: ${day.count} activity${day.count !== 1 ? '' : ''}`}
                        ></div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* <div className="mt-4 flex items-center justify-end gap-1 text-xs text-neutral-500">
              <span>Less</span>
              {COLOR_SCALE.map((c, i) => (
                <span key={i} className={`h-3.25 w-3.25 rounded-sm ${c}`}></span>
              ))}
              <span>More</span>
            </div> */}
          </section>
        )}
      </div>
    </main>
  )
}
