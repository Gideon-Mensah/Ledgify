// Turn structured report rows into CSV, spreadsheet, or printable PDF output.

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

const formulaPrefix = /^[\t\r ]*[=+\-@]/;
const safeText = (value) => {
  const text = String(value ?? "");
  return formulaPrefix.test(text) ? `'${text}` : text;
};
const escapeHtml = (value) => safeText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const cells = (rows) => {
  const values = Array.isArray(rows) ? rows : [];
  const columns = [...new Set(values.flatMap((row) => Object.keys(row || {})))];
  const text = (value) => value && typeof value === "object" ? value.name || value.code || JSON.stringify(value) : value ?? "";
  return { columns, body: values.map((row) => columns.map((column) => text(row[column]))) };
};
const save = (content, type, name) => {
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href);
};
export function exportReport(rows, format, title, metadata = {}) {
  const { columns, body } = cells(rows); const base = title.toLowerCase().replaceAll(" ", "-");
  const meta = Object.entries(metadata).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ");
  if (format === "pdf") { const document = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait" }); document.setFontSize(16); document.text(title, 14, 16); if (meta) { document.setFontSize(9); document.setTextColor(90); document.text(meta, 14, 22); } autoTable(document, { head: [columns], body: body.map((row) => row.map(safeText)), startY: meta ? 28 : 22, styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [15, 76, 92] }, showHead: "everyPage" }); document.save(`${base}.pdf`); return; }
  const escaped = (value) => `"${safeText(value).replaceAll('"', '""')}"`;
  if (format === "csv") { save(`\uFEFF${[columns, ...body].map((row) => row.map(escaped).join(",")).join("\r\n")}`, "text/csv;charset=utf-8", `${base}.csv`); return; }
  const html = `<html><head><meta charset="utf-8"></head><body><h1>${escapeHtml(title)}</h1>${meta ? `<p>${escapeHtml(meta)}</p>` : ""}<table><thead><tr>${columns.map((value) => `<th>${escapeHtml(value)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  save(html, "application/vnd.ms-excel", `${base}.xls`);
}
