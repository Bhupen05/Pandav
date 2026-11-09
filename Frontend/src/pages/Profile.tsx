import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { authAPI } from '../api/authAPI'
import { getErrorMessage } from '../api/axios'
import { userAPI } from '../api/userAPI'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import { resizeImage } from '../utils/resizeImage'
import { getRoleLabel } from '../utils/roleRedirect'
import { useAuthConfig } from '../utils/useAuthConfig'
import Avatar from '../components/shell/Avatar'
import ProfileActivity from '../components/shell/ProfileActivity'
import ProfileSecurity from '../components/shell/ProfileSecurity'
import { errorBoxClass, infoBoxClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from '../components/shell/formStyles'

type TabId = 'overview' | 'security' | 'notifications'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
]

// The new photo next to the current one, before it is saved. Native <dialog>:
// Escape cancels and focus stays inside.
function PhotoDialog({
  name,
  currentImage,
  newImage,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string
  currentImage?: string
  newImage: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = ref.current
    if (element && !element.open) element.showModal()
    return () => {
      if (element?.open) element.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="photo-dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl bg-white p-6 shadow-xl backdrop:bg-black/50"
    >
      <h2 id="photo-dialog-title" className="mb-4 text-lg font-semibold text-neutral-900">Update Profile Picture</h2>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="mb-2 text-sm font-medium text-neutral-500">Current</p>
          <Avatar name={name} src={currentImage} className="mx-auto h-28 w-28 border-2 border-neutral-200 text-2xl" />
        </div>
        <div className="text-center">
          <p className="mb-2 text-sm font-medium text-emerald-700">New</p>
          <img src={newImage} alt="Your new profile picture" className="mx-auto h-28 w-28 rounded-full border-2 border-emerald-500 object-cover" />
        </div>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className={`flex-1 ${secondaryButtonClass}`}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} className={`flex-1 ${primaryButtonClass}`}>
          {busy ? 'Saving...' : 'Confirm Change'}
        </button>
      </div>
    </dialog>
  )
}

