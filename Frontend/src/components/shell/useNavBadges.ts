import { useEffect, useState } from 'react'
import { navAPI } from '../../api/navAPI'

export interface NavBadgeCounts {
  invites: number
  approvals: number
  messages: number
}

const REFRESH_MS = 60_000

// Each count that could be read; one that couldn't is left out
const fetchCounts = async (role: string | undefined): Promise<Partial<NavBadgeCounts>> => {
  const reviews = role === 'admin' || role === 'team_leader'
  const [invites, approvals, messages] = await Promise.allSettled([
    role === 'admin' ? Promise.resolve(0) : navAPI.pendingInvites(),
    reviews ? navAPI.waitingApprovals() : Promise.resolve(0),
    role === 'admin' ? navAPI.newContactMessages() : Promise.resolve(0),
  ])
  return {
    ...(invites.status === 'fulfilled' ? { invites: invites.value } : {}),
    ...(approvals.status === 'fulfilled' ? { approvals: approvals.value } : {}),
    ...(messages.status === 'fulfilled' ? { messages: messages.value } : {}),
  }
}

// The numbers on the navigation links: team invites waiting for an answer,
// items waiting for a leader's or an admin's review, new contact messages.
// Fetched on sign-in, every minute, and again whenever `refreshKey` changes
// (the shell passes the number of notifications that arrived live). A count
// that can't be read keeps its last value: a badge is never worth an error.
export function useNavBadges(role: string | undefined, enabled: boolean, refreshKey: number): NavBadgeCounts {
  const [counts, setCounts] = useState<NavBadgeCounts>({ invites: 0, approvals: 0, messages: 0 })

  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = () => {
      void fetchCounts(role).then((fresh) => {
        if (active) setCounts((previous) => ({ ...previous, ...fresh }))
      })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [role, enabled, refreshKey])

  return counts
}
