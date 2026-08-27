import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createXlsxWorkbook } from "../src/utils/xlsxWorkbook.js";
import { generalJournalExportRows, journalTotals, orderedJournalLines } from "../src/utils/generalJournal.js";

const journal = {
  id: "journal-1", entry_number: "JRN-2026-001", date: "2026-08-27", status: "posted",
  description: "Initial capital introduced into the business", source_type: "manual",
  lines: [
    { id: "credit", account: { id: "capital", code: "3000", name: "Owner Capital" }, debit: "0.00", credit: "1000000.00" },
    { id: "debit", account: { id: "bank", code: "1000", name: "Business Bank Account" }, debit: "1000000.00", credit: "0.00" },
  ],
};

test("General Journal presents debits before credits without mutating stored order", () => {
  const ordered = orderedJournalLines(journal.lines);
  assert.deepEqual(ordered.map((line) => line.id), ["debit", "credit"]);
  assert.deepEqual(journal.lines.map((line) => line.id), ["credit", "debit"]);
  assert.deepEqual(journalTotals([journal]), { debit: 1000000, credit: 1000000, malformed: 0 });
});

test("General Journal export keeps account amounts numeric and narration grouped", async () => {
  const rows = generalJournalExportRows([journal]);
  assert.equal(rows[0].date, "2026-08-27"); assert.equal(rows[1].date, "");
  assert.equal(typeof rows[0].debit, "number"); assert.equal(typeof rows[1].credit, "number");
  assert.equal(rows.at(-1).row_type, "narration");
  const blob = createXlsxWorkbook({ title: "General Journal", rows, metadata: { organisation: "Test Organisation", currency: "GBP", start_date: "2026-08-01", end_date: "2026-08-31" } });
  const binary = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  assert.match(binary, /General Journal/); assert.match(binary, /BALANCED/); assert.match(binary, /<v>1000000<\/v>/);
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

test("General Journal warns about malformed lines and has complete print rules", async () => {
  const malformed = { ...journal, lines: [{ id: "bad", account: { id: "x", code: "9999", name: "Historical error" }, debit: "10", credit: "10" }] };
  assert.equal(journalTotals([malformed]).malformed, 1);
  const [page, css] = await Promise.all([readFile("src/pages/accounting/GeneralJournalPage.jsx", "utf8"), readFile("src/styles/journals.css", "utf8")]);
  assert.match(page, /Both debit and credit are populated/); assert.match(page, /general-journal-print-register/);
  assert.match(css, /general-journal-table thead \{ display: table-header-group; \}/); assert.match(css, /@page \{ size: A4 portrait/);
});
