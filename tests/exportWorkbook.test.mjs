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
