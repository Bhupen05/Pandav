import { useEffect, useMemo, useState } from 'react'
import { taskAPI } from '../../api/taskAPI'
import { useAuth } from '../../context/useAuth'
import type { TeamInfo, Viewer } from './taskRights'

// The signed-in person as the task screens need them: their role, the team
// they lead (for the rules on who may manage and review) and the names of the
// teams they can see
export function useViewer(): Viewer {
  const { user, isAdmin } = useAuth()
  const userId = user?._id
  const isLeader = user?.role === 'team_leader'
  const hasTeam = Boolean(user?.teamId)
  const [led, setLed] = useState<TeamInfo | null>(null)
  const [teams, setTeams] = useState<Array<{ _id: string; name: string }>>([])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    if (isAdmin) {
      taskAPI
        .getTeams()
        .then((list) => {
          if (!cancelled) setTeams(list)
        })
        .catch(() => undefined)
    } else if (isLeader || hasTeam) {
      taskAPI
        .getMyTeam()
        .then((team) => {
          if (cancelled || !team) return
          setTeams([{ _id: team._id, name: team.name }])
          if (isLeader) {
            const people = [...team.leaders, ...team.members]
            setLed({ _id: team._id, name: team.name, isActive: team.isActive !== false, memberIds: people.map((person) => person._id) })
          }
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [userId, isAdmin, isLeader, hasTeam])

  return useMemo(
    () => ({
      id: userId || '',
      isAdmin,
      isLeader,
      ledTeam: led,
      teamNames: Object.fromEntries(teams.map((team) => [team._id, team.name])),
    }),
    [userId, isAdmin, isLeader, led, teams],
  )
}
