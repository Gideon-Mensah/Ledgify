// List and filter backend invoices while keeping document actions status-aware.

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Filter,
  Plus,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import { salesApiService } from "../../services/salesApiService";
import { normaliseApiError } from "../../services/apiError";
import InvoiceRowActions from "../../components/invoices/InvoiceRowActions";
import { downloadInvoicePdf } from "../../utils/invoicePdf";

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(amount) || 0);

// Calculates invoice totals.
const calculateInvoiceTotals = (invoice) => {
  const subtotal = (invoice.items || []).reduce(
    (total, item) =>
      total +
      Number(item.quantity) *
      Number(item.unitPrice),
    0
  );

  const vat = (invoice.items || []).reduce(
    (total, item) => {
      const lineSubtotal =
        Number(item.quantity) *
        Number(item.unitPrice);

      return (
        total +
        lineSubtotal *
        (Number(item.vatRate) / 100)
      );
    },
    0
  );

  const total = subtotal + vat;
  const amountPaid = Math.min(
    Number(invoice.amountPaid) || 0,
    total
  );

  const balanceDue = Math.max(
    total - amountPaid,
    0
  );

  return {
    subtotal,
    vat,
    total,
    amountPaid,
    balanceDue,
  };
};

// Gets invoice status.
const getInvoiceStatus = (invoice, totals) => {
  if (totals.balanceDue === 0 && totals.total > 0) {
    return "Paid";
  }

  if (totals.amountPaid > 0) {
    return "Part paid";
  }

  return invoice.status;
};

// Gets status class name.
const getStatusClassName = (status) =>
  status.toLowerCase().replaceAll(" ", "-");

