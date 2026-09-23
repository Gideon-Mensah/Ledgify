import test from 'node:test';
import assert from 'node:assert/strict';
import { statementStatus, statementAmount, importSummary } from '../src/utils/bankImportPresentation.js';
import { formatCurrency } from '../src/utils/currency.js';

test('bank review distinguishes exact/possible duplicates, errors and balance information', () => {
  assert.equal(statementStatus({ status: 'duplicate', duplicate_kind: 'possible' }), 'Possible duplicate');
  assert.equal(statementStatus({ status: 'duplicate', duplicate_kind: 'exact' }), 'Exact duplicate');
  assert.equal(statementStatus({ status: 'information' }), 'Statement balance');
  assert.equal(statementStatus({ status: 'rejected' }), 'Needs attention');
  assert.equal(statementStatus({ status: 'ready' }), 'Ready');
});
test('balance-only and invalid rows never appear as receipts in preview', () => {
  for (const status of ['rejected', 'information', 'pending']) {
    assert.equal(statementAmount({ status, transaction_type: 'money_in', amount: '32500.00' }, 'money_in'), null);
  }
});
test('preview preserves backend decimal strings and separates money in and money out', () => {
  const row = { status: 'ready', transaction_type: 'money_out', amount: '9999999999999999.99' };
  assert.equal(statementAmount(row, 'money_out'), '9999999999999999.99');
  assert.equal(statementAmount(row, 'money_in'), null);
  const formatted = formatCurrency(row.amount, 'GHS', { locale: 'en-GB', format: { currencyDisplay: 'code' } });
  assert.match(formatted, /GHS/); assert.match(formatted, /9,999,999,999,999,999\.99/);
});
test('summary uses server counts including information rows instead of page length', () => {
  assert.deepEqual(importSummary({ ready_rows: 200, duplicate_rows: 2, rejected_rows: 3, metadata: { information_rows: 2 }, rows: [] }), { ready: 200, duplicates: 2, rejected: 3, information: 2 });
});
test('bank preview currency formatting uses the supplied account currency', () => {
  for (const code of ['GHS', 'GBP', 'USD']) {
    assert.match(formatCurrency('5000.01', code, { locale: 'en-GB', format: { currencyDisplay: 'code' } }), new RegExp(`${code}.*5,000\\.01`));
  }
});
