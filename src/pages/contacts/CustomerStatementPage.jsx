import {
  ArrowLeft,
  FileText,
  Printer,
} from "lucide-react";
import {
  useMemo,
  useState,
} from "react";
import {
  Link,
  useParams,
} from "react-router-dom";

import {
  getCustomerById,
} from "../../services/customerService";

import {
  getInvoices,
} from "../../services/invoiceService";

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Formats currency.
const formatCurrency = (
  value,
  currency = "GBP"
) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(value) || 0);

// Formats date.
const formatDate = (value) => {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(date);
};

// Gets invoice date.
const getInvoiceDate = (invoice) => {
  const issueDate =
    new Date(invoice.issueDate);

  if (
    !Number.isNaN(
      issueDate.getTime()
    )
  ) {
    return issueDate;
  }

  const createdDate =
    new Date(invoice.createdAt);

  if (
    !Number.isNaN(
      createdDate.getTime()
    )
  ) {
    return createdDate;
  }

  return null;
};

// Calculates invoice total.
const calculateInvoiceTotal = (
  invoice
) => {
  return (invoice.items || []).reduce(
    (total, item) => {
      const quantity =
        Number(item.quantity) || 0;

      const unitPrice =
        Number(item.unitPrice) || 0;

      const discountRate =
        Number(item.discountRate) || 0;

      const vatRate =
        Number(item.vatRate) || 0;

      const grossAmount =
        quantity * unitPrice;

      const discountAmount =
        grossAmount *
        (discountRate / 100);

      const discountedAmount =
        grossAmount -
        discountAmount;

      if (
        invoice.pricingMode ===
          "inclusive" ||
        invoice.pricingMode ===
          "no-tax"
      ) {
        return (
          total +
          discountedAmount
        );
      }

      const vatAmount =
        discountedAmount *
        (vatRate / 100);

      return (
        total +
        discountedAmount +
        vatAmount
      );
    },
    0
  );
};

// Performs the belongs to customer task.
const belongsToCustomer = (
  invoice,
  customer
) => {
  const hasCustomerId =
    invoice.customerId !==
      undefined &&
    invoice.customerId !== null &&
    invoice.customerId !== "";

  if (hasCustomerId) {
    return (
      Number(invoice.customerId) ===
      Number(customer.id)
    );
  }

  return (
    normaliseText(invoice.customer) ===
    normaliseText(customer.name)
  );
};

