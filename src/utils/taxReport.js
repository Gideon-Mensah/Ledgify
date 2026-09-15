import { isValidIsoDate } from "./dateUtils.js";

export const taxLabel = value => String(value || "—").toLowerCase().replaceAll("_", " ").replace(/^./, char => char.toUpperCase());
export function taxFilters(params, today) {
  const tab = params.get("tab") || "overview";
  return { start_date: params.get("start_date") ?? `${today.slice(0, 7)}-01`, end_date: params.get("end_date") ?? today,
    tax_rate: params.get("tax_rate") || "", source_type: params.get("source_type") || "",
    status: params.get("status") || "", inclusion: params.get("inclusion") || "", search: params.get("search") || "",
    direction: tab === "output" ? "OUTPUT" : tab === "input" ? "INPUT" : "",
    adjustments_only: tab === "adjustments" ? "true" : "", ordering: params.get("ordering") || "-transaction_date" };
}
export function validateTaxPeriod(filters) {
  if (!isValidIsoDate(filters.start_date) || !isValidIsoDate(filters.end_date)) return "Choose valid start and end dates.";
  return filters.end_date < filters.start_date ? "The end date must be on or after the start date." : "";
}
export function validateTaxRate(rate) {
  if (!rate.code.trim() || !rate.name.trim()) return "Enter a tax code and name.";
  if (rate.rate === "" || !Number.isFinite(Number(rate.rate)) || Number(rate.rate) < 0 || Number(rate.rate) > 100) return "Enter a percentage between 0 and 100.";
  if (!isValidIsoDate(rate.effective_from)) return "Choose a valid effective start date.";
  if (rate.effective_to && (!isValidIsoDate(rate.effective_to) || rate.effective_to < rate.effective_from)) return "The effective end date must be on or after the start date.";
  return "";
}
export function taxExportRows(rows, summary, rates = []) {
  return [...rows.map(row => ({ date: row.transaction_date, document: row.document_number, contact: row.contact_name,
    type: taxLabel(row.source_type), direction: taxLabel(row.direction), net_amount: row.net_amount,
    tax_rate: `${rates.find(rate => rate.id === row.tax_rate)?.name || (/^V[0-9a-f]{20,32}-\d+$/i.test(row.tax_rate_code) ? 'Tax component' : row.tax_rate_code)} (${row.tax_rate_percent}%)`, tax_amount: row.tax_amount, gross_amount: row.gross_amount,
    inclusion: taxLabel(row.inclusion), status: row.is_reversal ? "Reversal" : row.journal_status === "reversed" ? "Reversed original" : row.journal_status === "void" ? "Voided journal" : taxLabel(row.status), currency: row.currency })),
  { document: "Included totals", net_amount: summary.net_amount, tax_amount: summary.tax_amount, gross_amount: summary.gross_amount }];
}
