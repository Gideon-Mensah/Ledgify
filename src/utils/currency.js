import { getOrganisationCurrencyContext } from "./organisationCurrency.js";

export const SUPPORTED_CURRENCY_CODES = Object.freeze(Intl.supportedValuesOf("currency"));
const legacyCodes = new Map([["GH¢", "GHS"], ["GH₵", "GHS"], ["GHC", "GHS"]]);
const warn = () => {
  if (import.meta.env?.DEV) console.warn("Ledgify received invalid currency or monetary data; review the API currency and amount fields.");
};

// Normalisation never replaces unknown data with a valid, saveable currency.
export function normaliseCurrencyCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return legacyCodes.get(code) || code;
}
export function isValidCurrencyCode(value) {
  return SUPPORTED_CURRENCY_CODES.includes(String(value ?? "").trim().toUpperCase());
}
export function resolveCurrencyCode(value, organisationCurrency = getOrganisationCurrencyContext().base_currency) {
  return normaliseCurrencyCode(String(value ?? "").trim() ? value : organisationCurrency);
}
export function parseMonetaryAmount(value) {
  if (typeof value === "bigint") return value;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}
export function formatCurrency(value, currency, localeOrOptions = {}, extraOptions = {}) {
  const context = getOrganisationCurrencyContext();
  const options = typeof localeOrOptions === "string" ? { locale: localeOrOptions, format: extraOptions } : (localeOrOptions || {});
  const code = resolveCurrencyCode(currency, options.fallback ?? context.base_currency);
  const amount = parseMonetaryAmount(value);
  if (amount === null) { warn(); return "—"; }
  if (!code) return "—";
  if (!isValidCurrencyCode(code)) { warn(); return `${/^[A-Z]{3}$/.test(code) ? code : "Unknown currency"} ${amount}`; }
  // Intl accepts decimal strings without first rounding them through binary Number.
  const exactAmount = typeof value === "string" ? value.trim() : amount;
  const settings = { ...options.format, style: "currency", currency: code };
  try {
    return new Intl.NumberFormat(options.locale || context.locale, settings).format(exactAmount);
  } catch {
    warn();
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(exactAmount); }
    catch { return `${code} ${amount}`; }
  }
}
export function getCurrencySymbol(currency, locale) {
  const code = resolveCurrencyCode(currency);
  if (!code) return "—";
  if (!isValidCurrencyCode(code)) { warn(); return "Unknown currency"; }
  try { return new Intl.NumberFormat(locale || getOrganisationCurrencyContext().locale, { style: "currency", currency: code }).formatToParts(0).find((part) => part.type === "currency").value; }
  catch { return code; }
}
export function currencyNumberFormat(currency) {
  const code = resolveCurrencyCode(currency);
  if (!isValidCurrencyCode(code)) return '#,##0.00;(#,##0.00);0.00';
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
  const number = `#,##0${digits ? `.${"0".repeat(digits)}` : ""}`;
  return `"${code}" ${number};("${code}" ${number});"${code}" ${digits ? `0.${"0".repeat(digits)}` : "0"}`;
}

export const CURRENCY_OPTIONS = Object.freeze([
  ["GBP", "GBP — Pound sterling"], ["GHS", "GHS — Ghanaian cedi"],
  ["USD", "USD — US dollar"], ["EUR", "EUR — Euro"],
  ["CAD", "CAD — Canadian dollar"], ["AUD", "AUD — Australian dollar"],
  ["JPY", "JPY — Japanese yen"], ["NZD", "NZD — New Zealand dollar"],
]);
