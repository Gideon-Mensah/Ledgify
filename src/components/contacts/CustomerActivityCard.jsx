import {
  Activity,
  CheckCircle2,
  FileText,
  Mail,
  Pencil,
  ReceiptText,
  UserPlus,
} from "lucide-react";
import { Link } from "react-router-dom";


// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Formats created date.
const formatCreatedDate = (dateValue) => {
  if (!dateValue) {
    return "Date unavailable";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

// Gets activity icon.
const getActivityIcon = (title) => {
  const value = normaliseText(title);

  if (value.includes("payment")) {
    return CheckCircle2;
  }

  if (value.includes("email")) {
    return Mail;
  }

  if (value.includes("approved")) {
    return ReceiptText;
  }

  if (value.includes("updated")) {
    return Pencil;
  }

  if (value.includes("invoice")) {
    return FileText;
  }

  return Activity;
};

// Renders the customer activity card component.
function CustomerActivityCard({ customer, invoices = [] }) {
  const customerInvoices = invoices
    .filter((invoice) => {
      const matchesCustomerId =
        invoice.customerId !== undefined &&
        invoice.customerId !== null &&
        Number(invoice.customerId) === Number(customer.id);

      const matchesCustomerName =
        !invoice.customerId &&
        normaliseText(invoice.customer) ===
          normaliseText(customer.name);

      return matchesCustomerId || matchesCustomerName;
    })
    .sort(
      (invoiceA, invoiceB) =>
        Number(invoiceB.id) - Number(invoiceA.id)
    );

  const invoiceActivities = customerInvoices.flatMap(
    (invoice) =>
      (invoice.activity || []).map((entry) => ({
        ...entry,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      }))
  );

  const activities = [
    ...invoiceActivities,
    {
      id: `customer-created-${customer.id}`,
      title: "Customer created",
      description: `${customer.name} was added to the customer directory.`,
      date: formatCreatedDate(customer.createdAt),
      isCustomerActivity: true,
    },
  ].slice(0, 8);

  return (
    <section className="customer-activity-card">
      <div className="customer-activity-card__header">
        <div>
          <span>Account history</span>
          <h2>Recent Activity</h2>
        </div>

        <Activity size={21} />
      </div>

      <div className="customer-activity-list">
        {activities.map((entry) => {
          const Icon = entry.isCustomerActivity
            ? UserPlus
            : getActivityIcon(entry.title);

          return (
            <article
              key={`${entry.invoiceId || "customer"}-${entry.id}`}
              className="customer-activity-item"
            >
              <div className="customer-activity-item__icon">
                <Icon size={17} />
              </div>

              <div className="customer-activity-item__content">
                <div className="customer-activity-item__heading">
                  <strong>{entry.title}</strong>

                  {entry.invoiceId && (
                    <Link
                      to={`/sales/invoices/${entry.invoiceId}`}
                    >
                      {entry.invoiceNumber}
                    </Link>
                  )}
                </div>

                <p>{entry.description}</p>

                <time>{entry.date || "Date unavailable"}</time>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default CustomerActivityCard;
