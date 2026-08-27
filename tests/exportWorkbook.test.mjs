import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createXlsxWorkbook } from "../src/utils/xlsxWorkbook.js";
import { safeFilename } from "../src/utils/reportExport.js";

const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
const storedZipEntries = (data) => {
  const entries = new Map(); let offset = 0; const decoder = new TextDecoder();
  while (data[offset] === 0x50 && data[offset + 1] === 0x4b && data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {
    const view = new DataView(data.buffer, data.byteOffset + offset); const size = view.getUint32(18, true); const nameLength = view.getUint16(26, true); const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30; const contentStart = nameStart + nameLength + extraLength; const name = decoder.decode(data.slice(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(data.slice(contentStart, contentStart + size))); offset = contentStart + size;
  }
  return entries;
};

const metadata = { organisation: "Northstar Trading Ltd", currency: "GBP", start_date: "2026-01-01", end_date: "2026-01-31" };

test("Excel export is a genuine OOXML ZIP with the correct MIME type", async () => {
  const blob = createXlsxWorkbook({ title: "Profit and Loss", rows: [], metadata }); const data = await bytes(blob); const entries = storedZipEntries(data);
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.deepEqual([...data.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const binary = Buffer.from(data).toString("latin1");
  assert.equal(binary.match(/PK\x01\x02/g)?.length, 6);
  assert.equal(binary.match(/PK\x05\x06/g)?.length, 1);
  assert.match(entries.get("[Content_Types].xml"), /spreadsheetml\.sheet\.main\+xml/);
  assert.match(entries.get("xl/workbook.xml"), /Profit and Loss/);
  assert.match(entries.get("xl/worksheets/sheet1.xml"), /Net Profit/);
  assert.doesNotMatch(entries.get("xl/worksheets/sheet1.xml"), /<html/i);
});

test("Profit and Loss workbook keeps numeric totals", async () => {
  const rows = [{ section: "income", account: { code: "4000", name: "Sales" }, amount: 1200 }, { section: "expenses", account: { code: "6000", name: "Rent" }, amount: 200 }, { section: "Totals", total_income: 1200, total_expenses: 200, net_profit: 1000 }];
  const sheet = storedZipEntries(await bytes(createXlsxWorkbook({ title: "Profit and Loss", rows, metadata }))).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /<v>1200<\/v>/); assert.match(sheet, /<v>1000<\/v>/); assert.doesNotMatch(sheet, /t="inlineStr"[^>]*><is><t[^>]*>1000/);
});

test("Trial Balance shows totals and a visible balance result", async () => {
  const rows = [{ section: "rows", account: { code: "0010", name: "Bank", account_type: "asset" }, debit: 500, credit: 0, net_balance: 500 }, { section: "rows", account: { code: "3000", name: "Capital", account_type: "equity" }, debit: 0, credit: 500, net_balance: -500 }, { section: "Totals", total_debit: 500, total_credit: 500, difference: 0, balanced: true }];
  const sheet = storedZipEntries(await bytes(createXlsxWorkbook({ title: "Trial Balance", rows, metadata }))).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /0010/); assert.match(sheet, /Total/); assert.match(sheet, /BALANCED/);
});

test("Balance Sheet exposes, rather than masks, the accounting equation", async () => {
  const rows = [{ section: "assets", account: { code: "1000", name: "Bank" }, amount: 900 }, { section: "liabilities", account: { code: "2000", name: "Loan" }, amount: 100 }, { section: "equity", account: { code: "3000", name: "Capital" }, amount: 700 }, { section: "Totals", total_assets: 900, total_liabilities: 100, total_equity: 700, total_liabilities_and_equity: 800, difference: 100, balanced: false }];
  const sheet = storedZipEntries(await bytes(createXlsxWorkbook({ title: "Balance Sheet", rows, metadata }))).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /OUT OF BALANCE: 100/); assert.match(sheet, /<v>900<\/v>/); assert.match(sheet, /<v>800<\/v>/);
});

test("Cash Flow workbook preserves the backend hierarchy and cash reconciliation", async () => {
  const rows = [{ section: "operating", account: { code: "4000", name: "Customer receipts" }, amount: 750 }, { section: "investing", account: { code: "1500", name: "Equipment" }, amount: -200 }, { section: "financing", account: { code: "3000", name: "Capital" }, amount: 100 }, { section: "Totals", total_operating: 750, total_investing: -200, total_financing: 100, total_unclassified: 0, net_cash_flow: 650, opening_cash: 350, closing_cash: 1000, difference: 0, balanced: true }];
  assert.equal(rows.at(-1).opening_cash + rows.at(-1).net_cash_flow, rows.at(-1).closing_cash);
  const sheet = storedZipEntries(await bytes(createXlsxWorkbook({ title: "Cash Flow Statement", rows, metadata }))).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /Cash Flows from Operating Activities/); assert.match(sheet, /Net Cash from Investing Activities/); assert.match(sheet, /Closing Cash Balance/); assert.match(sheet, /CASH RECONCILIATION BALANCED/); assert.match(sheet, /<v>1000<\/v>/);
});

