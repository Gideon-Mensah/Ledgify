// Paginate filtered rows and move back to a valid page when the result count changes.

import { useMemo, useState } from "react";

export function useTablePagination(rows, pageSize = 10) {
  const [requestedPage, setPage] = useState(1);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [page, pageSize, rows]);

  return { page, pageRows, setPage, totalPages, totalRows };
}
