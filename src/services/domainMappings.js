// Translate backend field names into the stable shapes used by existing frontend screens.

import { formatDisplayDate, toApiDate } from "../utils/dateUtils.js";

const paymentTermsToApi = {
  "Due immediately": "immediate",
  "7 days": "7_days",
  "14 days": "14_days",
  "30 days": "30_days",
  "60 days": "60_days",
};

const paymentTermsFromApi = Object.fromEntries(
  Object.entries(paymentTermsToApi).map(([label, value]) => [value, label])
);

export function toDateInput(value) {
  return value ? toApiDate(value) : "";
}

export function toDisplayDate(value, locale = "en-GB") {
  return value ? formatDisplayDate(value, locale) : "";
}

export function mapContact(contact) {
  return {
    id: contact.id,
    name: contact.name,
    accountNumber: contact.account_number || "",
    contactName: contact.contact_name || "",
    email: contact.email || "",
    phone: contact.phone || "",
    website: contact.website || "",
    registrationNumber: contact.registration_number || "",
    taxNumber: contact.tax_number || "",
    isCustomer: contact.is_customer,
    isSupplier: contact.is_supplier,
    paymentTerms: paymentTermsFromApi[contact.payment_terms] || contact.payment_terms,
    currency: contact.currency || "GBP",
    creditLimit: contact.credit_limit,
    status: contact.status === "active" ? "Active" : contact.status === "inactive" ? "Inactive" : "Archived",
    notes: contact.notes || "",
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    address: {
      line1: contact.address_line_1 || "",
      line2: contact.address_line_2 || "",
      city: contact.city || "",
      county: contact.region || "",
      postcode: contact.postal_code || "",
      country: contact.country_code || "",
    },
  };
}

export function contactPayload(contact, type) {
  return {
    name: contact.name?.trim(),
    account_number: contact.accountNumber?.trim() || "",
    contact_name: contact.contactName?.trim() || "",
    email: contact.email?.trim() || "",
    phone: contact.phone?.trim() || "",
    website: contact.website?.trim() || "",
    registration_number: contact.registrationNumber?.trim() || "",
    tax_number: contact.taxNumber?.trim() || "",
    is_customer: type === "customer" || Boolean(contact.isCustomer),
    is_supplier: type === "supplier" || Boolean(contact.isSupplier),
    payment_terms: paymentTermsToApi[contact.paymentTerms] || contact.paymentTerms || "30_days",
    currency: contact.currency || "GBP",
    credit_limit: contact.creditLimit === "" ? null : contact.creditLimit ?? null,
    address_line_1: contact.address?.line1 || "",
    address_line_2: contact.address?.line2 || "",
    city: contact.address?.city || "",
    region: contact.address?.county || "",
    postal_code: contact.address?.postcode || "",
    country_code: String(contact.address?.country || "").length === 2 ? contact.address.country.toUpperCase() : "GB",
    notes: contact.notes || "",
    status: String(contact.status || "active").toLowerCase(),
  };
}

export function statusLabel(status) {
  return ({
    draft: "Draft",
    awaiting_approval: "Awaiting approval",
    approved: "Awaiting payment",
    sent: "Awaiting payment",
    partly_paid: "Part paid",
    paid: "Paid",
    void: "Voided",
    written_off: "Written off",
  })[status] || status;
}