test("comparison columns are not invented and filenames are safe", async () => {
  const sheet = storedZipEntries(await bytes(createXlsxWorkbook({ title: "Profit and Loss", rows: [], metadata }))).get("xl/worksheets/sheet1.xml");
  assert.doesNotMatch(sheet, /Comparison|Variance/);
  assert.equal(safeFilename("ACME / UK: Profit & Loss?.xlsx"), "ACME-UK-Profit-Loss-.xlsx");
});

test("journal print rules restore journal visibility and protect empty entries", async () => {
  const [page, css] = await Promise.all([readFile("src/pages/accounting/JournalDetailsPage.jsx", "utf8"), readFile("src/styles/journalDetails.css", "utf8")]);
  assert.match(page, /This journal has no lines to print/); assert.match(page, /disabled={!journal\.lines\?\.length}/); assert.match(page, /requestAnimationFrame\(\(\) => window\.print\(\)\)/);
  assert.match(css, /\.journal-details-page \* \{ visibility: visible; \}/); assert.match(css, /thead \{ display: table-header-group; \}/); assert.match(css, /@page[\s\S]*A4 portrait/);
});

test("shared financial statement presents all required report hierarchies and print data", async () => {
  const [page, css, reportBase] = await Promise.all([readFile("src/pages/accounting/LiveAccountingPages.jsx", "utf8"), readFile("src/styles/liveReports.css", "utf8"), readFile("accounting-backend/apps/accounting/services/reports/base.py", "utf8")]);
  for (const label of ["Income", "Cost of Sales", "Gross Profit", "Operating Expenses", "Net Profit", "Current Assets", "Non-current Assets", "Total Liabilities and Equity", "Cash Flows from Operating Activities", "Opening Cash Balance", "Closing Cash Balance"]) assert.match(page, new RegExp(label));
  assert.match(page, /Currency: \{currency\}/); assert.match(page, /financial-statement-table/); assert.match(page, /financial-statement-grand-total/);
  assert.match(css, /financial-statement-table thead \{ display: table-header-group; \}/); assert.match(css, /body \* \{ visibility: hidden; \}/); assert.match(css, /\.financial-statement, \.financial-statement \* \{ visibility: visible; \}/);
  assert.match(reportBase, /LEDGER_EFFECTIVE_JOURNAL_STATUSES/); assert.match(reportBase, /journal_entry__organisation=self\.organisation/);
});

test("Cash Flow drill-down exposes backend audit fields without recalculating amounts", async () => {
  const page = await readFile("src/pages/accounting/CashFlowBreakdownPage.jsx", "utf8");
  for (const field of ["journal_status", "reversal_of", "reversal_entry", "cash_accounts", "cash_flow_category", "row.amount"]) assert.match(page, new RegExp(field.replace(".", "\\.")));
  assert.match(page, /Cash or bank account/); assert.match(page, /Counterpart account/); assert.match(page, /Status \/ reversal/);
});
