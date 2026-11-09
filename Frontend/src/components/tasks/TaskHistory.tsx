import { useState } from 'react'
import { formatDateTime, historyActor, historyText } from './taskFormat'
import type { HistoryEntry } from './types'

const FIRST = 12

// What has happened to a task, newest first
export default function TaskHistory({ history }: { history: HistoryEntry[] }) {
  const [showAll, setShowAll] = useState(false)
  const newestFirst = [...history].reverse()
  const shown = showAll ? newestFirst : newestFirst.slice(0, FIRST)

  return (
    <section aria-labelledby="task-history-heading">
      <h3 id="task-history-heading" className="mb-3 text-sm font-semibold text-neutral-900">History</h3>
      {history.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing has happened to this task yet.</p>
      ) : (
        <>
          <ol className="relative space-y-3 border-l border-neutral-200 pl-4">
            {shown.map((entry, index) => (
              <li key={entry._id ?? `${entry.at}-${index}`} className="relative">
                <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-neutral-300" />
                <p className="wrap-break-word text-sm text-neutral-800">
                  <span className="font-medium">{historyActor(entry)}</span> {historyText(entry)}
                </p>
                <p className="text-xs text-neutral-500">{formatDateTime(entry.at)}</p>
              </li>
            ))}
          </ol>
          {newestFirst.length > FIRST && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="mt-3 text-sm font-medium text-emerald-700 hover:underline"
            >
              {showAll ? 'Show fewer' : `Show all ${newestFirst.length} events`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
