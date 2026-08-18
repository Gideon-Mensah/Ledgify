export default function TablePagination({ page, setPage, totalPages, totalRows }) {
  if (totalRows <= 10) return null;
  return <nav className="table-pagination" aria-label="Table pagination">
    <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
    <span>Page {page} of {totalPages} <small>({totalRows} rows)</small></span>
    <button type="button" disabled={page === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
  </nav>;
}
