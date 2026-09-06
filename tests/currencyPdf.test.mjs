import test from "node:test";
import assert from "node:assert/strict";
import { createInvoicePdf } from "../src/utils/invoicePdf.js";
import { createBillPdf } from "../src/utils/billPdf.js";

const document = { invoiceNumber: "INV-CURRENCY", billNumber: "BILL-CURRENCY", customer: "Test Customer", supplier: "Test Supplier", issueDate: "2026-09-01", dueDate: "2026-09-30", subtotal: 1000, taxTotal: 0, total: 1000, amountPaid: 0, amountDue: 1000, items: [{ description: "Services", quantity: 1, unitPrice: 1000, discountAmount: 0, vatRate: 0, lineTotal: 1000 }] };

test("invoice and bill PDFs use the organisation ISO currency when the document currency is blank", () => {
  for (const code of ["GHS", "GBP", "USD", "EUR"]) {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => JSON.stringify({ selectedOrganisation: { base_currency: code } }) } });
    for (const create of [createInvoicePdf, createBillPdf]) {
      const pdf = create(document).output();
      assert.match(pdf, /^%PDF/);
      assert.ok(pdf.includes(code), `${code} is in PDF text`);
      if (code !== "GBP") assert.ok(!pdf.includes("£"));
      const explicit = create({ ...document, currency: "GBP" }).output();
      assert.ok(explicit.includes("GBP"));
    }
  }
});

test("invalid legacy codes do not crash PDF generation", () => {
  for (const currency of ["GH₵", "GHC", "XYZ"]) {
    for (const create of [createInvoicePdf, createBillPdf]) {
      const pdf = create({ ...document, currency }).output();
      assert.ok(pdf.includes(currency === "XYZ" ? "XYZ" : "GHS"));
      assert.ok(!pdf.includes("£"));
    }
  }
});
