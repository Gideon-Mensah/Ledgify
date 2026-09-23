import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerDocumentRows } from '../src/utils/ledgerDocumentRows.js';
import { presentReport } from '../src/utils/reportPresentation.js';
import { formatCurrency } from '../src/utils/currency.js';

test('Trade Debtors opening, movement and closing values stay unchanged in ledger exports', () => {
 const ledgers=[{account:{id:'internal',code:'1200',name:'Trade Debtors'},opening_balance:'14800.00',total_debit:'5000.00',total_credit:'0.00',balance:'19800.00',transactions:[{date:'2026-09-22',entry_number:'JE-1',reference:'ABS-PO-001',description:'Invoice',debit:'5000.00',credit:'0.00',running_balance:'19800.00'}]}];
 const before=structuredClone(ledgers);
 const rows=ledgerDocumentRows(ledgers);
 assert.equal(rows[0].balance,'14800.00');assert.equal(rows[1].debit,'5000.00');assert.equal(rows[1].balance,'19800.00');
 const printed=presentReport(rows,'General Ledger',{report_data:ledgers});
 assert.equal(printed[0].rows[0].balance,'14800.00');assert.equal(printed[0].rows[1].balance,'19800.00');assert.deepEqual(ledgers,before);
});
test('ledger amounts use shared dynamic currency formatting without storage precision', () => {
 for(const currency of ['GHS','GBP','USD'])for(const amount of ['5.0000','5000.0000','500000.0000','12500000.0000']){
  const text=formatCurrency(amount,currency,{locale:'en-GB',format:{currencyDisplay:'code'}});
  assert.ok(text.includes(currency));assert.ok(text.endsWith('.00'));assert.ok(!text.endsWith('.0000'));
 }
});
