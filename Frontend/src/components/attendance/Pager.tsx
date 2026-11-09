import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Pagination } from '../../api/attendanceAPI'
import { secondaryButton } from './fields'

type Props = {
  pagination?: Pagination
  // How many are on this page, and what they are called ("records")
  shown: number
  noun: string
  onPage: (page: number) => void
  busy?: boolean
}

// "Showing 20 of 57 records" with Previous and Next, for server-paged lists
export default function Pager({ pagination, shown, noun, onPage, busy }: Props) {
  if (!pagination) return null
  const { page, pages, total } = pagination
  return (
    <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
      <p>Showing {shown} of {total} {noun}</p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={secondaryButton} disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </button>
          <span aria-current="page">Page {page} of {pages}</span>
          <button type="button" className={secondaryButton} disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  )
}
