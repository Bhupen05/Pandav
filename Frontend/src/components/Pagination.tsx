import React from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  onPageChange: (page: number) => void;
  itemsPerPage?: number;
  onItemsPerPageChange?: (size: number) => void;
  disabled?: boolean;
}

/**
 * Pagination component for displaying page navigation controls
 */
export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  itemsPerPage = 10,
  onItemsPerPageChange,
  disabled = false,
}) => {
  if (totalPages <= 1) return null;

  const pages = [];
  const maxPagesToShow = 5;
  const halfWindow = Math.floor(maxPagesToShow / 2);
  
  let startPage = Math.max(1, currentPage - halfWindow);
  let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
  
  if (endPage - startPage + 1 < maxPagesToShow) {
    startPage = Math.max(1, endPage - maxPagesToShow + 1);
  }

  if (startPage > 1) {
    pages.push(1);
    if (startPage > 2) {
      pages.push('...');
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pages.push('...');
    }
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-neutral-600">
        {totalItems ? `${totalItems} total items` : ''}
      </div>
      
      <div className="flex items-center gap-2">
        {/* Previous button */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1 || disabled}
          className="rounded-lg border px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>

        {/* Page numbers */}
        <div className="flex gap-1">
          {pages.map((page, idx) => (
            <React.Fragment key={idx}>
              {page === '...' ? (
                <span className="px-2 py-2 text-neutral-500">…</span>
              ) : (
                <button
                  onClick={() => {
                    if (typeof page === 'number') {
                      onPageChange(page);
                    }
                  }}
                  disabled={disabled}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    currentPage === page
                      ? 'bg-neutral-900 text-white'
                      : 'border text-neutral-700 hover:bg-neutral-50 disabled:opacity-50'
                  }`}
                >
                  {page}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Next button */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || disabled}
          className="rounded-lg border px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>

      {/* Items per page selector */}
      {onItemsPerPageChange && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-600">Per page:</label>
          <select
            value={itemsPerPage}
            onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
            disabled={disabled}
            className="rounded-lg border px-2 py-1 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      )}
    </div>
  );
};

export default Pagination;
