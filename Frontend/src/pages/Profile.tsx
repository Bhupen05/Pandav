import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { userAPI } from '../api/userAPI'
import { taskAPI } from '../api/taskAPI'

type DayEntry = {
  date: string // ISO yyyy-mm-dd
  count: number
}

const COLOR_SCALE = [
  'bg-neutral-200',
  // 'bg-emerald-100',
  // 'bg-emerald-200',  
  // 'bg-emerald-300',
  'bg-emerald-400',
  'bg-emerald-500',
]

function colorForCount(count: number) {
  if (count === 0) return COLOR_SCALE[0]
  if (count >= 8) return COLOR_SCALE[5]
  if (count >= 5) return COLOR_SCALE[4]
  if (count >= 3) return COLOR_SCALE[3]
  if (count >= 2) return COLOR_SCALE[2]
  return COLOR_SCALE[1]
}

function generateMockData(days = 120): DayEntry[] {
  const today = new Date()
  const entries: DayEntry[] = []
  for (let i = days; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const count = Math.max(0, Math.round(Math.random() * 5 - 1)) // skew a bit to sparse
    entries.push({ date: iso, count })
  }
  return entries
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
  let best = 0
  let current = 0
  let max = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].count > 0) {
      current += 1
      if (current > max) max = current
    } else {
      current = 0
    }
  }
  best = max
  return { current, best }
}

