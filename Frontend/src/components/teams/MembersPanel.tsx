import { Link } from 'react-router-dom'
import { LogOut, MessageSquare } from 'lucide-react'
import { teamAPI } from '../../api/teamAPI'
import { useFeedback } from '../../context/useFeedback'
import { teamErrorMessage, roleLabel } from './format'
import { useBusy } from './hooks'
import { activeLeaders, teamPeople, type Team } from './types'
import { Avatar, Badge, dangerOutlineButton, primaryButton } from './ui'
import { useLeaveTeam } from './useLeaveTeam'

type Props = {
  team: Team
  meId?: string
  // A leader of a team that isn't frozen
  canAct: boolean
  onInvite: () => void
  // The team changed: load it again
  onChanged: () => void
  // The signed-in leader left the team
  onLeft: () => void
}

export default function MembersPanel({ team, meId, canAct, onInvite, onChanged, onLeft }: Props) {
  const { notify, confirm } = useFeedback()
  const { run, isBusy } = useBusy()
  const { leave, leaving } = useLeaveTeam(team, onLeft)
  const people = teamPeople(team)
  // A leader may leave only while another active leader stays
  const canLeave = activeLeaders(team).some((leader) => leader._id !== meId)

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Remove ${name} from the team?`,
      message: 'They go back to being a user without a team, and are taken off the team’s open tasks. Their finished work stays.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    await run(`remove-${id}`, async () => {
      try {
        await teamAPI.removeMember(team._id, id)
        notify(`${name} was removed from the team.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not remove this person.'), 'error')
      }
      onChanged()
    })
  }

  return (
    <section aria-labelledby="team-people-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="team-people-heading" className="text-lg font-semibold text-gray-800">
          Team Members ({people.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {canAct && (
            <button type="button" onClick={onInvite} className={primaryButton}>
              + Invite Member
            </button>
          )}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => {
          const isLeader = team.leaders.some((leader) => leader._id === person._id)
          const isMe = person._id === meId
          return (
            <li key={person._id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <Avatar name={person.name} src={person.profileImage} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate font-medium text-gray-900">
                    {person.name}
                    {isMe && <span className="ml-1 text-xs font-normal text-gray-500">(you)</span>}
                  </p>
                  <Badge className={isLeader ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}>
                    {roleLabel(isLeader ? 'team_leader' : 'team_member')}
                  </Badge>
                  {person.isActive === false && <Badge className="bg-gray-100 text-gray-600">Deactivated</Badge>}
                </div>
                {person.email && <p className="truncate text-xs text-gray-500">{person.email}</p>}
                {person.department && <p className="text-xs text-gray-500">{person.department}</p>}
                {!isMe && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      to={`/chat?user=${person._id}`}
                      aria-label={`Message ${person.name}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      Message
                    </Link>
                    {canAct && !isLeader && (
                      <button
                        type="button"
                        onClick={() => void remove(person._id, person.name)}
                        disabled={isBusy(`remove-${person._id}`)}
                        aria-label={`Remove ${person.name} from the team`}
                        className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800">Leave this team</h3>
        {canLeave ? (
          <>
            <p className="mt-1 text-sm text-gray-600">
              You stop leading {team.name}. The other leaders stay in charge, and you go back to having no team.
            </p>
            <button type="button" onClick={() => void leave()} disabled={leaving} className={`mt-3 ${dangerOutlineButton}`}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {leaving ? 'Leaving…' : 'Leave team'}
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-600">
            You are the only leader who can sign in. Ask an admin to make someone else a leader before you leave, or to delete the team.
          </p>
        )}
      </div>
    </section>
  )
}
