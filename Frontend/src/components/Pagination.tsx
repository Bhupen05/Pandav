import { useId } from 'react'

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems?: number
  onPageChange: (page: number) => void
  itemsPerPage?: number
  onItemsPerPageChange?: (size: number) => void
  disabled?: boolean
}

const PAGE_SIZES = [10, 25, 50, 100]

const BUTTON =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-neutral-200 px-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50'

// The page numbers to show: the first and last page, and a few around the current one
const pageList = (current: number, total: number): Array<number | 'gap-start' | 'gap-end'> => {
  const span = 5
  let start = Math.max(1, current - Math.floor(span / 2))
  const end = Math.min(total, start + span - 1)
  start = Math.max(1, end - span + 1)

  const pages: Array<number | 'gap-start' | 'gap-end'> = []
  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push('gap-start')
  }
  for (let page = start; page <= end; page++) pages.push(page)
  if (end < total) {
    if (end < total - 1) pages.push('gap-end')
    pages.push(total)
  }
  return pages
}

/**
 * Page navigation. It always stays on screen (even for a single page, so the
 * page size can still be changed) and wraps on narrow screens, where the page
 * numbers give way to "Page 2 of 7".
 */
export const Pagination = ({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  itemsPerPage = 10,
  onItemsPerPageChange,
  disabled = false,
}: PaginationProps) => {
  const sizeId = useId()
  const pages = Math.max(1, totalPages)
  const page = Math.min(Math.max(1, currentPage), pages)
  const sizes = PAGE_SIZES.includes(itemsPerPage) ? PAGE_SIZES : [...PAGE_SIZES, itemsPerPage].sort((a, b) => a - b)

  const first = totalItems === undefined ? undefined : totalItems === 0 ? 0 : (page - 1) * itemsPerPage + 1
  const last = totalItems === undefined ? undefined : Math.min(totalItems, page * itemsPerPage)

  return (
    <nav aria-label="Pagination" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p className="text-sm text-neutral-600" aria-live="polite">
        {totalItems === undefined ? (
          `Page ${page} of ${pages}`
        ) : (
          <>
            Showing <span className="font-semibold text-neutral-900">{first}–{last}</span> of{' '}
            <span className="font-semibold text-neutral-900">{totalItems}</span>
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || disabled}
          aria-label="Previous page"
          className={BUTTON}
        >
          ← Prev
        </button>

        <span className="px-1 text-sm text-neutral-600 sm:hidden">
          Page {page} of {pages}
        </span>

        <ul className="hidden items-center gap-1 sm:flex">
          {pageList(page, pages).map((entry) => (
            <li key={entry}>
              {typeof entry === 'string' ? (
                <span aria-hidden="true" className="px-2 text-neutral-500">…</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onPageChange(entry)}
                  disabled={disabled}
                  aria-label={`Page ${entry}`}
                  aria-current={entry === page ? 'page' : undefined}
                  className={
                    entry === page
                      ? 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-neutral-900 bg-neutral-900 px-3 text-sm font-medium text-white'
                      : BUTTON
                  }
                >
                  {entry}
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages || disabled}
          aria-label="Next page"
          className={BUTTON}
        >
          Next →
        </button>
      </div>

      {onItemsPerPageChange && (
        <div className="flex items-center gap-2">
          <label htmlFor={sizeId} className="text-sm text-neutral-600">Per page</label>
          <select
            id={sizeId}
            value={itemsPerPage}
            onChange={(event) => onItemsPerPageChange(Number(event.target.value))}
            disabled={disabled}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      )}
    </nav>
  )
}

export default Pagination
