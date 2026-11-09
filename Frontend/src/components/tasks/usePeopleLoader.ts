import { useCallback, useRef } from 'react'
import { taskAPI } from '../../api/taskAPI'
import type { AssigneeOption } from './types'

// Who can be given a task, for the people picker: admins search every active
// account; team leaders choose from the people in their own team
export function usePeopleLoader(isAdmin: boolean) {
  const team = useRef<Promise<AssigneeOption[]> | null>(null)

  return useCallback(
    async (query: string): Promise<AssigneeOption[]> => {
      if (isAdmin) return taskAPI.searchActiveUsers(query)

      if (!team.current) {
        const request = taskAPI.getMyTeam().then((mine) =>
          mine
            ? [...mine.leaders, ...mine.members]
                .filter((person) => person.isActive !== false)
                .map(({ _id, name, email }) => ({ _id, name, email }))
            : [],
        )
        // A failure isn't kept: the next try asks again
        request.catch(() => {
          team.current = null
        })
        team.current = request
      }
      const people = await team.current
      const needle = query.trim().toLowerCase()
      return needle ? people.filter((person) => `${person.name} ${person.email ?? ''}`.toLowerCase().includes(needle)) : people
    },
    [isAdmin],
  )
}
