import { useId, useState, type FormEvent } from 'react'
import { teamAPI } from '../../api/teamAPI'
import { teamErrorMessage } from './format'
import { useBusy } from './hooks'
import PersonPicker, { type PickerPerson } from './PersonPicker'
import { primaryButton, secondaryButton, TeamDialog } from './ui'

type Props = {
  teamId: string
  teamName: string
  // Looks people up; wrap in useCallback
  search: (query: string) => Promise<PickerPerson[]>
  // Characters to type before the search runs
  minChars?: number
  onClose: () => void
  // Called after an invite is sent, with who it went to
  onInvited: (who: string) => void
}

// Invite someone found through the search, or by email. The error of a failed
// invite (a rate limit, a block, someone already in a team) shows in the
// dialog, since a toast would sit behind it.
export default function InviteDialog({ teamId, teamName, search, minChars = 0, onClose, onInvited }: Props) {
  const emailId = useId()
  const { run, isBusy, anyBusy } = useBusy()
  const [picked, setPicked] = useState<PickerPerson | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  const send = (key: string, target: { userId: string } | { email: string }, who: string) =>
    run(key, async () => {
      setError('')
      try {
        await teamAPI.inviteMember(teamId, target)
        onInvited(who)
      } catch (failure) {
        setError(teamErrorMessage(failure, 'Could not send the invite.'))
      }
    })

  const sendToPerson = (event: FormEvent) => {
    event.preventDefault()
    if (picked) void send('person', { userId: picked._id }, picked.name)
  }

  const sendToEmail = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (address) void send('email', { email: address }, address)
  }

  return (
    <TeamDialog
      title={`Invite to ${teamName}`}
      description="They get a notification and an email, and have 7 days to accept or decline."
      onClose={onClose}
      busy={anyBusy}
      wide
    >
      <form onSubmit={sendToPerson}>
        <PersonPicker
          label="Find a person"
          search={search}
          value={picked}
          onChange={setPicked}
          minChars={minChars}
          hint="Only people who are not in a team and can be invited are listed."
          disabled={anyBusy}
        />
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={!picked || anyBusy} className={primaryButton}>
            {isBusy('person') ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </form>

      <form onSubmit={sendToEmail} className="mt-5 border-t border-gray-200 pt-4">
        <label htmlFor={emailId} className="block text-sm font-medium text-gray-700">
          Or invite by email
        </label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={anyBusy}
            autoComplete="off"
            placeholder="name@example.com"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50 sm:flex-1"
          />
          <button type="submit" disabled={!email.trim() || anyBusy} className={secondaryButton}>
            {isBusy('email') ? 'Sending…' : 'Invite by email'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} disabled={anyBusy} className={secondaryButton}>
          Close
        </button>
      </div>
    </TeamDialog>
  )
}
