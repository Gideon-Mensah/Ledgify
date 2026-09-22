import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceDate, invoiceMoney, invoiceQuantity, invoiceRow, invoiceStatus } from '../src/utils/invoicePresentation.js';
test('invoice dates and quantities are display-only and retain meaningful precision', () => {
  assert.equal(invoiceDate('2026-09-22'), '22 Sept 2026');
  assert.equal(invoiceQuantity('1.0000'), '1');
  assert.equal(invoiceQuantity('1.5000'), '1.5');
  assert.equal(invoiceQuantity('0.0001'), '0.0001');
});
test('invoice formatting keeps document currency and backend line amounts', () => {
  for (const currency of ['GHS', 'GBP']) {
    const row = ['Office supplies\nOUT_SCOPE: Not registered', '1.5000', '500.0000', '25.00', '0.00', '725.00'];
    const original = structuredClone(row);
    const result = invoiceRow(row, currency);
    assert.equal(result[0], 'Office supplies');
    assert.equal(result[1], '1.5');
    assert.equal(result[3], invoiceMoney('25.00', currency));
    assert.equal(result[4], invoiceMoney('0', currency) + '\nOut of scope: Not registered');
    assert.equal(result[5], invoiceMoney('725.00', currency));
    assert.deepEqual(row, original);
    assert.ok(result[5].includes(currency));
  }
});
test('tax classifications remain distinct and status labels do not infer accounting state', () => {
  for (const [code, label] of [['ZERO', 'Zero-rated'], ['EXEMPT', 'Exempt'], ['OUT_SCOPE', 'Out of scope']]) assert.ok(invoiceRow(['Service\n'+code,'1','100','0','0','100'],'GHS')[4].endsWith(label));
  for (const status of ['draft', 'approved', 'partly_paid', 'paid', 'overdue', 'reversed']) assert.equal(invoiceStatus(status).toLowerCase(), status.replaceAll('_',' '));
});
