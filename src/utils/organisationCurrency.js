// Read the same persisted selection used to scope API requests. No currency is
// invented while authentication is loading. Call at use time, never cache it.
export function getOrganisationCurrencyContext() {
  try {
    const organisation = JSON.parse(globalThis.localStorage?.getItem("ledgify.auth") || "null")?.selectedOrganisation;
    return {
      base_currency: organisation?.base_currency || "",
      locale: organisation?.locale || undefined,
      country_code: organisation?.country_code || "",
      organisation_id: organisation?.id,
    };
  } catch {
    return { base_currency: "", locale: undefined, country_code: "" };
  }
}
export function getOrganisationCurrency() {
  return getOrganisationCurrencyContext().base_currency;
}