// The switch for emails about notifications (the notifications tab)
function NotificationSettings() {
  const { user, updateUser } = useAuth()
  const { notify } = useFeedback()
  const { mailEnabled, ready } = useAuthConfig()
  const [busy, setBusy] = useState(false)

  if (!user) return null
  const on = user.emailNotifications

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      await userAPI.updateUser(user._id, { emailNotifications: !on })
      updateUser({ ...user, emailNotifications: !on })
      notify(!on ? 'We will email you about important notifications.' : 'Email notifications are off.', 'success')
    } catch (err) {
      notify(getErrorMessage(err, 'Could not save that. Please try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="email-notifications-title" className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 id="email-notifications-title" className="text-lg font-semibold text-neutral-900">Email</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Notifications always show up in the app. Some of them, such as a task given to you or a team invite, can also be sent to {user.email}.
      </p>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-neutral-200 px-4 py-3">
        <span id="email-notifications-label" className="text-sm font-medium text-neutral-900">Email me about important notifications</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="email-notifications-label"
          onClick={() => void toggle()}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-600' : 'bg-neutral-300'}`}
        >
          <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {ready && !mailEnabled && (
        <p className="mt-3 text-sm text-neutral-600">Email is not set up on this server yet, so no emails are sent for now.</p>
      )}
    </section>
  )
}

export default function Profile() {
  const { notify, confirm } = useFeedback()
  const { user, updateUser } = useAuth()
  const { mailEnabled } = useAuthConfig()
  const [params, setParams] = useSearchParams()

  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', department: '', currentPassword: '' })
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ overview: null, security: null, notifications: null })

  const forced = user?.mustChangePassword === true
  const requested = params.get('tab')
  // Until a new password is chosen, only the security tab is available
  const tab: TabId = forced ? 'security' : TABS.some((t) => t.id === requested) ? (requested as TabId) : 'overview'

  if (!user) return null

  const emailChanged = form.email.trim().toLowerCase() !== user.email.toLowerCase()
  const memberDays = user.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86_400_000)) : null

  const selectTab = (id: TabId) => setParams({ tab: id })

  // Arrow keys, Home and End move between tabs
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = forced ? TABS.filter((t) => t.id === 'security') : TABS
    const position = enabled.findIndex((t) => t.id === TABS[index].id)
    let target: number | null = null
    if (e.key === 'ArrowRight') target = (position + 1) % enabled.length
    else if (e.key === 'ArrowLeft') target = (position - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') target = 0
    else if (e.key === 'End') target = enabled.length - 1
    if (target === null) return
    e.preventDefault()
    const next = enabled[target].id
    selectTab(next)
    tabRefs.current[next]?.focus()
  }

  const startEditing = () => {
    setForm({
      name: user.name,
      email: user.email,
      phone: user.phone ?? '',
      department: user.department ?? '',
      currentPassword: '',
    })
    setFormError(null)
    setIsEditing(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setFormError(null)

    if (!form.name.trim()) {
      setFormError('Please enter your name.')
      return
    }
    if (emailChanged && !form.currentPassword) {
      setFormError('Enter your current password to change your email address.')
      return
    }

    setSaving(true)
    try {
      const response = await userAPI.updateUser(user._id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        department: form.department.trim(),
        ...(emailChanged ? { email: form.email.trim(), currentPassword: form.currentPassword } : {}),
      })
      const saved = response.data ?? {}
      updateUser({
        ...user,
        name: saved.name ?? form.name.trim(),
        email: saved.email ?? user.email,
        phone: saved.phone,
        department: saved.department,
        emailVerified: typeof saved.emailVerified === 'boolean' ? saved.emailVerified : user.emailVerified,
      })
      setIsEditing(false)
      notify(
        emailChanged && mailEnabled ? 'Profile saved. We sent a link to confirm your new email address.' : 'Profile saved.',
        'success',
      )
    } catch (err) {
      setFormError(getErrorMessage(err, 'Could not save your profile. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    // Forget the choice, so picking the same file again still counts as a change
    input.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      notify('Please choose an image file.', 'error')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      notify('Images must be smaller than 5 MB.', 'error')
      return
    }

    try {
      setPreviewImage(await resizeImage(file))
    } catch {
      notify('Could not read that image. Please try another file.', 'error')
    }
  }

  const handleImageConfirm = async () => {
    if (!previewImage) return
    setPhotoBusy(true)
    try {
      await userAPI.updateUser(user._id, { profileImage: previewImage })
      updateUser({ ...user, profileImage: previewImage })
      setPreviewImage(null)
      notify('Profile photo updated.', 'success')
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to upload image'), 'error')
    } finally {
      setPhotoBusy(false)
    }
  }

  const handleImageRemove = async () => {
    const ok = await confirm({
      title: 'Remove your photo?',
      message: 'Your initials will show instead.',
      confirmLabel: 'Remove photo',
      danger: true,
    })
    if (!ok) return
    setPhotoBusy(true)
    try {
      await userAPI.updateUser(user._id, { profileImage: null })
      updateUser({ ...user, profileImage: undefined })
      notify('Profile photo removed.', 'success')
    } catch (err) {
      notify(getErrorMessage(err, 'Could not remove your photo. Please try again.'), 'error')
    } finally {
      setPhotoBusy(false)
    }
  }

  const resendVerification = async () => {
    setResending(true)
    try {
      notify((await authAPI.resendVerification()) ?? 'We have sent you a new link.', 'success')
    } catch (err) {
      notify(getErrorMessage(err, 'Could not send the link. Please try again.'), 'error')
    } finally {
      setResending(false)
    }
  }

  const showVerification = user.emailVerified || mailEnabled

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Hero Header */}
      <div className="bg-linear-to-r from-emerald-600 to-teal-600">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
            {/* Profile Picture */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                <Avatar name={user.name} src={user.profileImage} className="h-28 w-28 border-4 border-white text-3xl shadow-lg" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                  aria-label="Change profile photo"
                  className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-emerald-700 shadow-md transition-colors hover:bg-emerald-50 disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              </div>
              {user.profileImage && (
                <button
                  type="button"
                  onClick={() => void handleImageRemove()}
                  disabled={photoBusy}
                  className="rounded text-xs font-medium text-white underline hover:text-emerald-50 disabled:opacity-50"
                >
                  Remove photo
                </button>
              )}
            </div>

            {/* User Info */}
            <div className="min-w-0 flex-1 text-center md:text-left">
              <h1 className="break-words text-2xl font-bold text-white md:text-3xl">{user.name}</h1>
              <p className="mt-1 break-all text-emerald-50">{user.email}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                  <span aria-hidden="true">👤</span> {getRoleLabel(user.role)}
                </span>
                {memberDays !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                    <span aria-hidden="true">📅</span> Member for {memberDays} {memberDays === 1 ? 'day' : 'days'}
                  </span>
                )}
                {user.phone && (
                  <span className="inline-flex max-w-full items-center gap-1 break-all rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                    <span aria-hidden="true">📞</span> {user.phone}
                  </span>
                )}
                {user.department && (
                  <span className="inline-flex max-w-full items-center gap-1 break-words rounded-full bg-white/20 px-3 py-1 text-sm text-white">
                    <span aria-hidden="true">🏢</span> {user.department}
                  </span>
                )}
                {showVerification && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${user.emailVerified ? 'bg-white text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                    {user.emailVerified ? 'Email verified' : 'Email not verified'}
                  </span>
                )}
                {!user.emailVerified && mailEnabled && (
                  <button
                    type="button"
                    onClick={() => void resendVerification()}
                    disabled={resending}
                    className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {resending ? 'Sending...' : 'Send the link again'}
                  </button>
                )}
              </div>
            </div>

            {/* Edit Button */}
            {tab === 'overview' && (
              <button
                type="button"
                onClick={isEditing ? () => setIsEditing(false) : startEditing}
                aria-expanded={isEditing}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
              >
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </button>
            )}
          </div>
        </div>
      </div>

      {previewImage && (
        <PhotoDialog
          name={user.name}
          currentImage={user.profileImage}
          newImage={previewImage}
          busy={photoBusy}
          onConfirm={() => void handleImageConfirm()}
          onCancel={() => setPreviewImage(null)}
        />
      )}

      <div className="mx-auto max-w-6xl px-4 py-6">
        {forced && (
          <div role="alert" className={`mb-6 ${infoBoxClass}`}>
            <strong>Choose a new password to continue.</strong> An admin reset your password. Until you choose your own, this is the only page you can use.
          </div>
        )}

        {/* Tabs, kept in the address (?tab=...) */}
        <div role="tablist" aria-label="Profile sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-neutral-200">
          {TABS.map((t, index) => {
            const selected = tab === t.id
            const disabled = forced && t.id !== 'security'
            return (
              <button
                key={t.id}
                ref={(element) => {
                  tabRefs.current[t.id] = element
                }}
                type="button"
                role="tab"
                id={`profile-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`profile-panel-${t.id}`}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(t.id)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {tab === 'overview' && (
          <div role="tabpanel" id="profile-panel-overview" aria-labelledby="profile-tab-overview">
            {/* Edit Form */}
            {isEditing && (
              <form onSubmit={handleSave} aria-labelledby="edit-profile-title" className="mb-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
                <h2 id="edit-profile-title" className="mb-4 text-lg font-semibold text-neutral-900">Edit Profile</h2>
                <div className="space-y-4">
                  {formError && <div role="alert" className={errorBoxClass}>{formError}</div>}

                  <div>
                    <label htmlFor="profile-name" className={labelClass}>Full Name</label>
                    <input
                      id="profile-name"
                      type="text"
                      autoComplete="name"
                      autoFocus
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="profile-email" className={labelClass}>Email</label>
                      <input
                        id="profile-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="profile-phone" className={labelClass}>Phone</label>
                      <input
                        id="profile-phone"
                        type="tel"
                        autoComplete="tel"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="profile-department" className={labelClass}>Department</label>
                    <input
                      id="profile-department"
                      type="text"
                      autoComplete="organization-title"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className={inputClass}
                    />
                  </div>

                  {emailChanged && (
                    <div className="max-w-md">
                      <label htmlFor="profile-current-password" className={labelClass}>Current password</label>
                      <input
                        id="profile-current-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        aria-describedby="profile-current-password-hint"
                        value={form.currentPassword}
                        onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                        className={inputClass}
                      />
                      <p id="profile-current-password-hint" className="mt-1 text-xs text-neutral-600">
                        Needed to change your email address.{mailEnabled ? ' We will send a link to the new address to confirm it.' : ''}
                      </p>
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setIsEditing(false)} disabled={saving} className={secondaryButtonClass}>
                      Cancel
                    </button>
                    <button type="submit" disabled={saving} className={primaryButtonClass}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            <ProfileActivity userId={user._id} />
          </div>
        )}

        {tab === 'security' && (
          <div role="tabpanel" id="profile-panel-security" aria-labelledby="profile-tab-security">
            <ProfileSecurity />
          </div>
        )}

        {tab === 'notifications' && (
          <div role="tabpanel" id="profile-panel-notifications" aria-labelledby="profile-tab-notifications">
            <NotificationSettings />
          </div>
        )}
      </div>
    </div>
  )
}
