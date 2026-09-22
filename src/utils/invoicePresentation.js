import { formatCurrency } from './currency.js';
import { isValidIsoDate } from './dateUtils.js';

export const invoiceMoney = (value, currency) => formatCurrency(value, currency, { locale: 'en-GB', format: { currencyDisplay: 'code' } });
export function invoiceDate(value) {
  if (!isValidIsoDate(value)) return value || '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}
export function invoiceQuantity(value) {
  // Trim storage precision without rounding meaningful decimal quantities.
  return String(value ?? '').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
export function invoiceRow(row, currency) {
  const [description, quantity, price, discount, tax, amount] = row;
  const lines = String(description).split('\n');
  const last = lines.at(-1);
  const match = last.match(/^(ZERO|EXEMPT|OUT_SCOPE)(?:: (.*))?$/);
  const treatment = match ? ({ ZERO: 'Zero-rated', EXEMPT: 'Exempt', OUT_SCOPE: 'Out of scope' }[match[1]] + (match[2] ? `: ${match[2]}` : '')) : '';
  if (match) lines.pop();
  return [lines.join('\n'), invoiceQuantity(quantity), invoiceMoney(price, currency), invoiceMoney(discount, currency), treatment ? `${invoiceMoney(tax, currency)}\n${treatment}` : invoiceMoney(tax, currency), invoiceMoney(amount, currency)];
}
export const invoiceStatus = status => String(status || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
