export const SUPPORTED_CURRENCY_CODES = Object.freeze(["GBP", "GHS", "USD", "EUR", "CAD", "AUD", "JPY", "NZD"]);

const legacyCodes = new Map([["GH¢", "GHS"], ["GH₵", "GHS"], ["GHC", "GHS"]]);

export function normaliseCurrencyCode(value, fallback = "GBP") {
  const raw = String(value || "").trim();
  const knownLegacy = legacyCodes.get(raw.toUpperCase()) || legacyCodes.get(raw);
  const candidate = knownLegacy || raw.toUpperCase();
  if (SUPPORTED_CURRENCY_CODES.includes(candidate)) return candidate;
  const safeFallback = SUPPORTED_CURRENCY_CODES.includes(String(fallback).toUpperCase()) ? String(fallback).toUpperCase() : "GBP";
  if (typeof console !== "undefined" && import.meta.env?.DEV) {
    console.warn("Ledgify received an invalid currency code; a display-only fallback was used.");
  }
  return safeFallback;
}

export function formatCurrency(value, currency, options = {}) {
  const code = normaliseCurrencyCode(currency, options.fallback || "GBP");
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(options.locale, { style: "currency", currency: code, ...options.format }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${code} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
}

export const CURRENCY_OPTIONS = Object.freeze([
  ["GBP", "GBP — Pound sterling"], ["GHS", "GHS — Ghanaian cedi"],
  ["USD", "USD — US dollar"], ["EUR", "EUR — Euro"],
  ["CAD", "CAD — Canadian dollar"], ["AUD", "AUD — Australian dollar"],
  ["JPY", "JPY — Japanese yen"], ["NZD", "NZD — New Zealand dollar"],
]);
