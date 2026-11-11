import { useCallback, useState } from 'react'
import { attendanceAPI, type PickOption } from '../../api/attendanceAPI'
import AssigneePicker from '../tasks/AssigneePicker'
import { TEAM_WORDS } from '../tasks/pickerWords'
import { useLoad } from './useLoad'

type Props = {
  // Id of the picker's button
  id: string
  // Id of the element that labels it
  labelId: string
  // The chosen id ('' for nobody), which may come from the address
  value: string
  // The person or team picked, or null when the choice is cleared
  onChange: (option: PickOption | null) => void
  // Shown while nothing is chosen
  placeholder: string
  // A choice is required: the list doesn't offer "nobody"
  required?: boolean
}

// The name to show for a chosen id: the option picked a moment ago, or else
// looked up (the page opened from a link that holds only the id)
function useChosen(value: string, picked: PickOption | null, lookup: (id: string) => Promise<PickOption>, fallback: string) {
  const found = useLoad(() => (value && picked?._id !== value ? lookup(value) : Promise.resolve(null)), `chosen:${value}`)
  if (!value) return []
  if (picked?._id === value) return [picked]
  if (found.data?._id === value && found.data.name) return [found.data]
  return [{ _id: value, name: found.error ? fallback : 'Loading…' }]
}

// Search-as-you-type choice of one person (the first 20 matches a request at a time)
export function PersonPicker({ id, labelId, value, onChange, placeholder, required }: Props) {
  const [picked, setPicked] = useState<PickOption | null>(null)
  const chosen = useChosen(value, picked, attendanceAPI.getPerson, 'Selected person')
  const load = useCallback((query: string) => attendanceAPI.searchPeople(query), [])
  return (
    <AssigneePicker
      id={id}
      labelId={labelId}
      single
      value={chosen}
      onChange={(next) => {
        setPicked(next[0] ?? null)
        onChange(next[0] ?? null)
      }}
      load={load}
      placeholder={placeholder}
      allowEmpty={!required}
    />
  )
}

// The same for a team
export function TeamPicker({ id, labelId, value, onChange, placeholder }: Props) {
  const [picked, setPicked] = useState<PickOption | null>(null)
  const chosen = useChosen(value, picked, attendanceAPI.getTeam, 'Selected team')
  const load = useCallback((query: string) => attendanceAPI.searchTeams(query), [])
  return (
    <AssigneePicker
      id={id}
      labelId={labelId}
      single
      value={chosen}
      onChange={(next) => {
        setPicked(next[0] ?? null)
        onChange(next[0] ?? null)
      }}
      load={load}
      placeholder={placeholder}
      words={TEAM_WORDS}
    />
  )
}
