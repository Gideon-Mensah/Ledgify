import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  FileText,
  Plus,
} from "lucide-react";
import {
  Link,
} from "react-router-dom";

import {
  getInvoices,
} from "../../services/invoiceService";

import {
  getCustomers,
} from "../../services/customerService";

// Normalizes text.
const normaliseText = (value) => {
  return String(value ?? "")
    .trim()
    .toLowerCase();
};

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) => {
  try {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          currency || "GBP",
      }
    ).format(Number(amount) || 0);
  } catch {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency: "GBP",
      }
    ).format(Number(amount) || 0);
  }
};

// Parses date value.
const parseDateValue = (
  dateValue
) => {
  if (!dateValue) {
    return null;
  }

  const value =
    String(dateValue).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    const parsedDate = new Date(
      `${value}T00:00:00`
    );

    return Number.isNaN(
      parsedDate.getTime()
    )
      ? null
      : parsedDate;
  }

  const displayDateMatch =
    value.match(
      /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
    );

  if (displayDateMatch) {
    const monthNumbers = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };

    const day = Number(
      displayDateMatch[1]
    );

    const month =
      monthNumbers[
        displayDateMatch[2]
          .toLowerCase()
      ];

    const year = Number(
      displayDateMatch[3]
    );

    if (
      month !== undefined
    ) {
      return new Date(
        year,
        month,
        day
      );
    }
  }

  const parsedDate =
    new Date(value);

  return Number.isNaN(
    parsedDate.getTime()
  )
    ? null
    : parsedDate;
};

