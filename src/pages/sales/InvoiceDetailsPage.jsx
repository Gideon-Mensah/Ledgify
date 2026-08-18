// Present one invoice, its payments, and links to the accounting records behind it.

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  Banknote,
  Download,
  Mail,
  MoreHorizontal,
  Pencil,
  Printer,
  RotateCcw,
} from "lucide-react";
import {
  Link,
  useParams,
  useSearchParams,
} from "react-router-dom";

import RecordPaymentModal from "../../components/invoices/RecordPaymentModal";
import EmailInvoiceModal from "../../components/invoices/EmailInvoiceModal";

import {
  emailInvoice,
  reverseInvoicePayment,
} from "../../services/invoiceService";
import { salesApiService } from "../../services/salesApiService";
import { normaliseApiError } from "../../services/apiError";
import { useAuth } from "../../store/AuthContext";

import {
  downloadInvoicePdf,
} from "../../utils/invoicePdf";

const emptyTotals = {
  subtotal: 0,
  discount: 0,
  vatTotal: 0,
  grandTotal: 0,
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

// Gets status class name.
const getStatusClassName = (
  status
) => {
  return String(status || "Draft")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
};

// Gets customer address lines.
const getCustomerAddressLines = (
  address
) => {
  if (Array.isArray(address)) {
    return address
      .map((line) =>
        String(line || "").trim()
      )
      .filter(Boolean);
  }

  if (
    !address ||
    typeof address !== "object"
  ) {
    return [];
  }

  return [
    address.line1,
    address.line2,
    address.city,
    address.county,
    address.postcode,
    address.country,
  ]
    .map((line) =>
      String(line || "").trim()
    )
    .filter(Boolean);
};

// Calculates invoice line.
const calculateInvoiceLine = (
  item,
  pricingMode = "exclusive"
) => {
  const quantity =
    Number(item.quantity) || 0;

  const unitPrice =
    Number(item.unitPrice) || 0;

  const discountRate =
    Number(item.discountRate) || 0;

  const vatRate =
    Number(item.vatRate) || 0;

  const gross =
    quantity * unitPrice;

  const discount =
    gross *
    (discountRate / 100);

  const discountedAmount =
    gross - discount;

  if (
    pricingMode === "inclusive"
  ) {
    const vatAmount =
      vatRate > 0
        ? discountedAmount -
        discountedAmount /
        (1 + vatRate / 100)
        : 0;

    return {
      gross,
      discount,
      subtotal:
        discountedAmount -
        vatAmount,
      vatAmount,
      total:
        discountedAmount,
    };
  }

  const vatAmount =
    discountedAmount *
    (vatRate / 100);

  return {
    gross,
    discount,
    subtotal:
      discountedAmount,
    vatAmount,
    total:
      discountedAmount +
      vatAmount,
  };
};

// Gets amount paid.
const getAmountPaid = (
  invoice
) => {
  if (
    invoice?.amountPaid !==
    undefined &&
    invoice?.amountPaid !== null &&
    invoice?.amountPaid !== ""
  ) {
    return (
      Number(
        invoice.amountPaid
      ) || 0
    );
  }

  if (
    Array.isArray(
      invoice?.payments
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

// Renders the invoice details page component.
function InvoiceDetailsPage() {
  const auth = useAuth();
  const { invoiceId } =
    useParams();

  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const [
    invoice,
    setInvoice,
  ] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState("");

  const [
    isPaymentModalOpen,
    setIsPaymentModalOpen,
  ] = useState(false);

  const [
    isEmailModalOpen,
    setIsEmailModalOpen,
  ] = useState(false);

  const [
    reversingPaymentId,
    setReversingPaymentId,
  ] = useState(null);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    // Loads invoice.
    const loadInvoice = async () => {
      try {
        setIsLoading(true);
        setInvoice(await salesApiService.get(invoiceId));
        setLoadError("");
      } catch (error) {
        setLoadError(normaliseApiError(error));
        setInvoice(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadInvoice();

    window.addEventListener(
      "focus",
      loadInvoice
    );

    return () => {
      window.removeEventListener(
        "focus",
        loadInvoice
      );
    };
  }, [invoiceId]);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const modalUpdate = window.requestAnimationFrame(() => {
    setIsEmailModalOpen(false);

    const shouldOpenPayment =
      searchParams.get(
        "recordPayment"
      ) === "true";

    setIsPaymentModalOpen(
      Boolean(
        invoice &&
        shouldOpenPayment
      )
    );
    });
    return () => window.cancelAnimationFrame(modalUpdate);
  }, [
    invoice,
    searchParams,
  ]);

  const invoiceItems =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return Array.isArray(
        invoice?.items
      )
        ? invoice.items
        : [];
    }, [invoice]);

  // Recalculates this value only when its inputs change.
  const totals = useMemo(() => {
    if (!invoice) {
      return emptyTotals;
    }

    return invoiceItems.reduce(
      (summary, item) => {
        const line =
          calculateInvoiceLine(
            item,
            invoice.pricingMode ||
            "exclusive"
          );

        summary.subtotal +=
          line.subtotal;

        summary.discount +=
          line.discount;

        summary.vatTotal +=
          line.vatAmount;

        summary.grandTotal +=
          line.total;

        return summary;
      },
      {
        ...emptyTotals,
      }
    );
  }, [
    invoice,
    invoiceItems,
  ]);

  const customerName =
    invoice?.customer ||
    invoice?.customerName ||
    "Customer";

  const customerAddressLines =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return getCustomerAddressLines(
        invoice?.customerAddress
      );
    }, [
      invoice?.customerAddress,
    ]);

  const customerUrl =
    invoice?.customerId !==
      undefined &&
      invoice?.customerId !== null &&
      invoice?.customerId !== ""
      ? `/contacts/customers/${invoice.customerId}`
      : null;

  const totalAmountPaid =
    Math.min(
      getAmountPaid(invoice),
      totals.grandTotal
    );

  const balanceDue =
    Math.max(
      totals.grandTotal -
      totalAmountPaid,
      0
    );

  const currentStatus =
    balanceDue <= 0.005 &&
      totals.grandTotal > 0
      ? "Paid"
      : totalAmountPaid > 0.005
        ? "Partly paid"
        : invoice?.status ||
        "Draft";

  // Handles close payment modal.
  const handleClosePaymentModal =
    () => {
      setIsPaymentModalOpen(
        false
      );

      if (
        searchParams.has(
          "recordPayment"
        )
      ) {
        const updatedParams =
          new URLSearchParams(
            searchParams
          );

        updatedParams.delete(
          "recordPayment"
        );

        setSearchParams(
          updatedParams,
          {
            replace: true,
          }
        );
      }
    };

  if (isLoading) return <div className="invoice-details-page"><section className="invoice-form-card">Loading invoice…</section></div>;

  if (!invoice) {
    return (
      <div className="invoice-details-page">
        <div className="invoice-back-row">
          <Link
            to="/sales/invoices"
            className="invoice-back-link"
          >
            <ArrowLeft size={17} />
            Back to invoices
          </Link>
        </div>

        <section className="invoice-form-card">
          <h1>
            Invoice not found
          </h1>

          <p>
            {loadError || "The invoice you requested does not exist or may have been deleted."}
          </p>
        </section>
      </div>
    );
  }

  // Handles print.
  const handlePrint = () => {
    window.print();
  };

  // Handles download pdf.
  const handleDownloadPdf = () => {
    try {
      downloadInvoicePdf(
        invoice
      );
    } catch (error) {
      console.error(
        "Unable to download invoice PDF:",
        error
      );

      window.alert(
        "The invoice PDF could not be generated."
      );
    }
  };

  // Handles record payment.
  const handleRecordPayment =
    async (paymentData) => {
      try {
        const updatedInvoice =
          await salesApiService.recordPayment(invoice, paymentData);

        setInvoice(
          updatedInvoice
        );
        setSuccessMessage("Payment recorded successfully.");

        handleClosePaymentModal();
      } catch (error) {
        throw new Error(
          normaliseApiError(error),
          { cause: error }
        );
      }
    };

  const handleApprove = async () => {
    try {
      setInvoice(await salesApiService.approve(invoice.id));
    } catch (error) {
      window.alert(normaliseApiError(error));
    }
  };

  // Handles reverse payment.
  const handleReversePayment = async (
    payment
  ) => {
    const reason = window.prompt(
      `Enter the reason for reversing ${formatCurrency(
        payment.amount,
        invoice.currency
      )}.`,
      "Payment entered incorrectly"
    );

    if (reason === null) {
      return;
    }

    const confirmed =
      window.confirm(
        "This will remove the payment from the invoice and delete its linked bank transaction. Continue?"
      );

    if (!confirmed) {
      return;
    }

    setReversingPaymentId(
      payment.id
    );

    try {
      const updatedInvoice =
        reverseInvoicePayment(
          invoice.id,
          payment.id,
          reason
        );

      setInvoice(
        updatedInvoice
      );
    } catch (error) {
      console.error(
        "Unable to reverse invoice payment:",
        error
      );

      window.alert(
        error.message ||
        "The invoice payment could not be reversed."
      );
    } finally {
      setReversingPaymentId(
        null
      );
    }
  };

  // Handles email invoice.
  const handleEmailInvoice =
    async (emailData) => {
      try {
        const updatedInvoice =
          emailInvoice(
            invoice.id,
            emailData
          );

        setInvoice(
          updatedInvoice
        );

        setIsEmailModalOpen(
          false
        );

        window.alert(
          `Invoice emailed to ${emailData.to}.`
        );
      } catch (error) {
        console.error(
          "Unable to email invoice:",
          error
        );

        throw new Error(
          error.message ||
          "The invoice could not be emailed.",
          { cause: error }
        );
      }
    };

  return (
    <div className="invoice-details-page">
      {successMessage && <div className="chart-accounts-success" role="status"><span>{successMessage}</span><button type="button" onClick={() => setSuccessMessage("")} aria-label="Dismiss message">×</button></div>}
      <div className="invoice-back-row">
        <Link
          to="/sales/invoices"
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to invoices
        </Link>
      </div>

      <div className="invoice-details-header">
        <div>
          <div className="invoice-details-title-row">
            <h1>
              {invoice.invoiceNumber}
            </h1>

            <span
              className={`invoice-status invoice-status-${getStatusClassName(
                currentStatus
              )}`}
            >
              {currentStatus}
            </span>
          </div>

          <p>
            Issued to{" "}
            {customerUrl ? (
              <Link
                to={customerUrl}
                className="invoice-number-link"
              >
                {customerName}
              </Link>
            ) : (
              <strong>
                {customerName}
              </strong>
            )}{" "}
            on{" "}
            {invoice.issueDate ||
              "—"}
          </p>
        </div>

      <div className="invoice-details-actions">
          {invoice.backendStatus === "draft" && auth.hasPermission("approve_invoice") && (
            <button type="button" className="page-primary-button" onClick={handleApprove}>
              Approve invoice
            </button>
          )}
          <button
            type="button"
            className="invoice-secondary-button"
            onClick={handlePrint}
          >
            <Printer size={17} />
            Print
          </button>

          <button
            type="button"
            className="invoice-secondary-button"
            onClick={() =>
              setIsEmailModalOpen(
                true
              )
            }
          >
            <Mail size={17} />
            Email
          </button>

          {invoice.backendStatus === "draft" && auth.hasPermission("create_invoice") && <Link
            to={`/sales/invoices/${invoice.id}/edit`}
            className="invoice-secondary-button"
          >
            <Pencil size={17} />
            Edit
          </Link>}

          {balanceDue > 0.005 && invoice.backendStatus !== "draft" && auth.hasPermission("create_customer_payment") && (
            <button
              type="button"
              className="page-primary-button"
              onClick={() =>
                setIsPaymentModalOpen(
                  true
                )
              }
            >
              <Banknote size={18} />
              Record payment
            </button>
          )}

          <button
            type="button"
            className="invoice-icon-button"
            aria-label="More invoice actions"
          >
            <MoreHorizontal
              size={19}
            />
          </button>
        </div>
      </div>

      <div className="invoice-details-layout">
        <main className="invoice-document">
          <div className="invoice-document-top">
            <div className="invoice-company-brand">
              <div className="invoice-company-logo">
                AC
              </div>

              <div>
                <h2>
                  Accounting Cloud Ltd
                </h2>

                <p>
                  12 Business Park
                </p>

                <p>
                  Sheffield, S1 2AB
                </p>

                <p>
                  United Kingdom
                </p>
              </div>
            </div>

            <div className="invoice-document-title">
              <span>Invoice</span>

              <strong>
                {invoice.invoiceNumber}
              </strong>
            </div>
          </div>

          <div className="invoice-address-grid">
            <div>
              <span className="invoice-document-label">
                Bill to
              </span>

              {customerUrl ? (
                <Link
                  to={customerUrl}
                  className="invoice-number-link"
                >
                  <strong>
                    {customerName}
                  </strong>
                </Link>
              ) : (
                <strong>
                  {customerName}
                </strong>
              )}

              {customerAddressLines
                .length > 0 ? (
                customerAddressLines.map(
                  (addressLine, index) => (
                    <p
                      key={`${addressLine}-${index}`}
                    >
                      {addressLine}
                    </p>
                  )
                )
              ) : (
                <p>
                  No customer address
                  available.
                </p>
              )}

              {invoice.customerEmail && (
                <p>
                  {invoice.customerEmail}
                </p>
              )}
            </div>

            <div className="invoice-document-meta">
              <div>
                <span>
                  Invoice date
                </span>

                <strong>
                  {invoice.issueDate ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>Due date</span>

                <strong>
                  {invoice.dueDate ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>Reference</span>

                <strong>
                  {invoice.reference ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>Currency</span>

                <strong>
                  {invoice.currency ||
                    "GBP"}
                </strong>
              </div>
            </div>
          </div>

          <div className="invoice-document-table-wrapper">
            <table className="invoice-document-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit price</th>
                  <th>Discount</th>
                  <th>VAT</th>
                  <th>Total</th>
                </tr>
              </thead>

              <tbody>
                {invoiceItems.map(
                  (item, index) => {
                    const line =
                      calculateInvoiceLine(
                        item,
                        invoice.pricingMode ||
                        "exclusive"
                      );

                    return (
                      <tr
                        key={
                          item.id ||
                          `${invoice.id}-${index}`
                        }
                      >
                        <td>
                          <strong>
                            {item.description ||
                              "Untitled item"}
                          </strong>
                        </td>

                        <td>
                          {Number(
                            item.quantity
                          ) || 0}
                        </td>

                        <td>
                          {formatCurrency(
                            item.unitPrice,
                            invoice.currency
                          )}
                        </td>

                        <td>
                          {Number(
                            item.discountRate
                          ) || 0}
                          %
                        </td>

                        <td>
                          {Number(
                            item.vatRate
                          ) || 0}
                          %
                        </td>

                        <td>
                          <strong>
                            {formatCurrency(
                              line.total,
                              invoice.currency
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

          <div className="invoice-document-summary">
            <div className="invoice-document-notes">
              <span className="invoice-document-label">
                Notes
              </span>

              <p>
                {invoice.notes ||
                  "No notes were added."}
              </p>
            </div>

            <div className="invoice-document-totals">
              <div>
                <span>Subtotal</span>

                <strong>
                  {formatCurrency(
                    totals.subtotal,
                    invoice.currency
                  )}
                </strong>
              </div>

              {totals.discount >
                0 && (
                  <div>
                    <span>
                      Discount
                    </span>

                    <strong>
                      -
                      {formatCurrency(
                        totals.discount,
                        invoice.currency
                      )}
                    </strong>
                  </div>
                )}

              <div>
                <span>VAT</span>

                <strong>
                  {formatCurrency(
                    totals.vatTotal,
                    invoice.currency
                  )}
                </strong>
              </div>

              <div className="invoice-document-grand-total">
                <span>Total</span>

                <strong>
                  {formatCurrency(
                    totals.grandTotal,
                    invoice.currency
                  )}
                </strong>
              </div>

              {totalAmountPaid >
                0 && (
                  <div className="invoice-payment-complete">
                    <span>
                      Amount paid
                    </span>

                    <strong>
                      {formatCurrency(
                        totalAmountPaid,
                        invoice.currency
                      )}
                    </strong>
                  </div>
                )}

              <div className="invoice-amount-due">
                <span>
                  Amount due
                </span>

                <strong>
                  {formatCurrency(
                    balanceDue,
                    invoice.currency
                  )}
                </strong>
              </div>
            </div>
          </div>

          <div className="invoice-document-footer">
            <p>
              Payment details:
              Business Current Account
            </p>

            <p>
              Sort code: 20-00-00 ·
              Account number: 12345678
            </p>
          </div>
        </main>

        <aside className="invoice-details-sidebar">
          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>
                Payment summary
              </h2>
            </div>

            <div className="invoice-payment-summary">
              <div>
                <span>
                  Invoice total
                </span>

                <strong>
                  {formatCurrency(
                    totals.grandTotal,
                    invoice.currency
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Amount paid
                </span>

                <strong>
                  {formatCurrency(
                    totalAmountPaid,
                    invoice.currency
                  )}
                </strong>
              </div>

              <div className="invoice-payment-balance">
                <span>
                  Balance due
                </span>

                <strong>
                  {formatCurrency(
                    balanceDue,
                    invoice.currency
                  )}
                </strong>
              </div>
            </div>

            {balanceDue > 0.005 && invoice.backendStatus !== "draft" && auth.hasPermission("create_customer_payment") && (
              <button
                type="button"
                className="page-primary-button invoice-full-width-button"
                onClick={() =>
                  setIsPaymentModalOpen(
                    true
                  )
                }
              >
                <Banknote size={18} />
                Record payment
              </button>
            )}

            <button
              type="button"
              className="invoice-secondary-button invoice-full-width-button"
              onClick={
                handleDownloadPdf
              }
            >
              <Download size={17} />
              Download PDF
            </button>
          </section>

          {(invoice.payments || [])
            .length > 0 && (
              <section className="invoice-details-card">
                <div className="invoice-details-card-header">
                  <h2>
                    Payment history
                  </h2>
                </div>

                <div className="bill-payment-list">
                  {(invoice.payments || []).map(
                    (
                      payment,
                      index
                    ) => (
                      <div
                        className="bill-payment-item"
                        key={
                          payment.id ||
                          `${payment.paymentDate}-${index}`
                        }
                      >
                        <div>
                          <strong>
                            {payment.paymentMethod ||
                              "Payment"}
                          </strong>

                          <span>
                            {payment.paymentDate ||
                              "—"}
                          </span>

                          {payment.bankAccountName && (
                            <small>
                              Paid into{" "}
                              {
                                payment.bankAccountName
                              }
                            </small>
                          )}

                          {payment.reference && (
                            <small>
                              Reference:{" "}
                              {payment.reference}
                            </small>
                          )}

                          {payment.bankTransactionId && (
                            <small>
                              Bank transaction recorded
                            </small>
                          )}
                        </div>

                        <div className="invoice-payment-history-actions">
                          <strong>
                            {formatCurrency(
                              payment.amount,
                              invoice.currency
                            )}
                          </strong>

                          <button
                            type="button"
                            className="invoice-secondary-button"
                            disabled={
                              reversingPaymentId ===
                              payment.id
                            }
                            onClick={() =>
                              handleReversePayment(
                                payment
                              )
                            }
                          >
                            <RotateCcw size={15} />

                            {reversingPaymentId ===
                              payment.id
                              ? "Reversing..."
                              : "Reverse"}
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>
            )}

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>Activity</h2>
            </div>

            {(invoice.activity || [])
              .length > 0 ? (
              <div className="invoice-activity-list">
                {(invoice.activity || []).map(
                  (
                    activity,
                    index
                  ) => (
                    <div
                      className="invoice-activity-item"
                      key={
                        activity.id ||
                        `${activity.date}-${index}`
                      }
                    >
                      <span className="invoice-activity-dot" />

                      <div>
                        <strong>
                          {activity.title}
                        </strong>

                        <p>
                          {
                            activity.description
                          }
                        </p>

                        <small>
                          {activity.date}
                        </small>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p>
                No activity has been
                recorded for this
                invoice.
              </p>
            )}
          </section>
        </aside>
      </div>

      <RecordPaymentModal
        isOpen={
          isPaymentModalOpen
        }
        invoiceNumber={
          invoice.invoiceNumber
        }
        balanceDue={balanceDue}
        invoiceCurrency={
          invoice.currency || "GBP"
        }
        onClose={
          handleClosePaymentModal
        }
        onSave={
          handleRecordPayment
        }
      />

      <EmailInvoiceModal
        isOpen={
          isEmailModalOpen
        }
        invoice={invoice}
        onClose={() =>
          setIsEmailModalOpen(false)
        }
        onSend={
          handleEmailInvoice
        }
      />
    </div>
  );
}

export default InvoiceDetailsPage;
