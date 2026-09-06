import { CURRENCY_OPTIONS, isValidCurrencyCode } from "../../utils/currency.js";

// Preserve the selected code even when it is outside the common UI shortlist.
// Never let a missing option make the browser visually select GBP instead.
export default function CurrencyOptions({ value, blankLabel = "Select currency" }) {
  return <>
    <option value="">{blankLabel}</option>
    {value && !CURRENCY_OPTIONS.some(([code]) => code === value) && <option value={value}>{value}{isValidCurrencyCode(value) ? "" : " — review invalid currency"}</option>}
    {CURRENCY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
  </>;
}
