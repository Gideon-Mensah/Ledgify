import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrency, normaliseCurrencyCode } from "../src/utils/currency.js";

test("ISO currency codes remain separate from display symbols", () => {
  for (const code of ["GHS", "GBP", "USD", "EUR", "CAD"]) assert.equal(normaliseCurrencyCode(code), code);
  const displayed = formatCurrency(1234.5, "GHS", { locale: "en-GH" });
  assert.match(displayed, /GH₵/);
  assert.match(displayed, /1,234\.50/);
});

test("legacy Ghanaian symbols and GHC normalise for display only", () => {
  for (const legacy of ["GH¢", "GH₵", "GHC"]) {
    assert.equal(normaliseCurrencyCode(legacy), "GHS");
    assert.doesNotThrow(() => formatCurrency(10, legacy, { locale: "en-GH" }));
  }
});

test("blank and unknown currency values use a safe display fallback", () => {
  assert.equal(normaliseCurrencyCode(""), "GBP");
  assert.equal(normaliseCurrencyCode("not-a-code"), "GBP");
  assert.doesNotThrow(() => formatCurrency(10, "¤"));
});
