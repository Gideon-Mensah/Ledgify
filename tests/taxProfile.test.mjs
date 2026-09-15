import test from 'node:test';
import assert from 'node:assert/strict';
import { taxProfileOn } from '../src/utils/taxProfile.js';
const profiles=[
 {id:'ghana',status:'ACTIVE',effective_from:'2026-01-01',version:1,structure:'GHANA_GRA'},
 {id:'no-tax',status:'ACTIVE',effective_from:'2027-01-01',version:2,structure:'NO_TAX'},
 {id:'unreviewed',status:'DRAFT',effective_from:'2026-09-01',version:3,structure:'CUSTOM_INTERNATIONAL'},
];
test('scheduled migration changes the entry profile exactly at its effective date',()=>{
 assert.equal(taxProfileOn(profiles,'2026-12-31').id,'ghana');
 assert.equal(taxProfileOn(profiles,'2027-01-01').id,'no-tax');
 assert.equal(taxProfileOn(profiles,'2025-12-31'),null);
 assert.equal(taxProfileOn(profiles,'2026-09-12').id,'ghana');
});
test('profile selection preserves input history and supports leap-day boundaries',()=>{
 const history=[...profiles,{id:'leap',status:'ACTIVE',effective_from:'2028-02-29',version:4,structure:'CUSTOM_INTERNATIONAL'}];
 const copy=JSON.stringify(history);
 assert.equal(taxProfileOn(history,'2028-02-28').id,'no-tax');
 assert.equal(taxProfileOn(history,'2028-02-29').id,'leap');
 assert.equal(taxProfileOn(history,'2028-03-01').id,'leap');
 assert.equal(JSON.stringify(history),copy);
});
