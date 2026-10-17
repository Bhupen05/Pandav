import { useState, useMemo } from 'react';

interface PaginationResult<T> {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  paginatedData: T[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setPageSize: (size: number) => void;
}

/**
 * Custom hook for handling pagination of arrays
 * @param data - Array of items to paginate
 * @param initialPageSize - Initial number of items per page (default: 10)
 * @returns Pagination state and handlers
 */
export function usePagination<T>(
  data: T[],
  initialPageSize: number = 10
): PaginationResult<T> {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const totalItems = data.length;
  const totalPages = Math.ceil(totalItems / pageSize);

  // Ensure current page doesn't exceed total pages
  const validPage = Math.min(currentPage, Math.max(1, totalPages));
  if (validPage !== currentPage) {
    setCurrentPage(validPage);
  }

  const paginatedData = useMemo(() => {
    const startIndex = (validPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return data.slice(startIndex, endIndex);
  }, [data, validPage, pageSize]);

  const goToPage = (page: number) => {
    const pageNum = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(pageNum);
  };

  const nextPage = () => {
    goToPage(validPage + 1);
  };

  const prevPage = () => {
    goToPage(validPage - 1);
  };

  const handleSetPageSize = (size: number) => {
    setPageSizeState(Math.max(1, size));
    setCurrentPage(1); // Reset to first page on size change
  };

  return {
    currentPage: validPage,
    pageSize,
    totalPages,
    totalItems,
    paginatedData,
    hasNextPage: validPage < totalPages,
    hasPrevPage: validPage > 1,
    goToPage,
    nextPage,
    prevPage,
    setPageSize: handleSetPageSize,
  };
}
