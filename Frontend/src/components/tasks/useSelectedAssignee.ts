import { useEffect, useState } from 'react'
import { taskAPI } from '../../api/taskAPI'
import { personId, personName } from './taskFormat'
import type { AssigneeOption, Task } from './types'

// The person the "Assigned to" filter shows. The address holds only an id (a
// link such as /tasks?assignedTo=<id>), so the name comes from, in order: the
// person just picked, a lookup (admins read the account; leaders look in
// their team, which `loadPeople` already caches), and the first loaded task
// that has them on it. "Selected person" only if none of those knows them.
export function useSelectedAssignee(
  id: string | undefined,
  picked: AssigneeOption | null,
  { isAdmin, loadPeople, tasks }: { isAdmin: boolean; loadPeople: (query: string) => Promise<AssigneeOption[]>; tasks: Task[] },
): AssigneeOption | null {
  const [found, setFound] = useState<AssigneeOption | null>(null)

  useEffect(() => {
    if (!id || picked?._id === id) return
    let cancelled = false
    const lookup = isAdmin ? taskAPI.getUser(id) : loadPeople('').then((people) => people.find((person) => person._id === id) ?? null)
    lookup
      .then((person) => {
        if (!cancelled && person) setFound(person)
      })
      // A person who can't be looked up is named from the tasks, or not at all
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, picked, isAdmin, loadPeople])

  if (!id) return null
  if (picked?._id === id) return picked
  if (found?._id === id) return found
  for (const task of tasks) {
    const match = task.assignedTo.find((assignee) => personId(assignee) === id)
    if (match && personName(match, '')) return { _id: id, name: personName(match) }
  }
  return { _id: id, name: 'Selected person' }
}
