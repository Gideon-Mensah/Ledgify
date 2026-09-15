import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { formatCurrency, normaliseCurrencyCode, isValidCurrencyCode, getCurrencySymbol, resolveCurrencyCode, currencyNumberFormat } from "../src/utils/currency.js";
import { getOrganisationCurrencyContext } from "../src/utils/organisationCurrency.js";

const select = (code, locale = "en-GB") => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => JSON.stringify({ selectedOrganisation: code ? { id: code, base_currency: code, locale, country_code: code === "GHS" ? "GH" : "GB" } : null }) } });
};

test("organisation currencies, invoice precedence, and switching use the current selection", () => {
  for (const code of ["GBP", "GHS", "USD", "EUR"]) {
    select(code);
    assert.equal(resolveCurrencyCode(""), code);
    assert.equal(formatCurrency("1000", ""), new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(1000));
    assert.equal(formatCurrency(1000, "GBP"), "£1,000.00");
  }
  select("GHS", "en-GH");
  assert.match(formatCurrency(1000), /GH₵/);
  assert.doesNotMatch(formatCurrency(1000), /£/);
  assert.equal(getCurrencySymbol("GHS", "en-GH"), "GH₵");
  assert.equal(getOrganisationCurrencyContext().country_code, "GH");
  select(null);
  assert.equal(formatCurrency(1000), "—");
});

test("legacy Ghanaian values normalise without inventing saveable fallbacks", () => {
  for (const legacy of ["GH¢", "GH₵", "GHC"]) {
    assert.equal(normaliseCurrencyCode(legacy), "GHS");
    assert.doesNotMatch(formatCurrency(10, legacy), /£/);
    assert.equal(isValidCurrencyCode(legacy), false);
  }
  assert.equal(normaliseCurrencyCode(""), "");
  assert.equal(normaliseCurrencyCode("XYZ"), "XYZ");
  assert.equal(formatCurrency(10, "¤"), "Unknown currency 10");
  assert.doesNotThrow(() => formatCurrency(10, "GHS", { locale: "invalid_locale" }));
});

test("amount validation preserves zero, negative and large values and rejects invalid data", () => {
  for (const value of [0, -1234.5, "999999999999.99", "0.00", "-0.00"]) {
    assert.equal(formatCurrency(value, "GHS", "en-GH"), new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(Number(value)));
  }
  for (const value of [null, undefined, "", " ", "bad", NaN, Infinity, {}, false, "£10", "0x10"]) assert.equal(formatCurrency(value, "GBP"), "—");
  assert.equal(formatCurrency(1, "JPY", "en-US"), "JPY 1");
  assert.equal(formatCurrency(1, "USD", "en-US"), "$1.00");
  assert.equal(formatCurrency(1, "BHD", "en-US"), "BHD 1");
  assert.equal(isValidCurrencyCode("BHD"), false);
  assert.equal(isValidCurrencyCode("JPY"), false);
});

test("production screens centralise currency formatting and contain no pound symbols", async () => {
  for (const directory of ["src/pages", "src/components"]) {
    for (const entry of await readdir(directory, { recursive: true })) {
      if (!/\.(jsx|js|css)$/.test(entry)) continue;
      const source = await readFile(`${directory}/${entry}`, "utf8");
      assert.doesNotMatch(source, /£/, entry);
      assert.doesNotMatch(source, /style:\s*["']currency["']/, entry);
    }
  }
  for (const name of ["invoice", "bill", "quote", "creditNote"]) {
    const source = await readFile(`src/utils/${name}Pdf.js`, "utf8");
    assert.match(source, /fetchDocumentPdf/);
    assert.doesNotMatch(source, /calculate.*Totals|company\.name/);
    assert.doesNotMatch(source, /"GBP"/);
  }
  const layout = await readFile("src/components/layout/MainLayout.jsx", "utf8");
  assert.match(layout, /Outlet key=\{selectedOrganisation\?\.id/);
  const api = await readFile("src/services/api.js", "utf8");
  assert.match(api, /Organisation changed while loading data/);
});

test("decimal string formatting does not round large financial values through Number", () => {
  assert.match(formatCurrency("9999999999999999.99", "GHS", "en-GB"), /9,999,999,999,999,999\.99/);
});
