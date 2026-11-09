import { useCallback, useState } from 'react'
import { teamAPI } from '../../api/teamAPI'
import { useFeedback } from '../../context/useFeedback'
import { InviteStateBadge } from './badges'
import { formatDate, formatDateTime, teamErrorMessage } from './format'
import { useBusy, useLoader } from './hooks'
import type { ListResponse, SentInvite, Team } from './types'
import { Avatar, EmptyBlock, ErrorBlock, LoadingBlock, Pager, primaryButton } from './ui'

const PAGE_SIZE = 20

type Props = {
  team: Team
  // A leader of a team that isn't frozen
  canAct: boolean
  frozen: boolean
  version: number
  onChanged: () => void
  onInvite: () => void
}

const detailOf = (invite: SentInvite) => {
  switch (invite.state) {
    case 'pending':
      return `Expires ${formatDate(invite.expiresAt)}`
    case 'declined':
      return `Declined ${formatDateTime(invite.respondedAt ?? invite.updatedAt)}`
    case 'withdrawn':
      return `Withdrawn${invite.withdrawnBy ? ` by ${invite.withdrawnBy.name}` : ''} ${formatDateTime(invite.respondedAt ?? invite.updatedAt)}`
    case 'expired':
      return `Expired ${formatDate(invite.expiresAt)}`
    default:
      return ''
  }
}

// The invites this team has sent: waiting ones can be withdrawn; declined,
// withdrawn and expired ones stay listed for 30 days
export default function SentInvites({ team, canAct, frozen, version, onChanged, onInvite }: Props) {
  const { notify, confirm } = useFeedback()
  const { run, isBusy } = useBusy()
  const [page, setPage] = useState(1)

  const load = useCallback(
    () => teamAPI.getTeamInvites(team._id, { page, limit: PAGE_SIZE }) as Promise<ListResponse<SentInvite>>,
    [team._id, page],
  )
  const loader = useLoader(load, 'Could not load the invites this team has sent.', version)
  const invites = loader.data?.data ?? []

  const withdraw = async (invite: SentInvite) => {
    const name = invite.invitedUser?.name ?? 'this person'
    const ok = await confirm({
      title: 'Withdraw this invite?',
      message: `${name} can no longer accept it. You can invite them again, but each invite still counts towards the limit of 3 per person a day.`,
      confirmLabel: 'Withdraw',
      danger: true,
    })
    if (!ok) return
    await run(invite._id, async () => {
      try {
        await teamAPI.withdrawInvite(team._id, invite._id)
        notify(`Invite to ${name} withdrawn.`, 'success')
      } catch (error) {
        notify(teamErrorMessage(error, 'Could not withdraw this invite.'), 'error')
      }
      onChanged()
    })
  }

  return (
    <section aria-labelledby="sent-invites-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="sent-invites-heading" className="text-lg font-semibold text-gray-800">
          Invites sent
        </h2>
        {canAct && (
          <button type="button" onClick={onInvite} className={primaryButton}>
            + Invite Member
          </button>
        )}
      </div>

      {frozen && (
        <p className="mb-4 text-sm text-gray-600">Invites can’t be sent or withdrawn while the team is frozen.</p>
      )}

      {loader.error ? (
        <ErrorBlock message={loader.error} onRetry={loader.reload} retrying={loader.loading} />
      ) : loader.loading && !loader.data ? (
        <LoadingBlock label="Loading invites…" />
      ) : invites.length === 0 ? (
        <EmptyBlock>No invites sent yet. Invites you send show up here, with the answer.</EmptyBlock>
      ) : (
        <>
          <ul className={`space-y-3 ${loader.loading ? 'opacity-60' : ''}`} aria-busy={loader.loading}>
            {invites.map((invite) => {
              const person = invite.invitedUser
              return (
                <li key={invite._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <Avatar name={person?.name} src={person?.profileImage} />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-medium text-gray-900">
                      {person?.name ?? 'Former user'}
                      {person?.isActive === false && <span className="ml-2 text-xs font-normal text-gray-500">(deactivated)</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      {[person?.department, `Invited by ${invite.invitedBy?.name ?? 'someone'} on ${formatDate(invite.createdAt)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="text-xs text-gray-500">{detailOf(invite)}</p>
                  </div>
                  <InviteStateBadge state={invite.state} />
                  {invite.state === 'pending' && canAct && (
                    <button
                      type="button"
                      onClick={() => void withdraw(invite)}
                      disabled={isBusy(invite._id)}
                      aria-label={`Withdraw invite to ${person?.name ?? 'this person'}`}
                      className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {isBusy(invite._id) ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <Pager
            page={loader.data?.pagination?.page ?? page}
            pages={loader.data?.pagination?.pages ?? 1}
            total={loader.data?.pagination?.total ?? invites.length}
            onPage={setPage}
            label="invites"
            disabled={loader.loading}
          />
        </>
      )}
    </section>
  )
}