const dayLabels = ['Sun', 'Tue', 'Thu']

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
  const { weeks, today } = buildCalendar(activityData)
  const { current, best } = streaks(activityData)
  const total = activityData.reduce((sum, d) => sum + d.count, 0)

  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [profile, setProfile] = useState<UserProfile>({
    name: user?.name || 'User',
    email: user?.email || '',
    phone: user?.phone || '',
    role: user?.role || 'User',
    joinedDate: user?.createdAt || new Date().toISOString(),
    profileImage: user?.profileImage || '',
  })

  const [editedProfile, setEditedProfile] = useState<UserProfile>(profile)

  // Load user profile and activity data
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
      loadActivityData()
    }
  }, [user])

  // Load activity data from tasks
  const loadActivityData = async () => {
    if (!user?._id) return
    
    setLoadingActivity(true)
    try {
      const filters = { assignedTo: user._id }
      const response = await taskAPI.getTasks(filters)
      
      if (response.success && Array.isArray(response.data)) {
        // Generate activity data from completed tasks
        const activityMap = new Map<string, number>()
        
        response.data.forEach((task: any) => {
          if (task.status === 'completed' && task.updatedAt) {
            const date = new Date(task.updatedAt).toISOString().slice(0, 10)
            activityMap.set(date, (activityMap.get(date) || 0) + 1)
          }
        })
        
        // Fill in the last 140 days with activity data
        const today = new Date()
        const entries: DayEntry[] = []
        for (let i = 140; i >= 0; i--) {
          const d = new Date(today)
          d.setDate(today.getDate() - i)
          const iso = d.toISOString().slice(0, 10)
          entries.push({ date: iso, count: activityMap.get(iso) || 0 })
        }
        
        setActivityData(entries)
      } else {
        // Fallback to empty data if no tasks
        setActivityData(generateMockData(140).map(d => ({ ...d, count: 0 })))
      }
    } catch (error) {
      console.error('Failed to load activity data:', error)
      // Fallback to empty data on error
      setActivityData(generateMockData(140).map(d => ({ ...d, count: 0 })))
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    console.log('Image file selected:', file.name, 'Size:', file.size, 'bytes');

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB')
      return
    }

    setUploadingImage(true)
    try {
      // Convert to base64
      const reader = new FileReader()
      reader.onloadend = async () => {
        const base64String = reader.result as string
        console.log('Image converted to base64, length:', base64String.length);
        
        if (!user?._id) return

        try {
          console.log('Uploading image to backend...');
          const response = await userAPI.updateUser(user._id, {
            profileImage: base64String,
          })

          console.log('Upload response:', response);

          if (response.success) {
            const updatedProfile = { ...profile, profileImage: base64String }
            setProfile(updatedProfile)
            setEditedProfile(updatedProfile)
            if (updateUser) {
              updateUser({ ...user, profileImage: base64String })
            }
            alert('Profile picture updated successfully!')
          } else {
            alert(response.message || 'Failed to update profile picture')
          }
        } catch (error: any) {
          console.error('Error uploading image:', error)
          alert(error.response?.data?.message || 'Failed to upload image')
        } finally {
          setUploadingImage(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (error) {
      setUploadingImage(false)
      alert('Failed to process image')
    }
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
        // Update the user in AuthContext
        if (updateUser) {
          updateUser({
            ...user,
            name: editedProfile.name,
            email: editedProfile.email,
            phone: editedProfile.phone,
          })
        }
        alert('Profile updated successfully!')
      } else {
        alert(response.message || 'Failed to update profile')
      }
    } catch (error: any) {
      console.error('Error updating profile:', error)
      alert(error.response?.data?.message || 'Failed to update profile. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Profile</h1>
        <p className="text-sm text-neutral-600">Manage your account information and view your activity.</p>
      </header>

      {/* Profile Information Section */}
      <section className="mb-6 rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Personal Information</h2>
          {!isEditing ? (
            <button
              onClick={handleEdit}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="relative">
                {profile.profileImage ? (
                  <img
                    src={profile.profileImage}
                    alt={profile.name}
                    className="h-20 w-20 rounded-full object-cover"
                    onError={(e) => {
                      console.error('Failed to load profile image');
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling;
                      if (fallback) fallback.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div className={`flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-700 ${profile.profileImage ? 'hidden' : ''}`}>
                  {profile.name.split(' ').map(n => n[0]).join('')}
                </div>
                <label
                  htmlFor="profile-image"
                  className="absolute bottom-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  title="Change profile picture"
                >
                  {uploadingImage ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </label>
                <input
                  id="profile-image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={uploadingImage}
                  className="hidden"
                />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-neutral-900">{profile.name}</h3>
                <p className="text-sm text-neutral-600">{profile.role}</p>
                <p className="mt-1 text-xs text-neutral-500">Joined {new Date(profile.joinedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-neutral-600">Email Address</label>
                <p className="mt-1 text-sm text-neutral-900">{profile.email}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600">Phone Number</label>
                <p className="mt-1 text-sm text-neutral-900">{profile.phone}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-neutral-800">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={editedProfile.name}
                onChange={(e) => setEditedProfile({ ...editedProfile, name: e.target.value })}
                className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-800">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={editedProfile.email}
                  onChange={(e) => setEditedProfile({ ...editedProfile, email: e.target.value })}
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  required
                />
              </div>
              <div>
                <label htmlFor="phone" className="mb-1 block text-sm font-medium text-neutral-800">
                  Phone Number
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={editedProfile.phone}
                  onChange={(e) => setEditedProfile({ ...editedProfile, phone: e.target.value })}
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="role" className="mb-1 block text-sm font-medium text-neutral-800">
                Role
              </label>
              <input
                id="role"
                type="text"
                value={editedProfile.role}
                onChange={(e) => setEditedProfile({ ...editedProfile, role: e.target.value })}
                className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
            </div>
          </div>
        )}
      </section>

      {/* Activity Stats */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">Activity Overview</h2>
        <p className="text-sm text-neutral-600">Track your contributions and engagement.</p>
      </div>

      {loadingActivity ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
        </div>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-neutral-600">Total entries</p>
              <p className="text-xl font-semibold text-neutral-900">{total}</p>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-neutral-600">Current streak</p>
              <p className="text-xl font-semibold text-neutral-900">{current} days</p>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-neutral-600">Best streak</p>
              <p className="text-xl font-semibold text-neutral-900">{best} days</p>
            </div>
          </section>

          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">Contributions</h2>
                <p className="text-xs text-neutral-500">Last updated {today.toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <span>Less</span>
                {COLOR_SCALE.map((c, idx) => (
                  <span key={idx} className={`h-3 w-3 rounded-sm ${c}`}></span>
                ))}
                <span>More</span>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2">
              <div className="mt-5 flex w-10 flex-col gap-6 text-[11px] text-neutral-500">
                {dayLabels.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="flex gap-1">
                {weeks.map((week, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    {week.map((day) => (
                      <div
                        key={day.date}
                        className={`h-3.5 w-3.5 rounded-sm ${colorForCount(day.count)} border border-neutral-200/60`}
                        title={`${day.date}: ${day.count} entries`}
                      ></div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