// Formats date.
const formatDate = (
  dateValue
) => {
  const parsedDate =
    parseDateValue(dateValue);

  if (!parsedDate) {
    return dateValue
      ? String(dateValue)
      : "—";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(parsedDate);
};

// Gets status class name.
const getStatusClassName = (
  status
) => {
  return String(
    status || "Draft"
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
};

// Gets invoice customer name.
const getInvoiceCustomerName = (
  invoice
) => {
  return (
    invoice.customer ||
    invoice.customerName ||
    "Unknown customer"
  );
};

// Finds invoice customer.
const findInvoiceCustomer = (
  invoice,
  customers
) => {
  const customerById =
    customers.find(
      (customer) =>
        invoice.customerId !==
          undefined &&
        invoice.customerId !== null &&
        invoice.customerId !== "" &&
        Number(customer.id) ===
          Number(invoice.customerId)
    );

  if (customerById) {
    return customerById;
  }

  const customerName =
    getInvoiceCustomerName(
      invoice
    );

  return (
    customers.find(
      (customer) =>
        normaliseText(
          customer.name
        ) ===
        normaliseText(
          customerName
        )
    ) || null
  );
};

// Gets invoice total.
const getInvoiceTotal = (
  invoice
) => {
  return (
    Number(invoice.total) ||
    Number(invoice.grandTotal) ||
    Number(invoice.amount) ||
    0
  );
};

// Gets amount paid.
const getAmountPaid = (
  invoice
) => {
  if (
    Number.isFinite(
      Number(invoice.amountPaid)
    )
  ) {
    return Number(
      invoice.amountPaid
    );
  }

  if (
    Array.isArray(
      invoice.payments
    )
  ) {
    return invoice.payments.reduce(
      (total, payment) =>
        total +
        (Number(
          payment.amount
        ) || 0),
      0
    );
  }

  return 0;
};

// Checks whether overdue is true.
const isOverdue = (
  dueDateValue,
  outstanding
) => {
  if (
    Number(outstanding) <= 0.005
  ) {
    return false;
  }

  const dueDate =
    parseDateValue(
      dueDateValue
    );

  if (!dueDate) {
    return false;
  }

  const today = new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  dueDate.setHours(
    0,
    0,
    0,
    0
  );

  return (
    dueDate.getTime() <
    today.getTime()
  );
};

// Gets display status.
const getDisplayStatus = (
  invoice,
  total,
  amountPaid
) => {
  const storedStatus =
    invoice.status || "Draft";

  if (
    [
      "Draft",
      "Voided",
      "Cancelled",
    ].includes(storedStatus)
  ) {
    return storedStatus;
  }

  const outstanding =
    Math.max(
      total - amountPaid,
      0
    );

  if (
    total > 0 &&
    outstanding <= 0.005
  ) {
    return "Paid";
  }

  if (
    isOverdue(
      invoice.dueDate,
      outstanding
    )
  ) {
    return "Overdue";
  }

  if (amountPaid > 0.005) {
    return "Partly paid";
  }

  return storedStatus;
};

// Gets invoice sort time.
const getInvoiceSortTime = (
  invoice
) => {
  const dateValue =
    invoice.createdAt ||
    invoice.updatedAt ||
    invoice.issueDate ||
    invoice.invoiceDate;

  const parsedDate =
    parseDateValue(dateValue);

  return parsedDate
    ? parsedDate.getTime()
    : 0;
};

// Renders the recent invoices component.
function RecentInvoices() {
  const [
    invoices,
    setInvoices,
  ] = useState([]);

  const [
    customers,
    setCustomers,
  ] = useState([]);

  // Loads data.
  const loadData = () => {
    try {
      const storedInvoices =
        getInvoices();

      const storedCustomers =
        getCustomers();

      setInvoices(
        Array.isArray(
          storedInvoices
        )
          ? storedInvoices
          : []
      );

      setCustomers(
        Array.isArray(
          storedCustomers
        )
          ? storedCustomers
          : []
      );
    } catch (error) {
      console.error(
        "Recent invoices could not be loaded:",
        error
      );

      setInvoices([]);
      setCustomers([]);
    }
  };

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(loadData);

    window.addEventListener(
      "focus",
      loadData
    );

    return () => {
      window.cancelAnimationFrame(initialLoad);
      window.removeEventListener(
        "focus",
        loadData
      );
    };
  }, []);

  const recentInvoices =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return invoices
        .map((invoice) => {
          const linkedCustomer =
            findInvoiceCustomer(
              invoice,
              customers
            );

          const total =
            getInvoiceTotal(
              invoice
            );

          const amountPaid =
            getAmountPaid(
              invoice
            );

          const displayStatus =
            getDisplayStatus(
              invoice,
              total,
              amountPaid
            );

          const customerName =
            invoice.customer ||
            invoice.customerName ||
            linkedCustomer?.name ||
            "Unknown customer";

          const customerUrl =
            linkedCustomer?.id !==
              undefined &&
            linkedCustomer?.id !== null
              ? `/contacts/customers/${linkedCustomer.id}`
              : null;

          return {
            ...invoice,

            total,

            amountPaid,

            displayStatus,

            customerName,

            customerUrl,
          };
        })
        .sort(
          (first, second) =>
            getInvoiceSortTime(
              second
            ) -
            getInvoiceSortTime(
              first
            )
        )
        .slice(0, 5);
    }, [
      invoices,
      customers,
    ]);

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>
            Recent invoices
          </h2>

          <p>
            Your latest customer
            invoices and payment
            statuses.
          </p>
        </div>

        <Link
          to="/sales/invoices"
          className="dashboard-text-link"
        >
          View all
        </Link>
      </div>

      {recentInvoices.length > 0 ? (
        <div className="dashboard-table-wrapper">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Due date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {recentInvoices.map(
                (invoice) => (
                  <tr
                    key={invoice.id}
                  >
                    <td>
                      <Link
                        to={`/sales/invoices/${invoice.id}`}
                        className="invoice-number-link"
                      >
                        {invoice.invoiceNumber ||
                          `Invoice #${invoice.id}`}
                      </Link>
                    </td>

                    <td>
                      {invoice.customerUrl ? (
                        <Link
                          to={
                            invoice.customerUrl
                          }
                          className="invoice-number-link"
                        >
                          {
                            invoice.customerName
                          }
                        </Link>
                      ) : (
                        <strong>
                          {
                            invoice.customerName
                          }
                        </strong>
                      )}
                    </td>

                    <td>
                      {formatDate(
                        invoice.dueDate
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          invoice.total,
                          invoice.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      <span
                        className={`invoice-status invoice-status-${getStatusClassName(
                          invoice.displayStatus
                        )}`}
                      >
                        {
                          invoice.displayStatus
                        }
                      </span>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="invoice-empty-state">
          <FileText size={30} />

          <h3>
            No invoices yet
          </h3>

          <p>
            Create your first customer
            invoice to see it on the
            dashboard.
          </p>

          <Link
            to="/sales/invoices/new"
            className="page-primary-button"
          >
            <Plus size={17} />
            New invoice
          </Link>
        </div>
      )}
    </section>
  );
}

export default RecentInvoices;
