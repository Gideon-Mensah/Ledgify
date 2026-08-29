import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const page=readFileSync(new URL("../src/pages/payroll/PayrollPage.jsx",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/services/payrollApiService.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/styles/payrollReports.css",import.meta.url),"utf8");

test("payroll reports expose all backend report types and useful filters",()=>{
 for(const label of ["Summary","Employee earnings","Payroll liability","Year to date"])assert.match(page,new RegExp(label));
 assert.match(page,/Payment date from/);assert.match(page,/Calendar year/);assert.match(page,/Run report/);
 assert.match(service,/summary:\(filters\)/);assert.match(service,/earnings:\(filters\)/);assert.match(service,/liability:\(filters\)/);
});
test("payroll report uses organisation currency and export-safe numeric rows",()=>{
 assert.match(page,/selectedOrganisation\?\.base_currency/);assert.match(page,/formatCurrency/);assert.match(page,/gross_pay:Number/);assert.match(page,/ReportExportMenu/);
});
test("payroll report has loading, empty, error, totals and responsive states",()=>{
 for(const label of ["Preparing payroll report","No payroll activity found","Report unavailable","Report total"])assert.match(page,new RegExp(label));
 assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/overflow:auto/);assert.match(css,/font-variant-numeric/);
});
test("payroll reporting is lazy and no longer requested during payroll startup",()=>{
 assert.doesNotMatch(page,/accountingApiService\.accounts\(\{status:"active"\}\),payrollApiService\.summary/);
 assert.match(page,/tab==="reports"&&<PayrollReports\/>/);
});
