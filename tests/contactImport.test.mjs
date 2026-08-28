import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const modal=readFileSync(new URL("../src/components/contacts/ContactImportModal.jsx",import.meta.url),"utf8");
const customers=readFileSync(new URL("../src/pages/contacts/CustomersPage.jsx",import.meta.url),"utf8");
const suppliers=readFileSync(new URL("../src/components/suppliers/SupplierDirectory.jsx",import.meta.url),"utf8");
test("customer and supplier lists expose distinct permission-controlled imports",()=>{assert.match(customers,/import_customers/);assert.match(customers,/Import Customers/);assert.match(suppliers,/import_suppliers/);assert.match(suppliers,/Import Suppliers/);});
test("shared contact import modal provides the five-step secure preview workflow",()=>{for(const text of ["Download Template","Upload File","Validate and Preview","Confirm Import","Import Results","Download Error Report"])assert.match(modal,new RegExp(text));assert.match(modal,/type=\"file\" accept=\"\.xlsx\"/);assert.match(modal,/batch\.error_rows>0/);});
test("contact import supports stop and skip duplicate policies",()=>{assert.match(modal,/stop_on_existing/);assert.match(modal,/skip_existing/);assert.match(modal,/disabled=\{busy\|\|batch\.error_rows>0\}/);});
