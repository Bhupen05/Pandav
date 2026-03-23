import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import Chat from '../components/Chat'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import { teamAPI } from '../api/teamAPI'

interface UserItem {
  _id: string
  name: string
  email: string
  role?: string
  profileImage?: string
  department?: string
}

interface TeamDetail {
  _id: string
  name: string
  description?: string
  leaders: UserItem[]
  members: UserItem[]
  isActive?: boolean
}

type ListType = 'direct' | 'team'

const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api/v2').replace(/\/+$/, '')

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export default function ChatPage() {
  const { token, isAuthenticated, user, isTeamLeader, isAdmin } = useAuth()
  const { unreadCounts, clearUnread, activeUsers } = useChat()
  const [listType, setListType] = useState<ListType>('direct')
  const [users, setUsers] = useState<UserItem[]>([])
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null)
  const [myTeam, setMyTeam] = useState<TeamDetail | null>(null)
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingTeam, setLoadingTeam] = useState(true)
  const [teamError, setTeamError] = useState('')
  const [showManagePanel, setShowManagePanel] = useState(false)
  const [manageBusy, setManageBusy] = useState(false)
  const [manageError, setManageError] = useState('')
  const [manageNotice, setManageNotice] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [groupForm, setGroupForm] = useState({ name: '', description: '' })
  const [searchQuery, setSearchQuery] = useState('')

  const authToken = token || sessionStorage.getItem('token') || localStorage.getItem('token')

  const isTeamManager = useMemo(() => {
    if (!user || !selectedTeam) return false
    return isAdmin || selectedTeam.leaders.some((leader) => leader._id === user._id)
  }, [isAdmin, selectedTeam, user])

  const canCreateTeam = Boolean(isTeamLeader && !myTeam)
  const allowedDirectUserIds = useMemo(() => {
    if (isAdmin) return null
    if (!myTeam || !user?._id) return new Set<string>()

    const ids = new Set<string>()
    myTeam.leaders.forEach((member) => {
      if (member._id !== user._id) ids.add(member._id)
    })
    myTeam.members.forEach((member) => {
      if (member._id !== user._id) ids.add(member._id)
    })
    return ids
  }, [isAdmin, myTeam, user?._id])

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return users

    return users.filter((chatUser) =>
      [chatUser.name, chatUser.email, chatUser.role, chatUser.department]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    )
  }, [searchQuery, users])

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((sum, count) => sum + count, 0),
    [unreadCounts]
  )

  const loadMyTeam = useCallback(async () => {
    if (!isAuthenticated) return

    setLoadingTeam(true)
    setTeamError('')

    try {
      const response = await teamAPI.getMyTeam()
      const team = response?.data ?? null
      setMyTeam(team)
      setSelectedTeam(team)
    } catch (error) {
      setMyTeam(null)
      setSelectedTeam(null)
      const message = error instanceof Error ? error.message : 'No team chat available'
      setTeamError(message)
    } finally {
      setLoadingTeam(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) return
    void loadMyTeam()
  }, [isAuthenticated, loadMyTeam])

  useEffect(() => {
    if (!isAuthenticated || listType !== 'direct') return

    setLoadingUsers(true)
    fetch(`${apiBaseUrl}/users/chat-list`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((response) => response.json())
      .then((data) => {
        const list: UserItem[] = Array.isArray(data) ? data : data.data ?? []
        const scopedList =
          allowedDirectUserIds === null
            ? list
            : list.filter((item) => allowedDirectUserIds.has(item._id))
        setUsers(scopedList)
      })
      .catch(console.error)
      .finally(() => setLoadingUsers(false))
  }, [isAuthenticated, listType, authToken, allowedDirectUserIds])

  useEffect(() => {
    if (!isAuthenticated || listType !== 'team') return
    void loadMyTeam()
  }, [isAuthenticated, listType, loadMyTeam])

  async function handleCreateGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setManageBusy(true)
    setManageError('')
    setManageNotice('')

    try {
      const response = await teamAPI.createTeam({
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || undefined,
      })
      const createdTeam = response?.data ?? null
      setMyTeam(createdTeam)
      setSelectedTeam(createdTeam)
      setGroupForm({ name: '', description: '' })
      setManageNotice('Team chat group created successfully.')
    } catch (error) {
      setManageError(error instanceof Error ? error.message : 'Unable to create the team group')
    } finally {
      setManageBusy(false)
    }
  }

  async function handleUpdateTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTeam) return

    setManageBusy(true)
    setManageError('')
    setManageNotice('')

    try {
      const response = await teamAPI.updateTeam(selectedTeam._id, {
        name: groupForm.name.trim() || selectedTeam.name,
        description: groupForm.description.trim(),
      })
      const updatedTeam = response?.data ?? null
      setMyTeam(updatedTeam)
      setSelectedTeam(updatedTeam)
      setManageNotice('Team details updated.')
    } catch (error) {
      setManageError(error instanceof Error ? error.message : 'Unable to update team details')
    } finally {
      setManageBusy(false)
    }
  }

  async function handleInviteMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTeam || !inviteInput.trim()) return

    setManageBusy(true)
    setManageError('')
    setManageNotice('')

    try {
      await teamAPI.inviteMember(selectedTeam._id, inviteInput.trim())
      setInviteInput('')
      setManageNotice('Invitation sent. The user can accept it from their team invites.')
      await loadMyTeam()
    } catch (error) {
      setManageError(error instanceof Error ? error.message : 'Unable to invite member')
    } finally {
      setManageBusy(false)
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!selectedTeam) return

    setManageBusy(true)
    setManageError('')
    setManageNotice('')

    try {
      const response = await teamAPI.removeMember(selectedTeam._id, memberId)
      const updatedTeam = response?.data ?? null
      setMyTeam(updatedTeam)
      setSelectedTeam(updatedTeam)
      setManageNotice('Member removed from the group.')
    } catch (error) {
      setManageError(error instanceof Error ? error.message : 'Unable to remove member')
    } finally {
      setManageBusy(false)
    }
  }

  useEffect(() => {
    if (showManagePanel && selectedTeam) {
      setGroupForm({
        name: selectedTeam.name || '',
        description: selectedTeam.description || '',
      })
    } else if (!showManagePanel) {
      setManageError('')
      setManageNotice('')
      setInviteInput('')
    }
  }, [selectedTeam, showManagePanel])

  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)]">
      <div className="mx-auto flex h-[calc(100vh-80px)] max-w-[1440px] gap-4 px-4 py-6 lg:px-6">
      <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.9))] px-5 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">Pandav Chat</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">Messages</h1>
              <p className="mt-1 text-sm text-slate-300">Private chat and team room in one workspace.</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-3 py-2 text-right">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">Unread</p>
              <p className="text-xl font-bold text-white">{totalUnread}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Online</p>
              <p className="mt-2 text-lg font-bold text-white">{activeUsers.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Visible chats</p>
              <p className="mt-2 text-lg font-bold text-white">{listType === 'direct' ? filteredUsers.length : myTeam ? 1 : 0}</p>
            </div>
          </div>
        </div>

        <div className="flex border-b bg-white p-2">
          <button
            onClick={() => {
              setListType('direct')
              setSelectedTeam(null)
              setShowManagePanel(false)
            }}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
              listType === 'direct'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            Direct
          </button>
          <button
            onClick={() => {
              setListType('team')
              setSelectedUser(null)
            }}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
              listType === 'team'
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            Team Chat
          </button>
        </div>

        <div className="border-b border-slate-200 bg-white px-4 py-4">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={listType === 'direct' ? 'Search people by name, email, role' : 'Search your team room'}
            className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
        </div>

        <div className="border-b bg-slate-50/80 px-4 py-3">
          {listType === 'direct' ? (
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Direct conversations</h2>
              <p className="mt-1 text-xs text-slate-500">Choose any user for one-to-one chat.</p>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Your team group</h2>
                <p className="mt-1 text-xs text-slate-500">Only the team you belong to is shown here.</p>
              </div>
              {(isTeamManager || canCreateTeam) && (
                <button
                  onClick={() => setShowManagePanel(true)}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {selectedTeam ? 'Manage' : 'Create'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {listType === 'direct' ? (
            <>
              {loadingUsers ? (
                <div className="flex animate-pulse flex-col gap-1 p-2">
                  {[...Array(5)].map((_, index) => (
                    <div key={index} className="flex items-center gap-3 px-2 py-3">
                      <div className="h-9 w-9 rounded-full bg-gray-200" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-24 rounded bg-gray-200" />
                        <div className="h-2.5 w-32 rounded bg-gray-100" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-500">
                    {searchQuery ? '?' : '0'}
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-900">
                    {searchQuery ? 'No matching people' : 'No users found'}
                  </p>
                  <p className="mt-2 text-sm text-neutral-400">
                    {searchQuery
                      ? 'Try another name, email, role, or department.'
                      : 'People available to you will appear here.'}
                  </p>
                </div>
              ) : (
                filteredUsers.map((chatUser) => (
                  <button
                    key={chatUser._id}
                    onClick={() => {
                      setSelectedUser(chatUser)
                      setSelectedTeam(null)
                      clearUnread(chatUser._id)
                    }}
                    className={`mx-2 my-1 flex w-[calc(100%-1rem)] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:bg-neutral-50 ${
                      selectedUser?._id === chatUser._id
                        ? 'border-emerald-200 bg-emerald-50 shadow-sm'
                        : 'border-transparent'
                    }`}
                  >
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                        {initials(chatUser.name)}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                          activeUsers.includes(chatUser._id) ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-neutral-900">{chatUser.name}</p>
                        {(unreadCounts[chatUser._id] ?? 0) > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-semibold text-white">
                            {unreadCounts[chatUser._id] > 99 ? '99+' : unreadCounts[chatUser._id]}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-neutral-400">{chatUser.email}</p>
                      <p className="mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        {(chatUser.role || 'user').replace(/_/g, ' ')}
                        {chatUser.department ? ` | ${chatUser.department}` : ''}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              {loadingTeam ? (
                <div className="p-4 text-sm text-neutral-400">Loading team chat...</div>
              ) : myTeam ? (
                <button
                  onClick={() => setSelectedTeam(myTeam)}
                  className={`flex w-full items-start gap-3 border-l-2 px-4 py-4 text-left transition-colors hover:bg-neutral-50 ${
                    selectedTeam?._id === myTeam._id ? 'border-emerald-600 bg-emerald-50' : 'border-transparent'
                  }`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-sm font-semibold text-blue-700">
                    {initials(myTeam.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">{myTeam.name}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {myTeam.leaders.length + myTeam.members.length} people in this group
                    </p>
                    {myTeam.description ? (
                      <p className="mt-2 line-clamp-2 text-xs text-neutral-400">{myTeam.description}</p>
                    ) : null}
                  </div>
                </button>
              ) : (
                <div className="space-y-3 px-4 py-6 text-sm text-neutral-500">
                  <p>{teamError || 'You are not part of any team chat yet.'}</p>
                  {canCreateTeam ? (
                    <button
                      onClick={() => setShowManagePanel(true)}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Create your team group
                    </button>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {listType === 'team' && selectedTeam ? (
          <div className="flex items-center justify-between rounded-[28px] border border-white/70 bg-white/80 px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Team room</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">{selectedTeam.name}</h2>
              <p className="mt-1 text-xs text-slate-500">
                Leaders: {selectedTeam.leaders.map((leader) => leader.name).join(', ') || 'None'} · Members:{' '}
                {selectedTeam.members.length}
              </p>
            </div>
            {isTeamManager ? (
              <button
                onClick={() => setShowManagePanel(true)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Manage group
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          {selectedUser ? (
            <Chat receiverId={selectedUser._id} receiverName={selectedUser.name} />
          ) : selectedTeam ? (
            <Chat receiverId="" receiverName={selectedTeam.name} teamId={selectedTeam._id} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-[28px] border border-white/70 bg-white/80 p-8 text-center shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="max-w-md">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-xl font-black text-slate-500">
                  {listType === 'direct' ? 'DM' : 'TM'}
                </div>
                <h3 className="mt-5 text-xl font-black tracking-tight text-slate-900">
                  {listType === 'direct' ? 'Pick a person to start chatting' : 'Open your team room'}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {listType === 'direct'
                    ? 'Your direct chat list is already scoped to the people you are allowed to message.'
                    : 'Team chat only shows the room connected to your team, and leaders can manage members from here.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showManagePanel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-3xl rounded-3xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {selectedTeam ? 'Manage Team Chat Group' : 'Create Team Chat Group'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Leaders can update the group info, invite members, and remove members.
                </p>
              </div>
              <button
                onClick={() => setShowManagePanel(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6">
                <form onSubmit={selectedTeam ? handleUpdateTeam : handleCreateGroup} className="space-y-4 rounded-2xl border bg-slate-50 p-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Group name
                    </label>
                    <input
                      value={groupForm.name}
                      onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Design Ops"
                      className="block w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Description
                    </label>
                    <textarea
                      value={groupForm.description}
                      onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                      rows={4}
                      placeholder="What this team chat is for"
                      className="block w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={manageBusy}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {selectedTeam ? 'Save group changes' : 'Create group'}
                  </button>
                </form>

                {selectedTeam ? (
                  <form onSubmit={handleInviteMember} className="space-y-3 rounded-2xl border bg-slate-50 p-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Invite a member</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Enter the user name or user id to send an invite to this chat group.
                      </p>
                    </div>
                    <input
                      value={inviteInput}
                      onChange={(event) => setInviteInput(event.target.value)}
                      placeholder="User name or user id"
                      className="block w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={manageBusy || !inviteInput.trim()}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                      Send invite
                    </button>
                  </form>
                ) : null}

                {(manageError || manageNotice) && (
                  <div className="space-y-2">
                    {manageError ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {manageError}
                      </div>
                    ) : null}
                    {manageNotice ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {manageNotice}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {selectedTeam ? (
                  <>
                    <div className="rounded-2xl border p-4">
                      <h3 className="text-sm font-semibold text-slate-900">Leaders</h3>
                      <div className="mt-3 space-y-3">
                        {selectedTeam.leaders.map((leader) => (
                          <div key={leader._id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                            <div>
                              <p className="text-sm font-medium text-slate-900">{leader.name}</p>
                              <p className="text-xs text-slate-500">{leader.email}</p>
                            </div>
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                              Leader
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border p-4">
                      <h3 className="text-sm font-semibold text-slate-900">Members</h3>
                      <div className="mt-3 space-y-3">
                        {selectedTeam.members.length === 0 ? (
                          <p className="text-sm text-slate-500">No members yet.</p>
                        ) : (
                          selectedTeam.members.map((member) => (
                            <div key={member._id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                              <div>
                                <p className="text-sm font-medium text-slate-900">{member.name}</p>
                                <p className="text-xs text-slate-500">{member.email}</p>
                              </div>
                              {isTeamManager ? (
                                <button
                                  onClick={() => void handleRemoveMember(member._id)}
                                  disabled={manageBusy}
                                  className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-sm text-slate-500">
                    Create your team group first, then you can invite people and manage the chat membership here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  )
}
