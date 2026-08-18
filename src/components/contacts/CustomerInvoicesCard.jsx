import {
  ArrowRight,
  FileText,
  Plus,
} from "lucide-react";
import { Link } from "react-router-dom";


// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(amount) || 0);

// Calculates invoice total.
const calculateInvoiceTotal = (invoice) => {
  const items = invoice.items || [];

  return items.reduce((total, item) => {
    const quantity =
      Number(item.quantity) || 0;

    const unitPrice =
      Number(item.unitPrice) || 0;

    const vatRate =
      Number(item.vatRate) || 0;

    const lineSubtotal =
      quantity * unitPrice;

    if (
      invoice.pricingMode === "inclusive"
    ) {
      return total + lineSubtotal;
    }

    if (
      invoice.pricingMode === "no-tax"
    ) {
      return total + lineSubtotal;
    }

    const vatAmount =
      lineSubtotal * (vatRate / 100);

    return (
      total +
      lineSubtotal +
      vatAmount
    );
  }, 0);
};

// Gets status class.
const getStatusClass = (status) => {
  const normalisedStatus =
    normaliseText(status);

  if (normalisedStatus === "paid") {
    return "paid";
  }

  if (
    normalisedStatus ===
      "awaiting payment" ||
    normalisedStatus === "sent"
  ) {
    return "awaiting";
  }

  if (
    normalisedStatus === "overdue"
  ) {
    return "overdue";
  }

  if (
    normalisedStatus === "draft"
  ) {
    return "draft";
  }

  return "default";
};

// Renders the customer invoices card component.
function CustomerInvoicesCard({
  customer,
  invoices = [],
}) {
  const customerInvoices = invoices
    .filter((invoice) => {
      const matchesCustomerId =
        invoice.customerId !==
          undefined &&
        invoice.customerId !== null &&
        Number(invoice.customerId) ===
          Number(customer.id);

      const matchesCustomerName =
        !invoice.customerId &&
        normaliseText(
          invoice.customer
        ) ===
          normaliseText(customer.name);

      return (
        matchesCustomerId ||
        matchesCustomerName
      );
    })
    .sort(
      (invoiceA, invoiceB) =>
        Number(invoiceB.id) -
        Number(invoiceA.id)
    );

  const recentInvoices =
    customerInvoices.slice(0, 5);

  return (
    <section className="customer-invoices-card">
      <div className="customer-invoices-card__header">
        <div>
          <span>Sales activity</span>
          <h2>Recent Invoices</h2>
        </div>

        <div className="customer-invoices-card__actions">
          <Link
            to="/sales/invoices"
            className="customer-invoices-link"
          >
            View all
            <ArrowRight size={16} />
          </Link>

          <Link
            to={`/sales/invoices/new?customerId=${customer.id}`}
            className="customer-invoices-button"
          >
            <Plus size={16} />
            New Invoice
          </Link>
        </div>
      </div>

      {recentInvoices.length > 0 ? (
        <div className="customer-invoices-table-wrapper">
          <table className="customer-invoices-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Total</th>
                <th>Balance</th>
              </tr>
            </thead>

            <tbody>
              {recentInvoices.map(
                (invoice) => {
                  const total =
                    calculateInvoiceTotal(
                      invoice
                    );

                  const amountPaid =
                    Number(
                      invoice.amountPaid
                    ) || 0;

                  const balance = Math.max(
                    total - amountPaid,
                    0
                  );

                  return (
                    <tr key={invoice.id}>
                      <td>
                        <Link
                          to={`/sales/invoices/${invoice.id}`}
                          className="customer-invoice-number"
                        >
                          <FileText
                            size={16}
                          />

                          {
                            invoice.invoiceNumber
                          }
                        </Link>

                        <span className="customer-invoice-reference">
                          {invoice.reference ||
                            "No reference"}
                        </span>
                      </td>

                      <td>
                        {invoice.issueDate ||
                          "—"}
                      </td>

                      <td>
                        {invoice.dueDate ||
                          "—"}
                      </td>

                      <td>
                        <span
                          className={`customer-invoice-status customer-invoice-status--${getStatusClass(
                            invoice.status
                          )}`}
                        >
                          {invoice.status}
                        </span>
                      </td>

                      <td>
                        {formatCurrency(
                          total,
                          invoice.currency ||
                            customer.currency ||
                            "GBP"
                        )}
                      </td>

                      <td>
                        <strong>
                          {formatCurrency(
                            balance,
                            invoice.currency ||
                              customer.currency ||
                              "GBP"
                          )}
                        </strong>
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="customer-invoices-empty">
          <div className="customer-invoices-empty__icon">
            <FileText size={25} />
          </div>

          <h3>No invoices yet</h3>

          <p>
            Create the first invoice for{" "}
            {customer.name}.
          </p>

          <Link
            to={`/sales/invoices/new?customerId=${customer.id}`}
            className="page-primary-button"
          >
            <Plus size={17} />
            Create Invoice
          </Link>
        </div>
      )}
    </section>
  );
}

export default CustomerInvoicesCard;
