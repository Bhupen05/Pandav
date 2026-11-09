import { useCallback, useId, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { CalendarCheck, ListChecks, MessageSquare, Pencil, X } from 'lucide-react'
import { teamAPI } from '../api/teamAPI'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import { FrozenBadge } from '../components/teams/badges'
import { formatDate, plural, teamErrorMessage } from '../components/teams/format'
import { useBusy, useDebounced, useLoader } from '../components/teams/hooks'
import InviteDialog from '../components/teams/InviteDialog'
import PersonPicker, { type PickerPerson } from '../components/teams/PersonPicker'
import { CreateTeamDialog, EditTeamDialog } from '../components/teams/TeamDialogs'
import { activeLeaders, type ListResponse, type Team, type TeamPerson } from '../components/teams/types'
import {
  Avatar,
  Badge,
  EmptyBlock,
  ErrorBlock,
  inputClass,
  LoadingBlock,
  primaryButton,
  secondaryButton,
  TeamDialog,
} from '../components/teams/ui'

type EligibleUser = TeamPerson & { teamId?: string | null }

// A leader can be removed only while another leader who can sign in stays
const canRemoveLeader = (team: Team, leader: TeamPerson) => activeLeaders(team).some((other) => other._id !== leader._id)

const outlineLink =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50'

export default function TeamManagement() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <TeamManagementPage />
}

