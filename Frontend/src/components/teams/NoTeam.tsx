import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { teamAPI } from '../../api/teamAPI'
import { useFeedback } from '../../context/useFeedback'
import { formatDate, teamErrorMessage } from './format'
import { useBusy, useLoader, useSyncSession } from './hooks'
import { CreateTeamDialog } from './TeamDialogs'
import type { ListResponse, ReceivedInvite } from './types'
import { Avatar, EmptyBlock, ErrorBlock, LoadingBlock, primaryButton } from './ui'

// The one screen for someone who is not in a team: start a team they will
// lead, or answer the invites they have received
export default function NoTeam({ onCreated }: { onCreated: () => void }) {
  const { notify } = useFeedback()
  const navigate = useNavigate()
  const syncSession = useSyncSession()
  const { run, isBusy } = useBusy()
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => teamAPI.getMyInvites() as Promise<ListResponse<ReceivedInvite>>, [])
  const loader = useLoader(load, 'Could not load your invites.')
  const invites = loader.data?.data ?? []

  const accept = (invite: ReceivedInvite) =>
    run(invite._id, async () => {
      try {
        const response = await teamAPI.acceptInvite(invite._id)
        notify(response?.message || `You joined ${invite.team?.name ?? 'the team'}.`, 'success')
        // Joining makes them a team member, whose page is /team-member
        await syncSession()
        navigate('/team-member')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not accept this invite.'), 'error')
        loader.reload()
      }
    })

  const decline = (invite: ReceivedInvite) =>
    run(invite._id, async () => {
      try {
        await teamAPI.declineInvite(invite._id)
        notify('Invite declined.', 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not decline this invite.'), 'error')
      }
      loader.reload()
    })

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Your team</p>
          <h1 className="mt-3 text-3xl font-bold text-gray-900">Create your team</h1>
          <p className="mx-auto mt-3 max-w-xl text-gray-600">
            You are not in a team yet. Create one and you will lead it: invite people, give them tasks, and approve their
            work and attendance from this page.
          </p>
          <button type="button" onClick={() => setCreating(true)} className={`mt-6 ${primaryButton} px-5 py-3`}>
            Create Team
          </button>
        </div>

        <section aria-labelledby="my-invites-heading" className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 id="my-invites-heading" className="font-semibold text-gray-900">
            Or join a team you were invited to
          </h2>
          <div className="mt-4">
            {loader.error ? (
              <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
            ) : loader.loading && !loader.data ? (
              <LoadingBlock label="Loading your invites…" />
            ) : invites.length === 0 ? (
              <EmptyBlock>No invites right now. When a team invites you, it shows up here.</EmptyBlock>
            ) : (
              <ul className="space-y-3">
                {invites.map((invite) => {
                  const frozen = invite.team?.isActive === false
                  const gone = !invite.team
                  return (
                    <li key={invite._id} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar name={invite.invitedBy?.name} src={invite.invitedBy?.profileImage} />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">{invite.team?.name ?? 'A team that no longer exists'}</p>
                          {invite.team?.description && <p className="text-sm text-gray-600">{invite.team.description}</p>}
                          <p className="mt-1 text-xs text-gray-500">
                            Invited by {invite.invitedBy?.name ?? 'someone'} · {formatDate(invite.createdAt)}
                            {invite.expiresAt ? ` · answer by ${formatDate(invite.expiresAt)}` : ''}
                          </p>
                          {frozen && (
                            <p className="mt-1 text-xs text-sky-800">
                              An admin has frozen this team. You can join once it is unfrozen; you can still decline.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void accept(invite)}
                          disabled={isBusy(invite._id) || frozen || gone}
                          aria-label={`Accept the invite to ${invite.team?.name ?? 'the team'}`}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => void decline(invite)}
                          disabled={isBusy(invite._id)}
                          aria-label={`Decline the invite to ${invite.team?.name ?? 'the team'}`}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {creating && (
        <CreateTeamDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            notify('Team created. You lead it now.', 'success')
            onCreated()
          }}
        />
      )}
    </div>
  )
}
