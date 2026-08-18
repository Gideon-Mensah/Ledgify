import {
  BadgePoundSterling,
  CircleCheckBig,
  CreditCard,
  ReceiptText,
} from "lucide-react";

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) => {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(amount) || 0);
};

// Renders the customer summary cards component.
function CustomerSummaryCards({
  outstandingBalance = 0,
  totalSales = 0,
  totalPaid = 0,
  creditLimit = 0,
  currency = "GBP",
}) {
  const cards = [
    {
      label: "Outstanding Balance",
      value: formatCurrency(
        outstandingBalance,
        currency
      ),
      icon: BadgePoundSterling,
      modifier: "outstanding",
    },
    {
      label: "Total Sales",
      value: formatCurrency(
        totalSales,
        currency
      ),
      icon: ReceiptText,
      modifier: "sales",
    },
    {
      label: "Total Paid",
      value: formatCurrency(
        totalPaid,
        currency
      ),
      icon: CircleCheckBig,
      modifier: "paid",
    },
    {
      label: "Credit Limit",
      value: formatCurrency(
        creditLimit,
        currency
      ),
      icon: CreditCard,
      modifier: "credit",
    },
  ];

  return (
    <section
      className="customer-summary-grid"
      aria-label="Customer financial summary"
    >
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <article
            key={card.label}
            className="customer-summary-card"
          >
            <div
              className={`customer-summary-card__icon customer-summary-card__icon--${card.modifier}`}
            >
              <Icon size={21} />
            </div>

            <div className="customer-summary-card__content">
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </div>
          </article>
        );
      })}
    </section>
  );
}

export default CustomerSummaryCards;