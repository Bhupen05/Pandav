import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MessageSquare, Settings, Users } from 'lucide-react'
import Chat, { type ChatPerson } from '../components/Chat'
import Avatar from '../components/chat/Avatar'
import ConnectionStrip from '../components/chat/ConnectionStrip'
import { roleLabel } from '../components/chat/format'
import { PersonRow, TeamRow, UnreadBadge, type ListPerson } from '../components/chat/ListRows'
import ManageTeamDialog from '../components/chat/ManageTeamDialog'
import { useBlocking } from '../components/chat/useBlocking'
import { authAPI } from '../api/authAPI'
import { getErrorMessage } from '../api/axios'
import { chatAPI, type ChatContact, type TeamDetail } from '../api/chatAPI'
import { useAuth } from '../context/useAuth'
import { useChat } from '../context/useChat'
import { useFeedback } from '../context/useFeedback'

type ListType = 'direct' | 'team'

interface ContactsState {
  loaded: boolean
  loading: boolean
  error: string
}

// What the server uses for user ids
const OBJECT_ID = /^[a-f\d]{24}$/i

const sumCounts = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0)

function ListMessage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {children ? <div className="mt-2 text-sm text-slate-600">{children}</div> : null}
    </div>
  )
}

// A failed list shows what went wrong with a way to try again, instead of
// looking like an empty one
function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-3 my-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
      >
        Retry
      </button>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-1 p-2" role="status" aria-label="Loading conversations">
      {[...Array(5)].map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-3">
          <div className="h-10 w-10 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="h-2.5 w-32 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ChatPage() {
  const { user, isAdmin, updateUser } = useAuth()
  const { notify } = useFeedback()
  const {
    activeUsers,
    unreadCounts,
    teamUnreadCounts,
    totalUnread,
    conversations,
    conversationsStatus,
    loadConversations,
    findConversation,
    teamChats,
    teamChatsStatus,
    loadTeamChats,
    blocked,
    loadBlocks,
    refreshContacts,
  } = useChat()
  const { unblock, busy: unblockBusy } = useBlocking()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // The open conversation lives in the address, so links from notifications
  // and the Social Hub (/chat?user=<id>, /chat?team=<id>) land on it
  const selectedUserId = searchParams.get('user')
  const selectedTeamId = searchParams.get('team')
  const hasSelection = Boolean(selectedUserId || selectedTeamId)

  // Everyone starts in Direct, even people who are in a team
  const [pickedTab, setPickedTab] = useState<ListType>('direct')
  const tab: ListType = selectedTeamId ? 'team' : selectedUserId ? 'direct' : pickedTab
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<ContactsState & { list: ChatContact[] }>({
    list: [],
    loaded: false,
    loading: false,
    error: '',
  })
  const [teamDetail, setTeamDetail] = useState<{ id: string; team: TeamDetail | null } | null>(null)
  const [managing, setManaging] = useState<'edit' | 'create' | null>(null)

  const loadContacts = useCallback(async () => {
    setContacts((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const list = await chatAPI.contacts()
      setContacts({ list, loaded: true, loading: false, error: '' })
    } catch (error) {
      setContacts((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error, 'Could not load the people you can message.'),
      }))
    }
  }, [])

  // Blocking or unblocking changes who can be messaged
  useEffect(() => {
    void loadContacts()
  }, [loadContacts, blocked.length])

  useEffect(() => {
    void loadConversations()
    void loadTeamChats()
    void loadBlocks()
  }, [loadConversations, loadTeamChats, loadBlocks])

  // The details of the open team room: who leads it, and whether it is frozen
  useEffect(() => {
    if (!selectedTeamId) return
    let cancelled = false
    chatAPI
      .team(selectedTeamId)
      .then((team) => {
        if (!cancelled) setTeamDetail({ id: selectedTeamId, team })
      })
      .catch(() => {
        if (!cancelled) setTeamDetail({ id: selectedTeamId, team: null })
      })
    return () => {
      cancelled = true
    }
  }, [selectedTeamId])

  // ── People ───────────────────────────────────────────────────────────────

  const blockedIds = useMemo(() => new Set(blocked.map((person) => person._id)), [blocked])
  const canMessageById = useMemo(
    () => new Map(conversations.map((row) => [row.user._id, row.canMessage])),
    [conversations],
  )

  const { conversationRows, contactRows } = useMemo(() => {
    const emails = new Map(contacts.list.map((contact) => [contact._id, contact.email]))
    const talked: ListPerson[] = conversations.map((row) => ({
      id: row.user._id,
      name: row.user.name,
      email: emails.get(row.user._id),
      photo: row.user.profileImage,
      role: row.user.role,
      department: row.user.department,
      deleted: row.user.deleted,
      lastMessage: row.lastMessage,
    }))
    const talkedIds = new Set(talked.map((person) => person.id))
    const others: ListPerson[] = contacts.list
      .filter((contact) => !talkedIds.has(contact._id))
      .map((contact) => ({
        id: contact._id,
        name: contact.name,
        email: contact.email,
        photo: contact.profileImage,
        role: contact.role,
        department: contact.department,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { conversationRows: talked, contactRows: others }
  }, [contacts.list, conversations])

  const needle = query.trim().toLowerCase()
  const matchesPerson = (person: ListPerson) =>
    !needle ||
    [person.name, person.email, person.department, roleLabel(person.role)].some((value) =>
      value?.toLowerCase().includes(needle),
    )
  const shownConversations = conversationRows.filter(matchesPerson)
  const shownContacts = contactRows.filter(matchesPerson)
  const shownTeams = teamChats.filter((row) => !needle || row.teamName.toLowerCase().includes(needle))

  const directSettled =
    (contacts.loaded || Boolean(contacts.error)) && (conversationsStatus.loaded || Boolean(conversationsStatus.error))
  const directUnread = sumCounts(unreadCounts)
  const teamUnread = sumCounts(teamUnreadCounts)
  const visibleChats = tab === 'direct' ? shownConversations.length + shownContacts.length : shownTeams.length

  const selectedPerson = useMemo<ChatPerson | null>(() => {
    if (!selectedUserId) return null
    const row = conversationRows.find((person) => person.id === selectedUserId) ??
      contactRows.find((person) => person.id === selectedUserId)
    if (row) {
      return {
        _id: row.id,
        name: row.name,
        profileImage: row.photo,
        role: row.role,
        department: row.department,
        deleted: row.deleted,
        canMessage: canMessageById.get(row.id),
      }
    }
    const blockedPerson = blocked.find((person) => person._id === selectedUserId)
    return blockedPerson
      ? { _id: blockedPerson._id, name: blockedPerson.name, profileImage: blockedPerson.profileImage, canMessage: false }
      : null
  }, [blocked, canMessageById, contactRows, conversationRows, selectedUserId])

  // A link to someone who is neither a contact nor in the conversations loaded
  // so far: their conversation may be on an older page of the list. If it is
  // not there either, there is nothing to open.
  const [lookup, setLookup] = useState<{ id: string; outcome: 'none' | 'failed' } | null>(null)
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const lookupNeeded = Boolean(selectedUserId) && directSettled && !selectedPerson
  const lookupFailedToLoad = Boolean(contacts.error || conversationsStatus.error)
  // Not an id, or your own: there is nothing to look for
  const impossibleLink = Boolean(selectedUserId) && (!OBJECT_ID.test(selectedUserId ?? '') || selectedUserId === user?._id)

  useEffect(() => {
    if (!selectedUserId || !lookupNeeded || lookupFailedToLoad || impossibleLink) return
    let cancelled = false
    findConversation(selectedUserId)
      .then((found) => {
        // A conversation that is found joins the list, which opens it
        if (!cancelled && !found) setLookup({ id: selectedUserId, outcome: 'none' })
      })
      .catch(() => {
        if (!cancelled) setLookup({ id: selectedUserId, outcome: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [findConversation, impossibleLink, lookupAttempt, lookupFailedToLoad, lookupNeeded, selectedUserId])

  const retryLookup = () => {
    setLookup(null)
    setLookupAttempt((attempt) => attempt + 1)
    if (contacts.error) void loadContacts()
    if (conversationsStatus.error) void loadConversations()
  }

  const selectedTeamRow = selectedTeamId ? teamChats.find((row) => row.teamId === selectedTeamId) : undefined
  const team = teamDetail?.id === selectedTeamId ? teamDetail.team : null
  const isTeamLeader = Boolean(team && team.isActive !== false && team.leaders.some((leader) => leader._id === user?._id))
  const isTeamManager = Boolean(team) && (isAdmin || isTeamLeader)
  const teamFrozen = selectedTeamRow?.isActive === false || team?.isActive === false
  // Anyone outside a team can start one (and leads it)
  const canCreateTeam = user?.role === 'user' && teamChatsStatus.loaded && teamChats.length === 0

  // ── Moving around ────────────────────────────────────────────────────────

  const openConversation = (kind: 'user' | 'team', id: string) => {
    // Switching between conversations replaces the entry, so Back still
    // returns to the list; a deep link keeps leaving the page when going back
    navigate(`/chat?${kind}=${encodeURIComponent(id)}`, {
      replace: hasSelection,
      state: hasSelection ? location.state : { fromList: true },
    })
  }

  const goBackToList = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1)
    else navigate('/chat', { replace: true })
  }

  const switchTab = (next: ListType) => {
    setPickedTab(next)
    setQuery('')
    if (hasSelection) navigate('/chat', { replace: true })
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next: ListType = tab === 'direct' ? 'team' : 'direct'
    switchTab(next)
    document.getElementById(`chat-tab-${next}`)?.focus()
  }

  const handleTeamCreated = async (created: TeamDetail) => {
    notify('Team created. You lead it now.', 'success')
    // Creating a team made this user its leader
    try {
      updateUser(await authAPI.getMe())
    } catch {
      // The next page load picks the new role up
    }
    await loadTeamChats()
    refreshContacts()
    navigate(`/chat?team=${encodeURIComponent(created._id)}`, { replace: hasSelection, state: { fromList: true } })
  }

  const handleTeamChanged = (updated: TeamDetail) => {
    setTeamDetail({ id: updated._id, team: updated })
    void loadTeamChats()
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  const tabClass = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-emerald-600 ${
      active ? 'bg-emerald-50 text-emerald-800' : 'text-neutral-700 hover:bg-neutral-50'
    }`

  const renderConversation = () => {
    if (selectedUserId) {
      if (selectedPerson) {
        return (
          <Chat
            key={`user-${selectedPerson._id}`}
            receiverId={selectedPerson._id}
            receiverName={selectedPerson.name}
            person={selectedPerson}
            onBack={goBackToList}
          />
        )
      }
      if (!directSettled) return <PaneLoading />
      const result = impossibleLink ? 'none' : lookup?.id === selectedUserId ? lookup.outcome : null
      if (lookupFailedToLoad || result === 'failed') {
        return (
          <NotFound
            title="We couldn't open that conversation"
            text="Something went wrong while loading it. Try again in a moment."
            onBack={goBackToList}
            onRetry={retryLookup}
          />
        )
      }
      if (result === 'none') {
        return (
          <NotFound
            title="You can't message this person"
            text="They aren't in your team or your Social Hub connections, and you have no conversation with them."
            onBack={goBackToList}
          />
        )
      }
      return <PaneLoading />
    }

    if (selectedTeamId) {
      if (selectedTeamRow) {
        const people = team ? team.leaders.length + team.members.length : 0
        const leaders = team ? team.leaders.map((leader) => leader.name).join(', ') : ''
        return (
          <Chat
            key={`team-${selectedTeamRow.teamId}`}
            receiverId=""
            receiverName={selectedTeamRow.teamName}
            teamId={selectedTeamRow.teamId}
            subtitle={team ? `${people} ${people === 1 ? 'person' : 'people'}${leaders ? ` · Led by ${leaders}` : ''}` : undefined}
            frozen={teamFrozen}
            canModerate={isTeamLeader}
            onBack={goBackToList}
            actions={
              isTeamManager ? (
                <button
                  type="button"
                  onClick={() => setManaging('edit')}
                  aria-label="Manage team"
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Manage team</span>
                </button>
              ) : null
            }
          />
        )
      }
      return teamChatsStatus.loaded || teamChatsStatus.error ? (
        <NotFound
          title="We couldn't find that team chat"
          text="You may not be in that team any more, or the link is out of date."
          onBack={goBackToList}
        />
      ) : (
        <PaneLoading />
      )
    }

    return (
      <div className="flex h-full items-center justify-center rounded-[28px] border border-white/70 bg-white/80 p-8 text-center shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="max-w-md">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
            {tab === 'direct' ? (
              <MessageSquare className="h-7 w-7" aria-hidden="true" />
            ) : (
              <Users className="h-7 w-7" aria-hidden="true" />
            )}
          </div>
          <h2 className="mt-5 text-xl font-black tracking-tight text-slate-900">
            {tab === 'direct' ? 'Pick a person to start chatting' : 'Open a team chat'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {tab === 'direct'
              ? 'Choose a conversation from the list, or search for someone to message.'
              : isAdmin
                ? 'Choose a team to read its chat and write to it.'
                : 'Choose your team to talk with everyone in it.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_100%)]">
      <div className="mx-auto flex h-[calc(100dvh-4.75rem)] max-w-[1440px] gap-4 px-3 py-3 lg:px-6 lg:py-6">
        <aside
          aria-label="Conversations"
          className={`${hasSelection ? 'hidden lg:flex' : 'flex'} min-h-0 w-full flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur lg:w-80 lg:shrink-0`}
        >
          <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.9))] px-5 py-3 text-white sm:py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">Pandav Chat</p>
                <h1 className="mt-1 text-2xl font-black tracking-tight">Messages</h1>
                <p className="mt-1 hidden text-sm text-slate-200 sm:block">Private chat and team room in one workspace.</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2 text-right">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-200">Unread</p>
                <p className="text-xl font-bold text-white">{totalUnread}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Online</p>
                <p className="mt-1 text-lg font-bold text-white">{activeUsers.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Visible chats</p>
                <p className="mt-1 text-lg font-bold text-white">{visibleChats}</p>
              </div>
            </div>
          </div>

          {!hasSelection && <ConnectionStrip />}

          <div role="tablist" aria-label="Kind of chat" className="flex border-b border-slate-200 bg-white p-2">
            <button
              type="button"
              role="tab"
              id="chat-tab-direct"
              aria-selected={tab === 'direct'}
              aria-controls="chat-list-panel"
              tabIndex={tab === 'direct' ? 0 : -1}
              onClick={() => switchTab('direct')}
              onKeyDown={onTabKeyDown}
              className={tabClass(tab === 'direct')}
            >
              Direct
              <UnreadBadge count={directUnread} />
            </button>
            <button
              type="button"
              role="tab"
              id="chat-tab-team"
              aria-selected={tab === 'team'}
              aria-controls="chat-list-panel"
              tabIndex={tab === 'team' ? 0 : -1}
              onClick={() => switchTab('team')}
              onKeyDown={onTabKeyDown}
              className={tabClass(tab === 'team')}
            >
              Team Chat
              <UnreadBadge count={teamUnread} />
            </button>
          </div>

          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <label htmlFor="chat-search" className="sr-only">
              {tab === 'direct' ? 'Search people' : 'Search team chats'}
            </label>
            <input
              id="chat-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'direct' ? 'Search by name or department' : 'Search team chats'}
              className="block w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {tab === 'direct' ? 'Direct conversations' : isAdmin ? 'Team chats' : 'Your team chat'}
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                {tab === 'direct'
                  ? 'Your teammates, your Social Hub connections, and anyone who has messaged you.'
                  : isAdmin
                    ? 'Every team, including frozen ones.'
                    : 'The chat room of the team you belong to.'}
              </p>
            </div>
            {tab === 'team' && canCreateTeam ? (
              <button
                type="button"
                onClick={() => setManaging('create')}
                className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Create
              </button>
            ) : null}
          </div>

          <div
            id="chat-list-panel"
            role="tabpanel"
            aria-labelledby={`chat-tab-${tab}`}
            className="min-h-0 flex-1 overflow-y-auto pb-2"
          >
            {tab === 'direct' ? (
              !directSettled ? (
                <ListSkeleton />
              ) : (
                <>
                  {conversationsStatus.error ? (
                    <ListError message={conversationsStatus.error} onRetry={() => void loadConversations()} />
                  ) : null}
                  {contacts.error ? <ListError message={contacts.error} onRetry={() => void loadContacts()} /> : null}

                  {shownConversations.length > 0 ? (
                    <section aria-label="Recent conversations">
                      {shownContacts.length > 0 && (
                        <h3 className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Recent
                        </h3>
                      )}
                      {shownConversations.map((person) => (
                        <PersonRow
                          key={person.id}
                          person={person}
                          selected={selectedUserId === person.id}
                          online={activeUsers.includes(person.id)}
                          unread={unreadCounts[person.id] ?? 0}
                          blocked={blockedIds.has(person.id)}
                          onOpen={() => openConversation('user', person.id)}
                        />
                      ))}
                    </section>
                  ) : null}

                  {shownContacts.length > 0 ? (
                    <section aria-label="People you can message">
                      {shownConversations.length > 0 && (
                        <h3 className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Start a conversation
                        </h3>
                      )}
                      {shownContacts.map((person) => (
                        <PersonRow
                          key={person.id}
                          person={person}
                          selected={selectedUserId === person.id}
                          online={activeUsers.includes(person.id)}
                          unread={unreadCounts[person.id] ?? 0}
                          blocked={blockedIds.has(person.id)}
                          onOpen={() => openConversation('user', person.id)}
                        />
                      ))}
                    </section>
                  ) : null}

                  {conversationsStatus.hasMore && !needle ? (
                    <div className="flex justify-center px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void loadConversations({ older: true })}
                        disabled={conversationsStatus.loading}
                        className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {conversationsStatus.loading ? 'Loading...' : 'Show older conversations'}
                      </button>
                    </div>
                  ) : null}

                  {shownConversations.length === 0 && shownContacts.length === 0 && !contacts.error && !conversationsStatus.error ? (
                    needle ? (
                      <ListMessage title="No matching people">Try another name, department or role.</ListMessage>
                    ) : (
                      <ListMessage title="No conversations yet">
                        Connect with people in the Social Hub, or join a team, to message them here.
                      </ListMessage>
                    )
                  ) : null}

                  {blocked.length > 0 && !needle ? (
                    <section
                      aria-labelledby="blocked-people-title"
                      className="mx-3 mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <h3
                        id="blocked-people-title"
                        className="text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                      >
                        Blocked people
                      </h3>
                      <ul className="mt-2 space-y-2">
                        {blocked.map((person) => (
                          <li key={person._id} className="flex items-center gap-2">
                            <Avatar name={person.name} src={person.profileImage} size="sm" />
                            <span id={`blocked-name-${person._id}`} className="min-w-0 flex-1 truncate text-sm text-slate-800">
                              {person.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => void unblock(person)}
                              disabled={unblockBusy}
                              aria-describedby={`blocked-name-${person._id}`}
                              className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                            >
                              Unblock
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              )
            ) : !teamChatsStatus.loaded && !teamChatsStatus.error ? (
              <ListSkeleton />
            ) : teamChatsStatus.error && teamChats.length === 0 ? (
              <ListError message={teamChatsStatus.error} onRetry={() => void loadTeamChats()} />
            ) : shownTeams.length > 0 ? (
              <section aria-label="Team chats">
                {shownTeams.map((row) => (
                  <TeamRow
                    key={row.teamId}
                    name={row.teamName}
                    frozen={row.isActive === false}
                    lastMessage={row.lastMessage}
                    lastMessageDeleted={row.lastMessageDeleted}
                    lastMessageAt={row.lastMessageAt}
                    unread={teamUnreadCounts[row.teamId] ?? row.unreadCount}
                    selected={selectedTeamId === row.teamId}
                    onOpen={() => openConversation('team', row.teamId)}
                  />
                ))}
              </section>
            ) : needle ? (
              <ListMessage title="No matching team chats">Try another team name.</ListMessage>
            ) : (
              <ListMessage title={isAdmin ? 'There are no teams yet' : 'You are not in a team yet'}>
                {isAdmin
                  ? 'Team chats appear here once a team is created.'
                  : canCreateTeam
                    ? 'Start your own team, or accept an invitation to join one.'
                    : 'Your team’s chat appears here once you are in a team.'}
                {canCreateTeam ? (
                  <button
                    type="button"
                    onClick={() => setManaging('create')}
                    className="mt-4 block w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Create your team
                  </button>
                ) : null}
              </ListMessage>
            )}
          </div>
        </aside>

        <div className={`${hasSelection ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          <div className="min-h-0 flex-1">{renderConversation()}</div>
        </div>

        {managing === 'create' || (managing === 'edit' && team) ? (
          <ManageTeamDialog
            team={managing === 'edit' ? team : null}
            canManage={managing === 'create' || isTeamManager}
            onClose={() => setManaging(null)}
            onChanged={handleTeamChanged}
            onCreated={(created) => void handleTeamCreated(created)}
          />
        ) : null}
      </div>
    </div>
  )
}

function PaneLoading() {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      className="flex h-full items-center justify-center rounded-2xl border border-slate-200 bg-white"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
    </div>
  )
}

function NotFound({ title, text, onBack, onRetry }: { title: string; text: string; onBack: () => void; onRetry?: () => void }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <div className="max-w-sm">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{text}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={onBack}
            className={
              onRetry
                ? 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'
                : 'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700'
            }
          >
            Back to messages
          </button>
        </div>
      </div>
    </div>
  )
}
