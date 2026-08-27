// Turn structured report rows into CSV, spreadsheet, or printable PDF output.

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { createXlsxWorkbook } from "./xlsxWorkbook.js";

const formulaPrefix = /^[\t\r ]*[=+\-@]/;
const safeText = (value) => {
  const text = String(value ?? "");
  return formulaPrefix.test(text) ? `'${text}` : text;
};
const cells = (rows) => {
  const values = Array.isArray(rows) ? rows : [];
  const columns = [...new Set(values.flatMap((row) => Object.keys(row || {})))];
  const text = (value) => value && typeof value === "object" ? value.name || value.code || JSON.stringify(value) : value ?? "";
  return { columns, body: values.map((row) => columns.map((column) => text(row[column]))) };
};
export const safeFilename = (value) => String(value || "report").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "report";
export const saveBlob = (blob, name) => {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("The export did not contain any downloadable data.");
  const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.href = url; link.download = safeFilename(name); document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
export function exportReport(rows, format, title, metadata = {}) {
  const { columns, body } = cells(rows); const base = safeFilename(`${metadata.organisation ? `${metadata.organisation}-` : ""}${title}-${metadata.as_of_date || metadata.end_date || new Date().toISOString().slice(0, 10)}`.toLowerCase());
  const meta = Object.entries(metadata).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ");
  if (format === "pdf") { const document = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait" }); document.setFontSize(16); document.text(title, 14, 16); if (meta) { document.setFontSize(9); document.setTextColor(90); document.text(meta, 14, 22); } autoTable(document, { head: [columns], body: body.map((row) => row.map(safeText)), startY: meta ? 28 : 22, styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [15, 76, 92] }, showHead: "everyPage" }); document.save(`${base}.pdf`); return; }
  const escaped = (value) => `"${safeText(value).replaceAll('"', '""')}"`;
  if (format === "csv") { saveBlob(new Blob([`\uFEFF${[columns, ...body].map((row) => row.map(escaped).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }), `${base}.csv`); return; }
  if (format === "excel") { saveBlob(createXlsxWorkbook({ title, rows, metadata }), `${base}.xlsx`); return; }
  throw new Error(`Unsupported export format: ${format}`);
}
