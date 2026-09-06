import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { taxFilters, validateTaxPeriod, validateTaxRate, taxExportRows } from "../src/utils/taxReport.js";
import { createXlsxWorkbook } from "../src/utils/xlsxWorkbook.js";
import { formatCurrency } from "../src/utils/currency.js";

test("tax filters preserve explicit dates, view, search and sorting without timezone conversions", () => {
  const query = new URLSearchParams("start_date=2026-02-01&end_date=2026-02-28&tab=input&search=Supplier&ordering=tax_amount&tax_rate=rate-id");
  const filters = taxFilters(query, "2026-09-06");
  assert.equal(filters.start_date, "2026-02-01"); assert.equal(filters.direction, "INPUT");
  assert.equal(filters.search, "Supplier"); assert.equal(filters.ordering, "tax_amount"); assert.equal(filters.tax_rate, "rate-id");
  assert.equal(validateTaxPeriod(filters), "");
  assert.ok(validateTaxPeriod({ start_date: "2026-02-29", end_date: "2026-03-01" }));
  assert.ok(validateTaxPeriod({ start_date: "2026-03-02", end_date: "2026-03-01" }));
  assert.equal(taxFilters(new URLSearchParams("tab=adjustments"), "2026-09-06").adjustments_only, "true");
});

test("tax-rate validation rejects invalid percentages and effective dates", () => {
  const rate = { code: "STANDARD", name: "Standard", rate: "12.5000", effective_from: "2026-01-01", effective_to: "" };
  assert.equal(validateTaxRate(rate), "");
  for (const value of ["", "-1", "101", "bad", "Infinity"]) assert.ok(validateTaxRate({ ...rate, rate: value }));
  assert.ok(validateTaxRate({ ...rate, effective_to: "2025-12-31" }));
});

test("tax export retains signed backend values and all filtered rows plus included totals", async () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ id: index, transaction_date: "2026-08-31", document_number: `INV-${index}`, contact_name: "Customer", source_type: "invoice", direction: "OUTPUT", net_amount: "100.00", tax_amount: "10.00", gross_amount: "110.00", tax_rate_code: "STANDARD", tax_rate_percent: "10.0000", currency: "GHS", inclusion: "included", status: "POSTED" }));
  rows[13] = { ...rows[13], tax_amount: "-10.00", net_amount: "-100.00", gross_amount: "-110.00", is_reversal: true };
  const summary = { net_amount: "1200.00", tax_amount: "120.00", gross_amount: "1320.00" };
  const exported = taxExportRows(rows, summary);
  assert.equal(exported.length, 15); assert.equal(exported[13].tax_amount, "-10.00"); assert.equal(exported[14].tax_amount, "120.00");
  const blob = createXlsxWorkbook({ title: "Indirect Tax Report", rows: exported, metadata: { organisation: "Test", currency: "GHS", start_date: "2026-08-01", end_date: "2026-08-31", filters: "Output tax" } });
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const xml = buffer.toString();
  assert.match(xml, /<v>-10<\/v>/); assert.match(xml, /<v>120<\/v>/); assert.match(xml, /Included totals/);
  assert.match(xml, /Currency: GHS/); assert.match(xml, /Filters: Output tax/); assert.match(xml, /Generated:/);
  assert.doesNotMatch(xml, /£/); assert.doesNotMatch(formatCurrency(120, "GHS"), /£/);
});

test("tax UI has recoverable loading/errors, shared pagination, safe actions and complete print content", async () => {
  const page = await readFile("src/pages/tax/VatReturnsPage.jsx", "utf8"), settings = await readFile("src/pages/tax/TaxSettingsPage.jsx", "utf8");
  const css = await readFile("src/styles/taxWorkspace.css", "utf8");
  assert.match(page, /useTablePagination\(rows\)/); assert.match(page, /table\(rows, true\)/);
  assert.match(page, /Try again/); assert.match(page, /No tax activity/); assert.match(page, /AbortController/);
  assert.match(page, /sessionStorage.*organisation\?\.id/); assert.match(page, /Net tax refundable/);
  assert.match(page, /not submitted to an authority/); assert.match(page, /formatDisplayDate/);
  assert.match(settings, /submitting.current/); assert.match(settings, /Deactivate tax rate\?/);
  assert.match(settings, /manage_tax_rates/); assert.match(settings, /fieldset disabled=/);
  assert.match(css, /@page taxreport/); assert.match(css, /table-header-group/); assert.match(css, /break-inside:avoid/);
  assert.doesNotMatch(page + settings, /£|Intl.NumberFormat/);
});
