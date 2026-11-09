import { useId, useState, type FormEvent } from 'react'
import { teamAPI } from '../../api/teamAPI'
import { teamErrorMessage } from './format'
import PersonPicker, { type PickerPerson } from './PersonPicker'
import { CharCount, inputClass, primaryButton, secondaryButton, TeamDialog } from './ui'

export const TEAM_NAME_MAX = 80
export const TEAM_DESCRIPTION_MAX = 500

// What the server accepts as a team's name and description
function DetailsFields({
  name,
  description,
  onName,
  onDescription,
  disabled,
}: {
  name: string
  description: string
  onName: (value: string) => void
  onDescription: (value: string) => void
  disabled?: boolean
}) {
  const nameId = useId()
  const descriptionId = useId()
  return (
    <>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={nameId} className="text-sm font-medium text-gray-700">
            Team Name <span aria-hidden="true">*</span>
          </label>
          <CharCount value={name} max={TEAM_NAME_MAX} />
        </div>
        <input
          id={nameId}
          required
          value={name}
          maxLength={TEAM_NAME_MAX}
          onChange={(event) => onName(event.target.value)}
          disabled={disabled}
          placeholder="e.g. Development team"
          className={inputClass}
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={descriptionId} className="text-sm font-medium text-gray-700">
            Description
          </label>
          <CharCount value={description} max={TEAM_DESCRIPTION_MAX} />
        </div>
        <textarea
          id={descriptionId}
          rows={3}
          value={description}
          maxLength={TEAM_DESCRIPTION_MAX}
          onChange={(event) => onDescription(event.target.value)}
          disabled={disabled}
          placeholder="What does this team work on? (optional)"
          className={inputClass}
        />
      </div>
    </>
  )
}

function FormError({ message }: { message: string }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  )
}

// ── Create ─────────────────────────────────────────────────────────────────

type CreateProps = {
  onClose: () => void
  onCreated: () => void
  // Admins create a team for someone else and pick its leader; everyone else
  // leads the team they create
  pickLeader?: { search: (query: string) => Promise<PickerPerson[]> }
}

export function CreateTeamDialog({ onClose, onCreated, pickLeader }: CreateProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [leader, setLeader] = useState<PickerPerson | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (pickLeader && !leader) {
      setError('Choose who will lead the team.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await teamAPI.createTeam({
        name: name.trim(),
        description: description.trim(),
        ...(pickLeader && leader ? { leaderId: leader._id } : {}),
      })
      onCreated()
    } catch (failure) {
      setError(teamErrorMessage(failure, 'Could not create the team.'))
      setSaving(false)
    }
  }

  return (
    <TeamDialog
      title={pickLeader ? 'Create New Team' : 'Create Team'}
      description={
        pickLeader
          ? 'The leader you choose invites people and reviews the team’s work.'
          : 'You will lead it: invite people, give them tasks, and approve their work and attendance.'
      }
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={submit} className="space-y-4">
        <DetailsFields name={name} description={description} onName={setName} onDescription={setDescription} disabled={saving} />
        {pickLeader && (
          <PersonPicker
            label="Team Leader"
            search={pickLeader.search}
            value={leader}
            onChange={setLeader}
            hint="Only active people who are not in a team are listed."
            disabled={saving}
          />
        )}
        <FormError message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className={primaryButton}>
            {saving ? 'Creating…' : 'Create Team'}
          </button>
        </div>
      </form>
    </TeamDialog>
  )
}

// ── Rename and describe ────────────────────────────────────────────────────

type EditProps = {
  team: { _id: string; name: string; description?: string }
  onClose: () => void
  onSaved: () => void
}

export function EditTeamDialog({ team, onClose, onSaved }: EditProps) {
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await teamAPI.updateTeam(team._id, { name: name.trim(), description: description.trim() })
      onSaved()
    } catch (failure) {
      setError(teamErrorMessage(failure, 'Could not save the changes.'))
      setSaving(false)
    }
  }

  return (
    <TeamDialog title="Edit team" onClose={onClose} busy={saving}>
      <form onSubmit={submit} className="space-y-4">
        <DetailsFields name={name} description={description} onName={setName} onDescription={setDescription} disabled={saving} />
        <FormError message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className={primaryButton}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </TeamDialog>
  )
}
