import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page=readFileSync(new URL("../src/pages/accounting/OpeningBalancesPage.jsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/styles/openingBalances.css",import.meta.url),"utf8");

test("Opening Balances exposes the guided workflow without unsupported inventory",()=>{
  for(const step of ["Setup","Account Balances","Customers","Suppliers","Bank and Cash","Review and Post"])assert.match(page,new RegExp(`\\[\\"[^\\"]+\\",\\"${step}\\"\\]`));
  assert.doesNotMatch(page,/\["inventory","Inventory"\]/);
});

test("Opening Balances protects drafts and final posting",()=>{
  assert.match(page,/beforeunload/);
  assert.match(page,/Unsaved changes/);
  assert.match(page,/Save Draft/);
  assert.match(page,/Confirm and Post/);
  assert.match(page,/aria-modal="true"/);
  assert.match(page,/disabled=\{!balanced\|\|dirty\|\|state\.saving\}/);
});

test("account values survive filters and steps and expose accessible validation",()=>{
  assert.match(page,/values:\{\.\.\.current\.values/);
  assert.match(page,/aria-invalid=\{both\}/);
  assert.match(page,/Show entered only/);
  assert.match(page,/Clear filters/);
  assert.match(page,/onWheel=\{event=>event\.currentTarget\.blur\(\)\}/);
});

test("reconciliation, GHS-safe formatting, loading and responsive states are present",()=>{
  assert.match(page,/formatCurrency/);
  assert.match(page,/normaliseCurrencyCode/);
  assert.match(page,/Total debits/);
  assert.match(page,/Out of balance/);
  assert.match(page,/opening-skeleton/);
  assert.match(css,/@media \(max-width:760px\)/);
  assert.match(css,/position:sticky/);
});
