// Presentation only. Validation, amounts and import decisions belong to the backend.
export function statementStatus(row) {
  if (row.status === "duplicate") return row.duplicate_kind === "possible" ? "Possible duplicate" : "Exact duplicate";
  return ({ ready: "Ready", rejected: "Needs attention", information: "Statement balance", imported: "Imported", pending: "Pending" })[row.status] || "Needs attention";
}
export function statementAmount(row, direction) {
  return ["ready", "duplicate", "imported"].includes(row.status) && row.transaction_type === direction ? row.amount : null;
}
export function importSummary(batch) {
  return { ready: batch.ready_rows || 0, duplicates: batch.duplicate_rows || 0, rejected: batch.rejected_rows || 0, information: batch.metadata?.information_rows || 0 };
}