// Gets address lines.
const getAddressLines = (
  address = {}
) =>
  [
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

// Gets start of year.
const getStartOfYear = () => {
  const now = new Date();

  return `${now.getFullYear()}-01-01`;
};

// Gets today.
const getToday = () =>
  new Date()
    .toISOString()
    .split("T")[0];

// Renders the customer statement page component.
function CustomerStatementPage() {
  const { customerId } = useParams();

  const customer =
    getCustomerById(customerId);

  const [fromDate, setFromDate] =
    useState(getStartOfYear);

  const [toDate, setToDate] =
    useState(getToday);

  const statementData =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      if (!customer) {
        return {
          rows: [],
          totalInvoiced: 0,
          totalPaid: 0,
          closingBalance: 0,
        };
      }

      const startDate =
        fromDate
          ? new Date(
              `${fromDate}T00:00:00`
            )
          : null;

      const endDate =
        toDate
          ? new Date(
              `${toDate}T23:59:59`
            )
          : null;

      const invoices = getInvoices()
        .filter((invoice) =>
          belongsToCustomer(
            invoice,
            customer
          )
        )
        .filter((invoice) => {
          const invoiceDate =
            getInvoiceDate(invoice);

          if (!invoiceDate) {
            return true;
          }

          if (
            startDate &&
            invoiceDate < startDate
          ) {
            return false;
          }

          if (
            endDate &&
            invoiceDate > endDate
          ) {
            return false;
          }

          return true;
        })
        .sort((invoiceA, invoiceB) => {
          const dateA =
            getInvoiceDate(invoiceA);

          const dateB =
            getInvoiceDate(invoiceB);

          return (
            (dateA?.getTime() || 0) -
            (dateB?.getTime() || 0)
          );
        });

      let runningBalance = 0;

      const rows = invoices.map(
        (invoice) => {
          const total =
            calculateInvoiceTotal(
              invoice
            );

          const amountPaid =
            Number(
              invoice.amountPaid
            ) || 0;

          const outstanding =
            Math.max(
              total - amountPaid,
              0
            );

          runningBalance +=
            outstanding;

          return {
            ...invoice,
            total,
            amountPaid,
            outstanding,
            runningBalance,
          };
        }
      );

      return {
        rows,

        totalInvoiced: rows.reduce(
          (total, invoice) =>
            total + invoice.total,
          0
        ),

        totalPaid: rows.reduce(
          (total, invoice) =>
            total +
            invoice.amountPaid,
          0
        ),

        closingBalance:
          runningBalance,
      };
    }, [
      customer,
      fromDate,
      toDate,
    ]);

  if (!customer) {
    return (
      <div className="customer-not-found">
        <h1>
          Customer not found
        </h1>

        <p>
          The requested customer does
          not exist.
        </p>

        <Link
          to="/contacts/customers"
          className="page-primary-button"
        >
          <ArrowLeft size={17} />
          Return to Customers
        </Link>
      </div>
    );
  }

  const currency =
    customer.currency || "GBP";

  const addressLines =
    getAddressLines(
      customer.address
    );

  return (
    <div className="customer-statement-page">
      <div className="customer-statement-topbar">
        <Link
          to={`/contacts/customers/${customer.id}`}
          className="edit-customer-back-link"
        >
          <ArrowLeft size={17} />
          Back to Customer
        </Link>

        <button
          type="button"
          className="page-primary-button"
          onClick={() =>
            window.print()
          }
        >
          <Printer size={17} />
          Print Statement
        </button>
      </div>

      <div className="customer-statement-filters">
        <div className="customer-statement-filter">
          <label htmlFor="fromDate">
            From
          </label>

          <input
            id="fromDate"
            type="date"
            value={fromDate}
            onChange={(event) =>
              setFromDate(
                event.target.value
              )
            }
          />
        </div>

        <div className="customer-statement-filter">
          <label htmlFor="toDate">
            To
          </label>

          <input
            id="toDate"
            type="date"
            value={toDate}
            onChange={(event) =>
              setToDate(
                event.target.value
              )
            }
          />
        </div>
      </div>

      <section className="customer-statement-print-area">
        <header className="customer-statement-header">
          <div>
            <div className="customer-statement-brand">
              <FileText size={22} />
              Ledgify
            </div>

            <h1>
              Customer Statement
            </h1>

            <p>
              Statement period:{" "}
              {formatDate(fromDate)} to{" "}
              {formatDate(toDate)}
            </p>
          </div>

          <div className="customer-statement-customer">
            <span>
              Statement for
            </span>

            <strong>
              {customer.name}
            </strong>

            {customer.contactName && (
              <p>
                {customer.contactName}
              </p>
            )}

            {customer.email && (
              <p>{customer.email}</p>
            )}

            {addressLines.map(
              (line) => (
                <p key={line}>
                  {line}
                </p>
              )
            )}
          </div>
        </header>

        <div className="customer-statement-summary">
          <article>
            <span>
              Total Invoiced
            </span>

            <strong>
              {formatCurrency(
                statementData.totalInvoiced,
                currency
              )}
            </strong>
          </article>

          <article>
            <span>
              Total Paid
            </span>

            <strong>
              {formatCurrency(
                statementData.totalPaid,
                currency
              )}
            </strong>
          </article>

          <article>
            <span>
              Closing Balance
            </span>

            <strong>
              {formatCurrency(
                statementData.closingBalance,
                currency
              )}
            </strong>
          </article>
        </div>

        <div className="customer-statement-table-wrapper">
          <table className="customer-statement-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Invoiced</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Balance</th>
              </tr>
            </thead>

            <tbody>
              {statementData.rows.length >
              0 ? (
                statementData.rows.map(
                  (invoice) => (
                    <tr
                      key={invoice.id}
                    >
                      <td>
                        {invoice.issueDate ||
                          formatDate(
                            invoice.createdAt
                          )}
                      </td>

                      <td>
                        <Link
                          to={`/sales/invoices/${invoice.id}`}
                        >
                          {
                            invoice.invoiceNumber
                          }
                        </Link>
                      </td>

                      <td>
                        {invoice.reference ||
                          "—"}
                      </td>

                      <td>
                        {invoice.status}
                      </td>

                      <td>
                        {formatCurrency(
                          invoice.total,
                          currency
                        )}
                      </td>

                      <td>
                        {formatCurrency(
                          invoice.amountPaid,
                          currency
                        )}
                      </td>

                      <td>
                        {formatCurrency(
                          invoice.outstanding,
                          currency
                        )}
                      </td>

                      <td>
                        <strong>
                          {formatCurrency(
                            invoice.runningBalance,
                            currency
                          )}
                        </strong>
                      </td>
                    </tr>
                  )
                )
              ) : (
                <tr>
                  <td
                    colSpan="8"
                    className="customer-statement-empty"
                  >
                    No transactions were
                    found for this period.
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan="4">
                  Statement totals
                </td>

                <td>
                  {formatCurrency(
                    statementData.totalInvoiced,
                    currency
                  )}
                </td>

                <td>
                  {formatCurrency(
                    statementData.totalPaid,
                    currency
                  )}
                </td>

                <td colSpan="2">
                  {formatCurrency(
                    statementData.closingBalance,
                    currency
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <footer className="customer-statement-footer">
          <p>
            Please use the invoice
            number as your payment
            reference.
          </p>

          <p>
            Generated by Ledgify on{" "}
            {formatDate(new Date())}.
          </p>
        </footer>
      </section>
    </div>
  );
}

export default CustomerStatementPage;