import {
  Building2,
  CreditCard,
  Globe,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  User,
} from "lucide-react";

// Performs the display value task.
const displayValue = (value) => {
  const text = String(value ?? "").trim();
  return text || "Not provided";
};

// Formats currency.
const formatCurrency = (
  value,
  currency = "GBP"
) => {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(value) || 0);
};

// Gets full address.
const getFullAddress = (address = {}) => {
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.county,
    address.postcode,
    address.country,
  ]
    .map((value) =>
      String(value || "").trim()
    )
    .filter(Boolean);

  return parts.length > 0
    ? parts.join(", ")
    : "Not provided";
};

// Renders the information row component.
function InformationRow({
  icon: Icon,
  label,
  children,
}) {
  return (
    <div className="customer-information-row">
      <div className="customer-information-row__icon">
        <Icon size={18} />
      </div>

      <div className="customer-information-row__content">
        <span>{label}</span>
        <div>{children}</div>
      </div>
    </div>
  );
}

// Renders the customer information cards component.
function CustomerInformationCards({
  customer,
}) {
  const currency =
    customer.currency || "GBP";

  return (
    <section className="customer-information-grid">
      <article className="customer-information-card">
        <div className="customer-information-card__header">
          <div>
            <span>Customer profile</span>
            <h2>Contact Information</h2>
          </div>

          <User size={21} />
        </div>

        <div className="customer-information-card__body">
          <InformationRow
            icon={Building2}
            label="Company name"
          >
            {displayValue(customer.name)}
          </InformationRow>

          <InformationRow
            icon={User}
            label="Contact person"
          >
            {displayValue(
              customer.contactName
            )}
          </InformationRow>

          <InformationRow
            icon={Mail}
            label="Email address"
          >
            {customer.email ? (
              <a
                href={`mailto:${customer.email}`}
              >
                {customer.email}
              </a>
            ) : (
              "Not provided"
            )}
          </InformationRow>

          <InformationRow
            icon={Phone}
            label="Phone number"
          >
            {customer.phone ? (
              <a
                href={`tel:${customer.phone}`}
              >
                {customer.phone}
              </a>
            ) : (
              "Not provided"
            )}
          </InformationRow>

          <InformationRow
            icon={Globe}
            label="Website"
          >
            {customer.website ? (
              <a
                href={
                  customer.website.startsWith(
                    "http"
                  )
                    ? customer.website
                    : `https://${customer.website}`
                }
                target="_blank"
                rel="noreferrer"
              >
                {customer.website}
              </a>
            ) : (
              "Not provided"
            )}
          </InformationRow>

          <InformationRow
            icon={MapPin}
            label="Address"
          >
            {getFullAddress(
              customer.address
            )}
          </InformationRow>
        </div>
      </article>

      <article className="customer-information-card">
        <div className="customer-information-card__header">
          <div>
            <span>Account settings</span>
            <h2>Financial Information</h2>
          </div>

          <CreditCard size={21} />
        </div>

        <div className="customer-information-card__body">
          <InformationRow
            icon={ReceiptText}
            label="Account number"
          >
            {displayValue(
              customer.accountNumber
            )}
          </InformationRow>

          <InformationRow
            icon={CreditCard}
            label="Payment terms"
          >
            {displayValue(
              customer.paymentTerms
            )}
          </InformationRow>

          <InformationRow
            icon={CreditCard}
            label="Currency"
          >
            {displayValue(currency)}
          </InformationRow>

          <InformationRow
            icon={ReceiptText}
            label="Tax number"
          >
            {displayValue(
              customer.taxNumber
            )}
          </InformationRow>

          <InformationRow
            icon={ReceiptText}
            label="Default income account"
          >
            {displayValue(
              customer.defaultIncomeAccount
            )}
          </InformationRow>

          <InformationRow
            icon={CreditCard}
            label="Credit limit"
          >
            {formatCurrency(
              customer.creditLimit,
              currency
            )}
          </InformationRow>
        </div>
      </article>
    </section>
  );
}

export default CustomerInformationCards;