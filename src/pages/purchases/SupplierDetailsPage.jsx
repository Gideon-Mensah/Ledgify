import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  Building2,
  CircleDollarSign,
  ClipboardList,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  ReceiptText,
  Trash2,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { purchasesApiService } from "../../services/purchasesApiService";
import { contactApiService } from "../../services/contactApiService";

import {
  getPurchaseOrders,
} from "../../services/purchaseOrderService";

import { normaliseApiError } from "../../services/apiError";

import {
  getBillBalance,
} from "../../utils/billCalculations";

import {
  getSupplierBills,
  getSupplierSummary,
} from "../../utils/supplierCalculations";

const expenseAccounts = [
  {
    code: "400",
    name: "Advertising and marketing",
  },
  {
    code: "420",
    name: "Office expenses",
  },
  {
    code: "438",
    name: "Software subscriptions",
  },
  {
    code: "445",
    name: "Utilities",
  },
  {
    code: "469",
    name: "Rent",
  },
  {
    code: "473",
    name: "Repairs and maintenance",
  },
  {
    code: "477",
    name: "Professional fees",
  },
  {
    code: "485",
    name: "Travel expenses",
  },
];

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) => {
  return new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency,
    }
  ).format(Number(amount) || 0);
};

// Formats date.
const formatDate = (dateValue) => {
  if (!dateValue) {
    return "—";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
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

// Gets date timestamp.
const getDateTimestamp = (
  ...dateValues
) => {
  for (const dateValue of dateValues) {
    if (!dateValue) {
      continue;
    }

    const date = new Date(dateValue);

    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return 0;
};

// Gets status class name.
const getStatusClassName = (
  status
) => {
  return String(status || "draft")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-");
};

// Performs the purchase order belongs to supplier task.
const purchaseOrderBelongsToSupplier = (
  purchaseOrder,
  supplier
) => {
  const hasSupplierId =
    purchaseOrder.supplierId !==
      undefined &&
    purchaseOrder.supplierId !== null &&
    purchaseOrder.supplierId !== "";

  if (hasSupplierId) {
    return (
      Number(purchaseOrder.supplierId) ===
      Number(supplier.id)
    );
  }

  return (
    normaliseText(
      purchaseOrder.supplierName
    ) === normaliseText(supplier.name)
  );
};

// Renders the supplier details page component.
function SupplierDetailsPage() {
  const { supplierId } =
    useParams();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [
    supplier,
    setSupplier,
  ] = useState(null);

  const [bills, setBills] =
    useState([]);

  const [
    purchaseOrders,
    setPurchaseOrders,
  ] = useState([]);

  // Loads data.
  const loadData = useCallback(async () => {
    const [nextSupplier, nextBills] = await Promise.all([
      contactApiService.get(supplierId),
      purchasesApiService.list(`supplier=${supplierId}`),
    ]);
    setSupplier(nextSupplier);
    setBills(nextBills);
    setPurchaseOrders(getPurchaseOrders());
  }, [supplierId]);

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
  }, [loadData]);

  const supplierBills =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      if (!supplier) {
        return [];
      }

      return getSupplierBills(
        supplier,
        bills
      )
        .map((bill) => ({
          ...bill,

          balance:
            getBillBalance(bill),
        }))
        .sort((first, second) => {
          const firstDate =
            getDateTimestamp(
              first.createdAt,
              first.issueDate
            );

          const secondDate =
            getDateTimestamp(
              second.createdAt,
              second.issueDate
            );

          return secondDate - firstDate;
        });
    }, [supplier, bills]);

  const supplierPurchaseOrders =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      if (!supplier) {
        return [];
      }

      return purchaseOrders
        .filter((purchaseOrder) =>
          purchaseOrderBelongsToSupplier(
            purchaseOrder,
            supplier
          )
        )
        .sort((first, second) => {
          const firstDate =
            getDateTimestamp(
              first.createdAt,
              first.orderDate
            );

          const secondDate =
            getDateTimestamp(
              second.createdAt,
              second.orderDate
            );

          return secondDate - firstDate;
        });
    }, [
      supplier,
      purchaseOrders,
    ]);

  // Recalculates this value only when its inputs change.
  const summary = useMemo(() => {
    if (!supplier) {
      return {
        billCount: 0,
        draftCount: 0,
        totalPurchases: 0,
        amountPaid: 0,
        outstanding: 0,
        overdue: 0,
      };
    }

    return getSupplierSummary(
      supplier,
      bills
    );
  }, [supplier, bills]);

  const defaultExpenseAccount =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      if (!supplier) {
        return null;
      }

      return expenseAccounts.find(
        (account) =>
          account.code ===
          supplier.defaultExpenseAccount
      );
    }, [supplier]);

  const addressLines =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      if (!supplier) {
        return [];
      }

      return [
        supplier.address?.line1,
        supplier.address?.line2,
        supplier.address?.city,
        supplier.address?.county,
        supplier.address?.postcode,
        supplier.address?.country,
      ]
        .map((line) =>
          String(line || "").trim()
        )
        .filter(Boolean);
    }, [supplier]);

  // Handles status change.
  const handleStatusChange = async () => {
    if (!supplier) {
      return;
    }

    const nextStatus =
      supplier.status === "Active"
        ? "Inactive"
        : "Active";

    const actionText =
      nextStatus === "Inactive"
        ? "deactivate"
        : "reactivate";

    const confirmed =
      window.confirm(
        `Are you sure you want to ${actionText} ${supplier.name}?`
      );

    if (!confirmed) {
      return;
    }

    try {
      const updatedSupplier =
        await contactApiService.updateSupplier(
          supplier.id,
          { ...supplier, status: nextStatus }
        );

      setSupplier(updatedSupplier);
    } catch (error) {
      window.alert(
        normaliseApiError(error)
      );
    }
  };

  // Handles delete.
  const handleDelete = async () => {
    if (!supplier) {
      return;
    }

    if (
      supplierBills.length > 0 ||
      supplierPurchaseOrders.length > 0
    ) {
      window.alert(
        "This supplier cannot be deleted because linked bills or purchase orders exist. Deactivate the supplier instead."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Permanently delete ${supplier.name}? This action cannot be undone.`
      );

    if (!confirmed) {
      return;
    }

    try {
      await contactApiService.remove(supplier.id);

      navigate(
        "/purchases/suppliers",
        {
          replace: true,
        }
      );
    } catch (error) {
      window.alert(
        normaliseApiError(error)
      );
    }
  };

  if (!supplier) {
    return (
      <div className="invoice-details-page">
        <div className="invoice-back-row">
          <Link
            to="/purchases/suppliers"
            className="invoice-back-link"
          >
            <ArrowLeft size={17} />
            Back to suppliers
          </Link>
        </div>

        <section className="invoice-form-card">
          <h1>Supplier not found</h1>

          <p>
            The requested supplier record
            does not exist or may have
            been deleted.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="supplier-details-page">
      {searchParams.get("created") === "1" && (
        <div className="bank-page-success" role="status">
          Supplier created successfully.
        </div>
      )}
      <div className="invoice-back-row">
        <Link
          to="/purchases/suppliers"
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to suppliers
        </Link>
      </div>

      <header className="supplier-details-header">
        <div className="supplier-title-area">
          <div className="supplier-avatar">
            <Building2 size={25} />
          </div>

          <div>
            <div className="supplier-title-row">
              <h1>{supplier.name}</h1>

              <span
                className={`supplier-status supplier-status-${String(
                  supplier.status ||
                    "Inactive"
                ).toLowerCase()}`}
              >
                {supplier.status}
              </span>
            </div>

            <p>
              {supplier.accountNumber ||
                "No account number"}

              {supplier.contactName
                ? ` · ${supplier.contactName}`
                : ""}
            </p>
          </div>
        </div>

        <div className="invoice-details-actions">
          <Link
            to={`/purchases/suppliers/${supplier.id}/statement`}
            className="invoice-secondary-button"
          >
            <FileText size={17} />
            Statement
          </Link>
          <Link
            to={`/purchases/orders/new?supplierId=${supplier.id}`}
            className="invoice-secondary-button"
          >
            <ClipboardList size={17} />
            New purchase order
          </Link>

          <Link
            to={`/purchases/bills/new?supplierId=${supplier.id}`}
            className="page-primary-button"
          >
            <Plus size={17} />
            New bill
          </Link>

          <Link
            to={`/purchases/suppliers/${supplier.id}/edit`}
            className="invoice-secondary-button"
          >
            <Pencil size={17} />
            Edit supplier
          </Link>

          <button
            type="button"
            className={
              supplier.status === "Active"
                ? "invoice-danger-button"
                : "invoice-secondary-button"
            }
            onClick={
              handleStatusChange
            }
          >
            <Power size={17} />

            {supplier.status === "Active"
              ? "Deactivate"
              : "Reactivate"}
          </button>

          <button
            type="button"
            className="invoice-danger-button"
            onClick={handleDelete}
          >
            <Trash2 size={17} />
            Delete
          </button>
        </div>
      </header>

      <section className="invoice-summary-grid">
        <article className="invoice-summary-card">
          <span>
            Total purchases
          </span>

          <strong>
            {formatCurrency(
              summary.totalPurchases,
              supplier.currency
            )}
          </strong>

          <p>
            Across {summary.billCount}{" "}
            supplier bills
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Total paid</span>

          <strong>
            {formatCurrency(
              summary.amountPaid,
              supplier.currency
            )}
          </strong>

          <p>
            Payments recorded against
            supplier bills
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Outstanding</span>

          <strong>
            {formatCurrency(
              summary.outstanding,
              supplier.currency
            )}
          </strong>

          <p>
            Current unpaid supplier
            balance
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Overdue</span>

          <strong>
            {formatCurrency(
              summary.overdue,
              supplier.currency
            )}
          </strong>

          <p>
            Balance beyond the due date
          </p>
        </article>
      </section>

      <div className="supplier-details-layout">
        <main className="supplier-details-main">
          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <div>
                <h2>Supplier bills</h2>

                <p>
                  Purchase and payment
                  history for this
                  supplier.
                </p>
              </div>

              <Link
                to={`/purchases/bills/new?supplierId=${supplier.id}`}
                className="invoice-secondary-button"
              >
                <Plus size={17} />
                Add bill
              </Link>
            </div>

            {supplierBills.length >
            0 ? (
              <div className="invoice-table-wrapper">
                <table className="invoice-table supplier-bills-table">
                  <thead>
                    <tr>
                      <th>Bill</th>
                      <th>
                        Supplier reference
                      </th>
                      <th>Issue date</th>
                      <th>Due date</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Paid</th>
                      <th>
                        Outstanding
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {supplierBills
                      .slice(0, 10)
                      .map((bill) => (
                        <tr key={bill.id}>
                          <td>
                            <Link
                              to={`/purchases/bills/${bill.id}`}
                              className="invoice-number-link"
                            >
                              {
                                bill.billNumber
                              }
                            </Link>
                          </td>

                          <td>
                            {bill.supplierReference ||
                              "—"}
                          </td>

                          <td>
                            {bill.issueDate ||
                              "—"}
                          </td>

                          <td>
                            {bill.dueDate ||
                              "—"}
                          </td>

                          <td>
                            <span
                              className={`invoice-status bill-status-${getStatusClassName(
                                bill.status
                              )}`}
                            >
                              {bill.status}
                            </span>
                          </td>

                          <td>
                            <strong>
                              {formatCurrency(
                                bill.balance
                                  .total,
                                bill.currency ||
                                  supplier.currency
                              )}
                            </strong>
                          </td>

                          <td>
                            {formatCurrency(
                              bill.balance
                                .amountPaid,
                              bill.currency ||
                                supplier.currency
                            )}
                          </td>

                          <td>
                            <strong>
                              {formatCurrency(
                                bill.balance
                                  .outstanding,
                                bill.currency ||
                                  supplier.currency
                              )}
                            </strong>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="supplier-empty-bills">
                <ReceiptText size={34} />

                <h3>No bills yet</h3>

                <p>
                  Create the first bill
                  for this supplier.
                </p>

                <Link
                  to={`/purchases/bills/new?supplierId=${supplier.id}`}
                  className="page-primary-button"
                >
                  <Plus size={17} />
                  New bill
                </Link>
              </div>
            )}
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <div>
                <h2>Purchase orders</h2>

                <p>
                  Purchase orders created
                  for this supplier.
                </p>
              </div>

              <Link
                to={`/purchases/orders/new?supplierId=${supplier.id}`}
                className="invoice-secondary-button"
              >
                <Plus size={17} />
                New purchase order
              </Link>
            </div>

            {supplierPurchaseOrders.length >
            0 ? (
              <div className="invoice-table-wrapper">
                <table className="invoice-table">
                  <thead>
                    <tr>
                      <th>
                        Purchase order
                      </th>
                      <th>
                        Supplier reference
                      </th>
                      <th>Order date</th>
                      <th>
                        Expected delivery
                      </th>
                      <th>Status</th>
                      <th>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {supplierPurchaseOrders
                      .slice(0, 10)
                      .map(
                        (
                          purchaseOrder
                        ) => (
                          <tr
                            key={
                              purchaseOrder.id
                            }
                          >
                            <td>
                              <Link
                                to={`/purchases/orders/${purchaseOrder.id}`}
                                className="invoice-number-link"
                              >
                                {
                                  purchaseOrder.orderNumber
                                }
                              </Link>
                            </td>

                            <td>
                              {purchaseOrder.supplierReference ||
                                "—"}
                            </td>

                            <td>
                              {formatDate(
                                purchaseOrder.orderDate
                              )}
                            </td>

                            <td>
                              {formatDate(
                                purchaseOrder.expectedDeliveryDate
                              )}
                            </td>

                            <td>
                              <span
                                className={`invoice-status bill-status-${getStatusClassName(
                                  purchaseOrder.status
                                )}`}
                              >
                                {
                                  purchaseOrder.status
                                }
                              </span>
                            </td>

                            <td>
                              <strong>
                                {formatCurrency(
                                  purchaseOrder.total,
                                  purchaseOrder.currency ||
                                    supplier.currency
                                )}
                              </strong>
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="supplier-empty-bills">
                <ClipboardList
                  size={34}
                />

                <h3>
                  No purchase orders yet
                </h3>

                <p>
                  Create the first
                  purchase order for this
                  supplier.
                </p>

                <Link
                  to={`/purchases/orders/new?supplierId=${supplier.id}`}
                  className="page-primary-button"
                >
                  <Plus size={17} />
                  New purchase order
                </Link>
              </div>
            )}
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <div>
                <h2>Notes</h2>

                <p>
                  Internal supplier
                  information.
                </p>
              </div>
            </div>

            <div className="supplier-notes">
              <FileText size={20} />

              <p>
                {supplier.notes ||
                  "No notes have been added for this supplier."}
              </p>
            </div>
          </section>
        </main>

        <aside className="supplier-details-sidebar">
          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>Contact details</h2>
            </div>

            <div className="supplier-contact-list">
              <div className="supplier-contact-item">
                <Building2 size={18} />

                <div>
                  <span>
                    Contact person
                  </span>

                  <strong>
                    {supplier.contactName ||
                      "—"}
                  </strong>
                </div>
              </div>

              <div className="supplier-contact-item">
                <Mail size={18} />

                <div>
                  <span>Email</span>

                  {supplier.email ? (
                    <a
                      href={`mailto:${supplier.email}`}
                    >
                      {supplier.email}
                    </a>
                  ) : (
                    <strong>—</strong>
                  )}
                </div>
              </div>

              <div className="supplier-contact-item">
                <Phone size={18} />

                <div>
                  <span>Telephone</span>

                  {supplier.phone ? (
                    <a
                      href={`tel:${supplier.phone}`}
                    >
                      {supplier.phone}
                    </a>
                  ) : (
                    <strong>—</strong>
                  )}
                </div>
              </div>

              <div className="supplier-contact-item">
                <ExternalLink
                  size={18}
                />

                <div>
                  <span>Website</span>

                  {supplier.website ? (
                    <a
                      href={
                        supplier.website.startsWith(
                          "http"
                        )
                          ? supplier.website
                          : `https://${supplier.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Visit website
                    </a>
                  ) : (
                    <strong>—</strong>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>Address</h2>
            </div>

            <div className="supplier-address-card">
              <MapPin size={19} />

              <div>
                {addressLines.length >
                0 ? (
                  addressLines.map(
                    (line, index) => (
                      <p
                        key={`${line}-${index}`}
                      >
                        {line}
                      </p>
                    )
                  )
                ) : (
                  <p>
                    No address available.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>
                Financial settings
              </h2>
            </div>

            <div className="invoice-payment-summary">
              <div>
                <span>
                  Account number
                </span>

                <strong>
                  {supplier.accountNumber ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Payment terms
                </span>

                <strong>
                  {supplier.paymentTerms ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>Currency</span>

                <strong>
                  {supplier.currency ||
                    "GBP"}
                </strong>
              </div>

              <div>
                <span>
                  VAT or tax number
                </span>

                <strong>
                  {supplier.taxNumber ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Default expense
                </span>

                <strong>
                  {defaultExpenseAccount
                    ? `${defaultExpenseAccount.code} – ${defaultExpenseAccount.name}`
                    : supplier.defaultExpenseAccount ||
                      "—"}
                </strong>
              </div>
            </div>
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>
                Record information
              </h2>
            </div>

            <div className="invoice-payment-summary">
              <div>
                <span>Created</span>

                <strong>
                  {formatDate(
                    supplier.createdAt
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Last updated
                </span>

                <strong>
                  {formatDate(
                    supplier.updatedAt
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Draft bills
                </span>

                <strong>
                  {summary.draftCount}
                </strong>
              </div>

              <div>
                <span>
                  Purchase orders
                </span>

                <strong>
                  {
                    supplierPurchaseOrders.length
                  }
                </strong>
              </div>
            </div>
          </section>

          {summary.outstanding >
            0 && (
            <section className="supplier-balance-card">
              <CircleDollarSign
                size={22}
              />

              <div>
                <span>
                  Amount currently owed
                </span>

                <strong>
                  {formatCurrency(
                    summary.outstanding,
                    supplier.currency
                  )}
                </strong>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export default SupplierDetailsPage;