function TeamManagementPage() {
  const { notify, confirm } = useFeedback()
  const { run, isBusy } = useBusy()
  const searchId = useId()
  const filterId = useId()
  const [search, setSearch] = useState('')
  const [frozenFilter, setFrozenFilter] = useState<'' | 'true' | 'false'>('')
  const [version, setVersion] = useState(0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Team | null>(null)
  const [inviting, setInviting] = useState<Team | null>(null)
  const [addingLeader, setAddingLeader] = useState<Team | null>(null)
  const query = useDebounced(search).trim()

  const load = useCallback(
    async () =>
      ((await teamAPI.getTeams({ q: query, frozen: frozenFilter === '' ? undefined : frozenFilter === 'true' })) as ListResponse<Team>)
        .data,
    [query, frozenFilter],
  )
  const loader = useLoader(load, 'Could not load the teams.', version)
  const teams = loader.data
  const reload = () => setVersion((current) => current + 1)
  const filtered = Boolean(query || frozenFilter)

  // People who can lead or join a team: active, not an admin, in no team
  const searchEligible = useCallback(async (text: string): Promise<PickerPerson[]> => {
    const response = await teamAPI.searchEligibleUsers(text)
    return ((response.data ?? []) as EligibleUser[])
      .filter((person) => !person.teamId)
      .map((person) => ({
        _id: person._id,
        name: person.name,
        email: person.email,
        department: person.department,
        profileImage: person.profileImage,
      }))
  }, [])

  // To add a leader: the team's own members, or people in no team
  const searchLeaderCandidates = useCallback(
    async (text: string): Promise<PickerPerson[]> => {
      const needle = text.toLowerCase()
      const members = (addingLeader?.members ?? [])
        .filter(
          (member) =>
            member.isActive !== false &&
            (!needle || member.name.toLowerCase().includes(needle) || (member.email ?? '').toLowerCase().includes(needle)),
        )
        .map((member) => ({
          _id: member._id,
          name: member.name,
          email: member.email,
          department: member.department,
          profileImage: member.profileImage,
          note: 'Member of this team',
        }))
      return [...members, ...(await searchEligible(text))]
    },
    [addingLeader, searchEligible],
  )

  const toggleFrozen = async (team: Team) => {
    const freezing = team.isActive !== false
    if (freezing) {
      const ok = await confirm({
        title: `Freeze “${team.name}”?`,
        message:
          'Its leaders can’t add, change or approve anything, and its chat becomes read-only, until you unfreeze it. Members can still work on their own tasks and check in; their requests wait for an admin.',
        confirmLabel: 'Freeze',
      })
      if (!ok) return
    }
    await run(`freeze-${team._id}`, async () => {
      try {
        await teamAPI.updateTeam(team._id, { isActive: !freezing })
        notify(freezing ? `${team.name} is frozen.` : `${team.name} is unfrozen.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, freezing ? 'Could not freeze the team.' : 'Could not unfreeze the team.'), 'error')
      }
      reload()
    })
  }

  const deleteTeam = async (team: Team) => {
    const ok = await confirm({
      title: `Delete team “${team.name}”?`,
      message: `Its ${plural(team.leaders.length + team.members.length, 'person', 'people')} go back to being users without a team. Its team chat and its invites are deleted. Its tasks and attendance records stay, but no longer belong to a team. This cannot be undone.`,
      confirmLabel: 'Delete team',
      danger: true,
    })
    if (!ok) return
    await run(`delete-${team._id}`, async () => {
      try {
        await teamAPI.deleteTeam(team._id)
        notify(`${team.name} was deleted.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not delete the team.'), 'error')
      }
      reload()
    })
  }

  const removePerson = async (team: Team, person: TeamPerson, asLeader: boolean) => {
    const ok = await confirm({
      title: asLeader ? `Remove ${person.name} as a leader?` : `Remove ${person.name} from ${team.name}?`,
      message: `They go back to being a user without a team, and are taken off the team’s open tasks. Their finished work stays.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    await run(`remove-${team._id}-${person._id}`, async () => {
      try {
        await teamAPI.removeMember(team._id, person._id)
        notify(`${person.name} was removed from ${team.name}.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not remove this person.'), 'error')
      }
      reload()
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
            <p className="text-sm text-gray-600">Create and manage teams, assign leaders and members</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className={primaryButton}>
            + Create Team
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <label htmlFor={searchId} className="text-sm font-medium text-gray-700">
              Search teams
            </label>
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder="Part of a team’s name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={filterId} className="text-sm font-medium text-gray-700">
              Show
            </label>
            <select
              id={filterId}
              value={frozenFilter}
              onChange={(event) => setFrozenFilter(event.target.value as '' | 'true' | 'false')}
              className={inputClass}
            >
              <option value="">All teams</option>
              <option value="false">Active teams</option>
              <option value="true">Frozen teams</option>
            </select>
          </div>
        </div>

        {loader.error && teams && (
          <div className="mb-4">
            <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
          </div>
        )}

        {loader.error && !teams ? (
          <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
        ) : !teams ? (
          <LoadingBlock label="Loading teams…" />
        ) : teams.length === 0 ? (
          <EmptyBlock>
            {filtered ? (
              <>
                <p>No teams match this search.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setFrozenFilter('')
                  }}
                  className={`mt-3 ${secondaryButton}`}
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="text-base">No teams created yet.</p>
                <button type="button" onClick={() => setCreating(true)} className={`mt-3 ${primaryButton}`}>
                  Create First Team
                </button>
              </>
            )}
          </EmptyBlock>
        ) : (
          <ul className={`space-y-6 ${loader.loading ? 'opacity-70' : ''}`} aria-busy={loader.loading}>
            {teams.map((team) => {
              const frozen = team.isActive === false
              return (
                <li key={team._id}>
                  <article aria-labelledby={`team-${team._id}`} className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 p-5">
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id={`team-${team._id}`} className="break-words text-lg font-semibold text-gray-900">
                            {team.name}
                          </h2>
                          {frozen && <FrozenBadge />}
                        </div>
                        {team.description && <p className="mt-0.5 break-words text-sm text-gray-600">{team.description}</p>}
                        <p className="mt-1 text-xs text-gray-500">
                          {plural(team.leaders.length, 'leader')} · {plural(team.members.length, 'member')}
                          {team.counts?.openInvites ? ` · ${plural(team.counts.openInvites, 'open invite')}` : ''} · Created{' '}
                          {formatDate(team.createdAt)}
                        </p>
                        {frozen && (
                          <p className="mt-1 text-xs text-sky-800">Unfreeze this team to invite people or add leaders.</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setInviting(team)}
                          disabled={frozen}
                          aria-label={`Invite to ${team.name}`}
                          className="rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                        >
                          Invite
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingLeader(team)}
                          disabled={frozen}
                          aria-label={`Add Leader to ${team.name}`}
                          className="rounded-lg border border-purple-600 bg-white px-3 py-1.5 text-sm font-medium text-purple-600 hover:bg-purple-50 disabled:opacity-50"
                        >
                          Add Leader
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(team)}
                          aria-label={`Edit ${team.name}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleFrozen(team)}
                          disabled={isBusy(`freeze-${team._id}`)}
                          aria-label={`${frozen ? 'Unfreeze' : 'Freeze'} ${team.name}`}
                          className="rounded-lg border border-sky-600 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                        >
                          {frozen ? 'Unfreeze' : 'Freeze'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTeam(team)}
                          disabled={isBusy(`delete-${team._id}`)}
                          aria-label={`Delete ${team.name}`}
                          className="rounded-lg border border-red-500 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 border-b border-gray-200 px-5 py-3">
                      <Link to={`/tasks?team=${team._id}`} aria-label={`Tasks of ${team.name}`} className={outlineLink}>
                        <ListChecks className="h-4 w-4" aria-hidden="true" />
                        Tasks
                      </Link>
                      <Link to={`/admin/attendance?team=${team._id}`} aria-label={`Attendance of ${team.name}`} className={outlineLink}>
                        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                        Attendance
                      </Link>
                      <Link to={`/chat?team=${team._id}`} aria-label={`Chat of ${team.name}`} className={outlineLink}>
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        Chat
                      </Link>
                    </div>

                    {team.leaders.length > 0 && (
                      <div className="border-b border-gray-200 p-5">
                        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Leaders</h3>
                        <ul className="flex flex-wrap gap-3">
                          {team.leaders.map((leader) => (
                            <li key={leader._id} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
                              <Avatar name={leader.name} src={leader.profileImage} size="sm" tone="bg-blue-200 text-blue-700" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {leader.name}
                                  {leader.isActive === false && <span className="ml-1 text-xs font-normal text-gray-500">(deactivated)</span>}
                                </p>
                                <p className="truncate text-xs text-gray-600">{leader.email}</p>
                              </div>
                              {canRemoveLeader(team, leader) && (
                                <button
                                  type="button"
                                  onClick={() => void removePerson(team, leader, true)}
                                  disabled={isBusy(`remove-${team._id}-${leader._id}`)}
                                  aria-label={`Remove ${leader.name} as a leader of ${team.name}`}
                                  className="ml-1 shrink-0 rounded p-1 text-red-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
                                >
                                  <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {team.leaders.length === 1 && (
                          <p className="mt-2 text-xs text-gray-500">
                            This is the team’s only leader. Add another leader before removing them, or delete the team.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="p-5">
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Members ({team.members.length})
                      </h3>
                      {team.members.length === 0 ? (
                        <p className="text-sm text-gray-500">No members yet.{frozen ? '' : ' Invite some!'}</p>
                      ) : (
                        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                          {team.members.map((member) => (
                            <li key={member._id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <Avatar name={member.name} src={member.profileImage} size="sm" tone="bg-gray-100 text-gray-600" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-900">
                                    {member.name}
                                    {member.isActive === false && (
                                      <Badge className="ml-1 bg-gray-100 text-gray-600">Deactivated</Badge>
                                    )}
                                  </p>
                                  <p className="truncate text-xs text-gray-600">{member.email}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void removePerson(team, member, false)}
                                disabled={isBusy(`remove-${team._id}-${member._id}`)}
                                aria-label={`Remove ${member.name} from ${team.name}`}
                                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {creating && (
        <CreateTeamDialog
          pickLeader={{ search: searchEligible }}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            notify('Team created.', 'success')
            reload()
          }}
        />
      )}

      {editing && (
        <EditTeamDialog
          team={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            notify('Team updated.', 'success')
            reload()
          }}
        />
      )}

      {inviting && (
        <InviteDialog
          teamId={inviting._id}
          teamName={inviting.name}
          search={searchEligible}
          onClose={() => setInviting(null)}
          onInvited={(who) => {
            setInviting(null)
            notify(`Invite sent to ${who}.`, 'success')
            reload()
          }}
        />
      )}

      {addingLeader && (
        <AddLeaderDialog
          team={addingLeader}
          search={searchLeaderCandidates}
          onClose={() => setAddingLeader(null)}
          onAdded={(name) => {
            setAddingLeader(null)
            notify(`${name} now leads ${addingLeader.name}.`, 'success')
            reload()
          }}
        />
      )}
    </div>
  )
}

function AddLeaderDialog({
  team,
  search,
  onClose,
  onAdded,
}: {
  team: Team
  search: (query: string) => Promise<PickerPerson[]>
  onClose: () => void
  onAdded: (name: string) => void
}) {
  const [picked, setPicked] = useState<PickerPerson | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!picked || saving) return
    setSaving(true)
    setError('')
    try {
      await teamAPI.addLeader(team._id, picked._id)
      onAdded(picked.name)
    } catch (failure) {
      setError(teamErrorMessage(failure, 'Could not add the leader.'))
      setSaving(false)
    }
  }

  return (
    <TeamDialog
      title={`Add Leader to ${team.name}`}
      description="Leaders invite people, give them tasks, and review the team’s tasks and attendance."
      onClose={onClose}
      busy={saving}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <PersonPicker
          label="Find a person"
          search={search}
          value={picked}
          onChange={setPicked}
          hint="A member of this team, or an active person who is not in a team."
          disabled={saving}
        />
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={!picked || saving} className={primaryButton}>
            {saving ? 'Adding…' : 'Add Leader'}
          </button>
        </div>
      </form>
    </TeamDialog>
  )
}