// Renders the invoices page component.
function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeStatus, setActiveStatus] =
    useState("All");
  const [selectedCustomer, setSelectedCustomer] =
    useState("All customers");
  const [selectedInvoices, setSelectedInvoices] =
    useState([]);
  const [loadError, setLoadError] = useState("");

  // Loads invoices.
  const loadInvoices = async () => {
    try {
      setInvoices(await salesApiService.list());
      setLoadError("");
    } catch (error) {
      setLoadError(normaliseApiError(error));
    }
  };

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(loadInvoices);

    window.addEventListener(
      "focus",
      loadInvoices
    );

    return () => {
      window.cancelAnimationFrame(initialLoad);
      window.removeEventListener(
        "focus",
        loadInvoices
      );
    };
  }, []);

  // Recalculates this value only when its inputs change.
  const preparedInvoices = useMemo(
    () =>
      invoices.map((invoice) => {
        const totals =
          calculateInvoiceTotals(invoice);

        return {
          ...invoice,
          totals,
          displayStatus: getInvoiceStatus(
            invoice,
            totals
          ),
        };
      }),
    [invoices]
  );

  // Recalculates this value only when its inputs change.
  const customers = useMemo(() => {
    const uniqueCustomers = [
      ...new Set(
        preparedInvoices.map(
          (invoice) => invoice.customer
        )
      ),
    ];

    return [
      "All customers",
      ...uniqueCustomers.sort(),
    ];
  }, [preparedInvoices]);

  // Recalculates this value only when its inputs change.
  const statusCounts = useMemo(() => {
    return preparedInvoices.reduce(
      (counts, invoice) => {
        counts.All += 1;

        if (
          Object.prototype.hasOwnProperty.call(
            counts,
            invoice.displayStatus
          )
        ) {
          counts[invoice.displayStatus] += 1;
        }

        return counts;
      },
      {
        All: 0,
        Draft: 0,
        "Awaiting payment": 0,
        "Part paid": 0,
        Paid: 0,
        Overdue: 0,
      }
    );
  }, [preparedInvoices]);

  // Recalculates this value only when its inputs change.
  const filteredInvoices = useMemo(() => {
    const normalisedSearch =
      searchTerm.trim().toLowerCase();

    return preparedInvoices.filter(
      (invoice) => {
        const matchesSearch =
          !normalisedSearch ||
          invoice.invoiceNumber
            .toLowerCase()
            .includes(normalisedSearch) ||
          invoice.customer
            .toLowerCase()
            .includes(normalisedSearch) ||
          (invoice.reference || "")
            .toLowerCase()
            .includes(normalisedSearch);

        const matchesStatus =
          activeStatus === "All" ||
          invoice.displayStatus ===
          activeStatus;

        const matchesCustomer =
          selectedCustomer ===
          "All customers" ||
          invoice.customer ===
          selectedCustomer;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesCustomer
        );
      }
    );
  }, [
    preparedInvoices,
    searchTerm,
    activeStatus,
    selectedCustomer,
  ]);

  // Recalculates this value only when its inputs change.
  const summary = useMemo(() => {
    return preparedInvoices.reduce(
      (totals, invoice) => {
        totals.totalInvoiced +=
          invoice.totals.total;

        totals.totalPaid +=
          invoice.totals.amountPaid;

        totals.totalOutstanding +=
          invoice.totals.balanceDue;

        if (
          invoice.displayStatus === "Overdue"
        ) {
          totals.totalOverdue +=
            invoice.totals.balanceDue;
        }

        return totals;
      },
      {
        totalInvoiced: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        totalOverdue: 0,
      }
    );
  }, [preparedInvoices]);

  const allVisibleSelected =
    filteredInvoices.length > 0 &&
    filteredInvoices.every((invoice) =>
      selectedInvoices.includes(invoice.id)
    );

  // Handles select all.
  const handleSelectAll = () => {
    const visibleIds = filteredInvoices.map(
      (invoice) => invoice.id
    );

    if (allVisibleSelected) {
      setSelectedInvoices(
        (currentSelected) =>
          currentSelected.filter(
            (invoiceId) =>
              !visibleIds.includes(invoiceId)
          )
      );

      return;
    }

    setSelectedInvoices(
      (currentSelected) => [
        ...new Set([
          ...currentSelected,
          ...visibleIds,
        ]),
      ]
    );
  };

  // Handles select invoice.
  const handleSelectInvoice = (invoiceId) => {
    setSelectedInvoices(
      (currentSelected) =>
        currentSelected.includes(invoiceId)
          ? currentSelected.filter(
            (id) => id !== invoiceId
          )
          : [...currentSelected, invoiceId]
    );
  };

  // Handles duplicate invoice.
  const handleDuplicateInvoice = async (
    invoiceId
  ) => {
    try {
      const duplicatedInvoice =
        await salesApiService.duplicate(invoiceId);

      await loadInvoices();

      alert(
        `${duplicatedInvoice.invoiceNumber} was created as a draft.`
      );
    } catch (error) {
      console.error(
        "Unable to duplicate invoice:",
        error
      );

      alert(
        "The invoice could not be duplicated."
      );
    }
  };

  // Handles delete invoice.
  const handleDeleteInvoice = async (
    invoice
  ) => {
    const confirmed = window.confirm(
      `Delete ${invoice.invoiceNumber} for ${invoice.customer}? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await salesApiService.remove(invoice.id);

    setSelectedInvoices(
      (currentSelected) =>
        currentSelected.filter(
          (invoiceId) =>
            invoiceId !== invoice.id
        )
    );

      await loadInvoices();
    } catch (error) {
      alert(normaliseApiError(error));
    }
  };

  // Handles download invoice.
  const handleDownloadInvoice = (invoice) => {
    try {
      downloadInvoicePdf(invoice);
    } catch (error) {
      console.error(
        "Unable to download invoice PDF:",
        error
      );

      alert(
        "The invoice PDF could not be generated."
      );
    }
  };
  // Handles export.
  const handleExport = () => {
    if (filteredInvoices.length === 0) {
      alert("There are no invoices to export.");
      return;
    }

    const headers = [
      "Invoice number",
      "Customer",
      "Issue date",
      "Due date",
      "Status",
      "Total",
      "Amount paid",
      "Balance due",
    ];

    const rows = filteredInvoices.map(
      (invoice) => [
        invoice.invoiceNumber,
        invoice.customer,
        invoice.issueDate,
        invoice.dueDate,
        invoice.displayStatus,
        invoice.totals.total.toFixed(2),
        invoice.totals.amountPaid.toFixed(2),
        invoice.totals.balanceDue.toFixed(2),
      ]
    );

    const csvContent = [
      headers,
      ...rows,
    ]
      .map((row) =>
        row
          .map((value) => {
            const escapedValue = String(
              value ?? ""
            ).replaceAll('"', '""');

            return `"${escapedValue}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url =
      URL.createObjectURL(blob);

    const downloadLink =
      document.createElement("a");

    downloadLink.href = url;
    downloadLink.download =
      "sales-invoices.csv";

    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    URL.revokeObjectURL(url);
  };

  const statusTabs = [
    "All",
    "Draft",
    "Awaiting payment",
    "Part paid",
    "Paid",
    "Overdue",
  ];

  return (
    <div className="invoices-page">
      {loadError && <div className="invoice-form-alert">{loadError}</div>}
      <PageHeader
        eyebrow="Sales"
        title="Invoices"
        description="Create, manage and track customer invoices."
        action={
          <Link
            to="/sales/invoices/new"
            className="page-primary-button"
          >
            <Plus size={18} />
            New invoice
          </Link>
        }
      />

      <section className="invoice-summary-grid">
        <article className="invoice-summary-card">
          <span>Total invoiced</span>

          <strong>
            {formatCurrency(
              summary.totalInvoiced
            )}
          </strong>

          <p>
            Across {preparedInvoices.length}{" "}
            invoices
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Paid</span>

          <strong>
            {formatCurrency(summary.totalPaid)}
          </strong>

          <p>Payments received</p>
        </article>

        <article className="invoice-summary-card">
          <span>Outstanding</span>

          <strong>
            {formatCurrency(
              summary.totalOutstanding
            )}
          </strong>

          <p>Still awaiting payment</p>
        </article>

        <article className="invoice-summary-card">
          <span>Overdue</span>

          <strong>
            {formatCurrency(
              summary.totalOverdue
            )}
          </strong>

          <p>Past the due date</p>
        </article>
      </section>

      <section className="invoice-list-card">
        <div className="invoice-status-tabs">
          {statusTabs.map((status) => (
            <button
              key={status}
              type="button"
              className={
                activeStatus === status
                  ? "invoice-status-tab invoice-status-tab-active"
                  : "invoice-status-tab"
              }
              onClick={() =>
                setActiveStatus(status)
              }
            >
              {status}

              <span>
                {statusCounts[status] || 0}
              </span>
            </button>
          ))}
        </div>

        <div className="invoice-list-toolbar">
          <div className="invoice-search-box">
            <Search size={18} />

            <input
              type="search"
              placeholder="Search invoices"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(
                  event.target.value
                )
              }
            />
          </div>

          <div className="invoice-toolbar-actions">
            <select
              className="invoice-customer-filter"
              value={selectedCustomer}
              onChange={(event) =>
                setSelectedCustomer(
                  event.target.value
                )
              }
            >
              {customers.map((customer) => (
                <option
                  key={customer}
                  value={customer}
                >
                  {customer}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="invoice-secondary-button"
            >
              <Filter size={17} />
              More filters
            </button>

            <button
              type="button"
              className="invoice-secondary-button"
              onClick={handleExport}
            >
              <Download size={17} />
              Export
            </button>
          </div>
        </div>

        {selectedInvoices.length > 0 && (
          <div className="invoice-selection-bar">
            <span>
              {selectedInvoices.length}{" "}
              invoice
              {selectedInvoices.length === 1
                ? ""
                : "s"}{" "}
              selected
            </span>

            <button
              type="button"
              onClick={() =>
                setSelectedInvoices([])
              }
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="invoice-table-wrapper">
          <table className="invoice-table">
            <thead>
              <tr>
                <th className="invoice-checkbox-column">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={handleSelectAll}
                    aria-label="Select all invoices"
                  />
                </th>

                <th>Invoice</th>
                <th>Customer</th>
                <th>Issue date</th>
                <th>Due date</th>
                <th>Status</th>
                <th>Total</th>
                <th>Amount paid</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {filteredInvoices.map(
                (invoice) => (
                  <tr key={invoice.id}>
                    <td className="invoice-checkbox-column">
                      <input
                        type="checkbox"
                        checked={selectedInvoices.includes(
                          invoice.id
                        )}
                        onChange={() =>
                          handleSelectInvoice(
                            invoice.id
                          )
                        }
                        aria-label={`Select ${invoice.invoiceNumber}`}
                      />
                    </td>

                    <td>
                      <Link
                        to={`/sales/invoices/${invoice.id}`}
                        className="invoice-number-link"
                      >
                        {invoice.invoiceNumber}
                      </Link>

                      {invoice.reference && (
                        <small>
                          {invoice.reference}
                        </small>
                      )}
                    </td>

                    <td>
                      <strong>
                        {invoice.customer}
                      </strong>

                      <small>
                        {invoice.customerEmail}
                      </small>
                    </td>

                    <td>
                      {invoice.issueDate}
                    </td>

                    <td>
                      {invoice.dueDate}
                    </td>

                    <td>
                      <span
                        className={`invoice-status invoice-status-${getStatusClassName(
                          invoice.displayStatus
                        )}`}
                      >
                        {invoice.displayStatus}
                      </span>
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          invoice.totals.total,
                          invoice.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      {formatCurrency(
                        invoice.totals
                          .amountPaid,
                        invoice.currency
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          invoice.totals
                            .balanceDue,
                          invoice.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      <InvoiceRowActions
                        invoice={invoice}
                        onDuplicate={
                          handleDuplicateInvoice
                        }
                        onDelete={
                          handleDeleteInvoice
                        }
                        onDownload={
                          handleDownloadInvoice
                        }
                      />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length === 0 && (
          <div className="invoice-empty-state">
            <h3>No invoices found</h3>

            <p>
              Try changing the search term or
              filters.
            </p>
          </div>
        )}

        <div className="invoice-pagination">
          <p>
            Showing {filteredInvoices.length} of{" "}
            {preparedInvoices.length} invoices
          </p>

          <div>
            <button
              type="button"
              disabled
            >
              Previous
            </button>

            <button
              type="button"
              className="invoice-pagination-active"
            >
              1
            </button>

            <button
              type="button"
              disabled
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default InvoicesPage;
