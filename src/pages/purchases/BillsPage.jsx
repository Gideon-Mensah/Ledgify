// List supplier bills and expose only actions permitted by their financial status.

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Download,
  Plus,
  Search,
  ShoppingCart,
} from "lucide-react";
import {
  Link,
  useNavigate,
} from "react-router-dom";

import PageHeader from "../../components/layout/PageHeader";

import { purchasesApiService } from "../../services/purchasesApiService";
import { contactApiService } from "../../services/contactApiService";
import { normaliseApiError } from "../../services/apiError";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { useAuth } from "../../store/AuthContext";
import BillRowActions from "../../components/bills/BillRowActions";
import Modal from "../../components/common/Modal";
import { downloadBillPdf } from "../../utils/billPdf";

import {
  getBillBalance,
} from "../../utils/billCalculations";

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

// Gets status class name.
const getStatusClassName = (
  status
) => {
  return String(status || "Draft")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
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
      `${value}T23:59:59`
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
        day,
        23,
        59,
        59
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

// Checks whether bill overdue is true.
const isBillOverdue = (
  bill,
  outstanding
) => {
  if (
    Number(outstanding) <= 0.005
  ) {
    return false;
  }

  const dueDate =
    parseDateValue(
      bill.dueDate
    );

  if (!dueDate) {
    return false;
  }

  return dueDate.getTime() <
    Date.now();
};

// Finds bill supplier.
const findBillSupplier = (
  bill,
  suppliers
) => {
  const supplierById =
    suppliers.find(
      (supplier) =>
        bill.supplierId !==
          undefined &&
        bill.supplierId !== null &&
        bill.supplierId !== "" &&
        Number(supplier.id) ===
          Number(bill.supplierId)
    );

  if (supplierById) {
    return supplierById;
  }

  const billSupplierName =
    bill.supplier ||
    bill.supplierName ||
    "";

  return (
    suppliers.find(
      (supplier) =>
        normaliseText(
          supplier.name
        ) ===
        normaliseText(
          billSupplierName
        )
    ) || null
  );
};

// Renders the bills page component.
function BillsPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [
    bills,
    setBills,
  ] = useState([]);

  const [
    supplierDirectory,
    setSupplierDirectory,
  ] = useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    activeStatus,
    setActiveStatus,
  ] = useState("All");

  const [
    selectedSupplier,
    setSelectedSupplier,
  ] = useState(
    "All suppliers"
  );
  const [loadError, setLoadError] = useState("");
  const [selectedBills, setSelectedBills] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionState, setActionState] = useState({ busy: false, error: "", success: "" });

  // Loads data.
  const loadData = async () => {
    try {
      const [nextBills, suppliers] = await Promise.all([
        purchasesApiService.list(),
        contactApiService.suppliers(),
      ]);
      setBills(nextBills);
      setSupplierDirectory(suppliers);
      setLoadError("");
    } catch (error) {
      setLoadError(normaliseApiError(error));
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

  const preparedBills =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return bills.map((bill) => {
        const balance =
          getBillBalance(bill);

        const linkedSupplier =
          findBillSupplier(
            bill,
            supplierDirectory
          );

        const supplierDisplayName =
          bill.supplier ||
          bill.supplierName ||
          linkedSupplier?.name ||
          "Unknown supplier";

        const supplierDisplayEmail =
          bill.supplierEmail ||
          linkedSupplier?.email ||
          "";

        const supplierAccountNumber =
          linkedSupplier
            ?.accountNumber || "";

        const supplierUrl =
          linkedSupplier?.id !==
            undefined &&
          linkedSupplier?.id !== null
            ? `/purchases/suppliers/${linkedSupplier.id}`
            : null;

        const hasPurchaseOrder =
          bill.purchaseOrderId !==
            undefined &&
          bill.purchaseOrderId !==
            null &&
          bill.purchaseOrderId !== "";

        const purchaseOrderUrl =
          hasPurchaseOrder
            ? `/purchases/orders/${bill.purchaseOrderId}`
            : null;

        let displayStatus =
          bill.status || "Draft";

        if (
          ![
            "Draft",
            "Awaiting approval",
            "Voided",
          ].includes(displayStatus)
        ) {
          if (
            balance.total > 0 &&
            balance.outstanding <=
              0.005
          ) {
            displayStatus = "Paid";
          } else if (
            displayStatus ===
            "Overdue"
          ) {
            displayStatus =
              "Overdue";
          } else if (
            balance.amountPaid >
            0.005
          ) {
            displayStatus =
              "Partly paid";
          } else if (
            isBillOverdue(
              bill,
              balance.outstanding
            )
          ) {
            displayStatus =
              "Overdue";
          }
        }

        return {
          ...bill,
          ...balance,

          linkedSupplier,

          supplierDisplayName,

          supplierDisplayEmail,

          supplierAccountNumber,

          supplierUrl,

          hasPurchaseOrder,

          purchaseOrderUrl,

          displayStatus,
        };
      });
    }, [
      bills,
      supplierDirectory,
    ]);

  const supplierFilterOptions =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      const supplierNames = [
        ...new Set(
          preparedBills
            .map(
              (bill) =>
                bill.supplierDisplayName
            )
            .filter(Boolean)
        ),
      ].sort((first, second) =>
        first.localeCompare(second)
      );

      return [
        "All suppliers",
        ...supplierNames,
      ];
    }, [preparedBills]);

  const statusTabs = [
    "All",
    "Draft",
    "Awaiting approval",
    "Awaiting payment",
    "Partly paid",
    "Paid",
    "Overdue",
    "Voided",
  ];

  const statusCounts =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return preparedBills.reduce(
        (counts, bill) => {
          counts.All += 1;

          if (
            Object.prototype.hasOwnProperty.call(
              counts,
              bill.displayStatus
            )
          ) {
            counts[
              bill.displayStatus
            ] += 1;
          }

          return counts;
        },
        {
          All: 0,
          Draft: 0,
          "Awaiting approval": 0,
          "Awaiting payment": 0,
          "Partly paid": 0,
          Paid: 0,
          Overdue: 0,
          Voided: 0,
        }
      );
    }, [preparedBills]);

  const filteredBills =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      const search =
        normaliseText(
          searchTerm
        );

      return preparedBills.filter(
        (bill) => {
          const searchableValues = [
            bill.billNumber,
            bill.supplierReference,
            bill.supplierDisplayName,
            bill.supplierDisplayEmail,
            bill.supplierAccountNumber,
            bill.category,
            bill.purchaseOrderNumber,
            bill.status,
            bill.displayStatus,
          ];

          const matchesSearch =
            !search ||
            searchableValues.some(
              (value) =>
                normaliseText(
                  value
                ).includes(search)
            );

          const matchesStatus =
            activeStatus === "All" ||
            bill.displayStatus ===
              activeStatus;

          const matchesSupplier =
            selectedSupplier ===
              "All suppliers" ||
            bill.supplierDisplayName ===
              selectedSupplier;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesSupplier
          );
        }
      );
    }, [
      preparedBills,
      searchTerm,
      activeStatus,
      selectedSupplier,
    ]);
  const pagination = useTablePagination(filteredBills);
  const openBill = (billId) => navigate(`/purchases/bills/${billId}`);
  const visibleBillIds = pagination.pageRows.map((bill) => bill.id);
  const allVisibleSelected = visibleBillIds.length > 0 && visibleBillIds.every((id) => selectedBills.includes(id));
  const toggleVisibleBills = () => setSelectedBills((current) => allVisibleSelected
    ? current.filter((id) => !visibleBillIds.includes(id))
    : [...new Set([...current, ...visibleBillIds])]);
  const toggleBill = (billId) => setSelectedBills((current) => current.includes(billId)
    ? current.filter((id) => id !== billId)
    : [...current, billId]);
  const duplicateBill = async (bill) => {
    setActionState({ busy: true, error: "", success: "" });
    try {
      const copy = await purchasesApiService.duplicate(bill.id);
      navigate(`/purchases/bills/${copy.id}/edit?duplicated=1`);
    } catch (error) {
      setActionState({ busy: false, error: normaliseApiError(error), success: "" });
    }
  };
  const deleteBill = async () => {
    if (!deleteTarget) return;
    setActionState({ busy: true, error: "", success: "" });
    try {
      await purchasesApiService.remove(deleteTarget.id);
      setBills((current) => current.filter((bill) => bill.id !== deleteTarget.id));
      setSelectedBills((current) => current.filter((id) => id !== deleteTarget.id));
      setDeleteTarget(null);
      setActionState({ busy: false, error: "", success: "Bill deleted successfully." });
    } catch (error) {
      setActionState({ busy: false, error: normaliseApiError(error), success: "" });
    }
  };

  // Recalculates this value only when its inputs change.
  const summary = useMemo(() => {
    return preparedBills.reduce(
      (totals, bill) => {
        if (
          bill.displayStatus ===
          "Voided"
        ) {
          return totals;
        }

        totals.totalBills +=
          Number(bill.total) || 0;

        totals.totalPaid +=
          Number(
            bill.amountPaid
          ) || 0;

        totals.outstanding +=
          Number(
            bill.outstanding
          ) || 0;

        if (
          bill.displayStatus ===
          "Overdue"
        ) {
          totals.overdue +=
            Number(
              bill.outstanding
            ) || 0;
        }

        return totals;
      },
      {
        totalBills: 0,
        totalPaid: 0,
        outstanding: 0,
        overdue: 0,
      }
    );
  }, [preparedBills]);

  // Handles export.
  const handleExport = () => {
    if (
      filteredBills.length === 0
    ) {
      window.alert(
        "There are no bills to export."
      );

      return;
    }

    const headers = [
      "Bill number",
      "Supplier invoice number",
      "Supplier",
      "Supplier account",
      "Supplier email",
      "Purchase order",
      "Issue date",
      "Due date",
      "Status",
      "Currency",
      "Total",
      "Paid",
      "Outstanding",
      "Category",
    ];

    const rows =
      filteredBills.map(
        (bill) => [
          bill.billNumber,
          bill.supplierReference,
          bill.supplierDisplayName,
          bill.supplierAccountNumber,
          bill.supplierDisplayEmail,
          bill.purchaseOrderNumber ||
            "",
          bill.issueDate,
          bill.dueDate,
          bill.displayStatus,
          bill.currency || "GBP",
          Number(
            bill.total
          ).toFixed(2),
          Number(
            bill.amountPaid
          ).toFixed(2),
          Number(
            bill.outstanding
          ).toFixed(2),
          bill.category,
        ]
      );

    const csvContent = [
      headers,
      ...rows,
    ]
      .map((row) =>
        row
          .map((value) => {
            const escapedValue =
              String(
                value ?? ""
              ).replaceAll(
                '"',
                '""'
              );

            return `"${escapedValue}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob(
      [
        "\ufeff",
        csvContent,
      ],
      {
        type: "text/csv;charset=utf-8;",
      }
    );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement(
        "a"
      );

    link.href = url;

    link.download =
      "supplier-bills.csv";

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="bills-page">
      {loadError && <div className="invoice-form-alert">{loadError}</div>}
      <PageHeader
        eyebrow="Purchases"
        title="Bills"
        description="Manage supplier bills, approvals and payments."
        action={auth.hasPermission("create_bill") ? (
          <Link
            to="/purchases/bills/new"
            className="page-primary-button"
          >
            <Plus size={18} />
            New bill
          </Link>
        ) : null}
      />

      <section className="invoice-summary-grid">
        <article className="invoice-summary-card">
          <span>
            Total bill value
          </span>

          <strong>
            {formatCurrency(
              summary.totalBills
            )}
          </strong>

          <p>
            Across{" "}
            {preparedBills.length}{" "}
            supplier bills
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Total paid</span>

          <strong>
            {formatCurrency(
              summary.totalPaid
            )}
          </strong>

          <p>
            Payments recorded against
            bills
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Outstanding</span>

          <strong>
            {formatCurrency(
              summary.outstanding
            )}
          </strong>

          <p>
            Remaining supplier balance
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Overdue</span>

          <strong>
            {formatCurrency(
              summary.overdue
            )}
          </strong>

          <p>
            Bills past their due dates
          </p>
        </article>
      </section>

      <section className="invoice-list-card">
        {actionState.error && <div className="invoice-form-alert" role="alert">{actionState.error}</div>}
        {actionState.success && <div className="bank-page-success" role="status">{actionState.success}</div>}
        <div className="invoice-status-tabs">
          {statusTabs.map(
            (status) => (
              <button
                key={status}
                type="button"
                className={
                  activeStatus ===
                  status
                    ? "invoice-status-tab invoice-status-tab-active"
                    : "invoice-status-tab"
                }
                onClick={() =>
                  setActiveStatus(
                    status
                  )
                }
              >
                {status}

                <span>
                  {statusCounts[
                    status
                  ] || 0}
                </span>
              </button>
            )
          )}
        </div>

        <div className="invoice-list-toolbar">
          <div className="invoice-search-box">
            <Search size={18} />

            <input
              type="search"
              placeholder="Search bills, suppliers or purchase orders"
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
              value={
                selectedSupplier
              }
              onChange={(event) =>
                setSelectedSupplier(
                  event.target.value
                )
              }
            >
              {supplierFilterOptions.map(
                (supplierName) => (
                  <option
                    key={supplierName}
                    value={supplierName}
                  >
                    {supplierName}
                  </option>
                )
              )}
            </select>

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

        {selectedBills.length > 0 && (
          <div className="invoice-selection-bar">
            <span>{selectedBills.length} bill{selectedBills.length === 1 ? "" : "s"} selected</span>
            <button type="button" onClick={() => setSelectedBills([])}>Clear selection</button>
          </div>
        )}

        <div className="invoice-table-wrapper">
          <table className="invoice-table bills-table">
            <thead>
              <tr>
                <th className="invoice-checkbox-column">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleBills} aria-label="Select all visible bills" />
                </th>
                <th>Bill</th>
                <th>Supplier</th>
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
              {pagination.pageRows.map(
                (bill) => (
                  <tr key={bill.id} className="bill-clickable-row" tabIndex="0" onClick={(event) => { if (!event.target.closest("a, button, input, select")) openBill(bill.id); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); openBill(bill.id); } }} aria-label={`View bill ${bill.billNumber}`}>
                    <td className="invoice-checkbox-column">
                      <input type="checkbox" checked={selectedBills.includes(bill.id)} onChange={() => toggleBill(bill.id)} aria-label={`Select ${bill.billNumber}`} />
                    </td>
                    <td>
                      <Link
                        to={`/purchases/bills/${bill.id}`}
                        className="invoice-number-link"
                      >
                        {bill.billNumber}
                      </Link>

                      {bill.supplierReference && (
                        <small>
                          {
                            bill.supplierReference
                          }
                        </small>
                      )}

                      {bill.purchaseOrderUrl && (
                        <small>
                          <ShoppingCart
                            size={13}
                          />

                          <Link
                            to={
                              bill.purchaseOrderUrl
                            }
                            className="invoice-number-link"
                          >
                            {bill.purchaseOrderNumber ||
                              `PO #${bill.purchaseOrderId}`}
                          </Link>
                        </small>
                      )}
                    </td>

                    <td>
                      {bill.supplierUrl ? (
                        <Link
                          to={bill.supplierUrl}
                          className="invoice-number-link"
                        >
                          {
                            bill.supplierDisplayName
                          }
                        </Link>
                      ) : (
                        <strong>
                          {
                            bill.supplierDisplayName
                          }
                        </strong>
                      )}

                      {bill.supplierDisplayEmail && (
                        <small>
                          <a
                            href={`mailto:${bill.supplierDisplayEmail}`}
                          >
                            {
                              bill.supplierDisplayEmail
                            }
                          </a>
                        </small>
                      )}
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
                          bill.displayStatus
                        )}`}
                      >
                        {
                          bill.displayStatus
                        }
                      </span>
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          bill.total,
                          bill.currency
                        )}
                      </strong>

                      {bill.hasPurchaseOrder && (
                        <small>
                          From purchase
                          order
                        </small>
                      )}
                    </td>

                    <td>
                      {formatCurrency(
                        bill.amountPaid,
                        bill.currency
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          bill.outstanding,
                          bill.currency
                        )}
                      </strong>
                    </td>
                    <td><BillRowActions bill={bill} onDuplicate={duplicateBill} onDownload={downloadBillPdf} onDelete={setDeleteTarget} /></td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        <TablePagination {...pagination} />

        {filteredBills.length ===
          0 && (
          <div className="invoice-empty-state">
            <h3>
              No bills found
            </h3>

            <p>
              Try changing the search
              term, supplier or status
              filter.
            </p>

            {preparedBills.length ===
              0 && (
              <Link
                to="/purchases/bills/new"
                className="page-primary-button"
              >
                <Plus size={17} />
                New bill
              </Link>
            )}
          </div>
        )}

      </section>
      <Modal
        isOpen={Boolean(deleteTarget)}
        title="Delete bill?"
        description="This draft bill will be permanently removed. This action cannot be undone."
        onClose={() => !actionState.busy && setDeleteTarget(null)}
        footer={<><button type="button" className="modal-secondary-button" disabled={actionState.busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="invoice-danger-button" disabled={actionState.busy} onClick={() => void deleteBill()}>{actionState.busy ? "Deleting…" : "Delete bill"}</button></>}
      >
        <p><strong>{deleteTarget?.billNumber}</strong> · {deleteTarget?.supplierDisplayName}</p>
      </Modal>
    </div>
  );
}

export default BillsPage;
