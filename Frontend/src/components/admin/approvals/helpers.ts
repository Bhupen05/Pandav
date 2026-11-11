import { useState } from 'react'
import type { AttendanceRow, ListResponse } from '../../../api/adminAPI'

// Which rows of a list are ticked. Only rows still on screen count, so a
// row that was just reviewed can't stay selected.
export function useSelection(visibleIds: string[]) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const selected = visibleIds.filter((id) => ticked.has(id))
  const allSelected = visibleIds.length > 0 && selected.length === visibleIds.length

  return {
    selected,
    allSelected,
    isSelected: (id: string) => ticked.has(id) && visibleIds.includes(id),
    toggle: (id: string) =>
      setTicked((previous) => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    toggleAll: () => setTicked(allSelected ? new Set() : new Set(visibleIds)),
    clear: () => setTicked(new Set()),
  }
}

// Pending records that aren't part of a leave request: those are reviewed,
// a whole request at a time, under Leave
export const reviewableRecords = (data?: ListResponse<AttendanceRow>) => (data?.data ?? []).filter((row) => !row.leaveRequestId)

// The Attendance tab's count: the server's total for the queue, less the leave days among the
// rows loaded (those are reviewed under Leave). While more pages are still to load, leave days in
// them are still counted, so the number can be a little high until they are.
export const attendanceWaiting = (data?: ListResponse<AttendanceRow>) => {
  if (!data) return null
  const leaveDays = data.data.length - reviewableRecords(data).length
  return Math.max(0, (data.pagination?.total ?? data.data.length) - leaveDays)
}
