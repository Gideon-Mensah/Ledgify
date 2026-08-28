import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Download,
  FileUp,
  Plus,
  Search,
} from "lucide-react";
import {
  Link,
} from "react-router-dom";

import PageHeader from "../layout/PageHeader";
import ContactImportModal from "../contacts/ContactImportModal";
import { useAuth } from "../../store/AuthContext";

import { purchasesApiService } from "../../services/purchasesApiService";
import { contactApiService } from "../../services/contactApiService";

import {
  getAllSupplierSummaries,
} from "../../utils/supplierCalculations";

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency,
    }
  ).format(Number(amount) || 0);

// Renders the supplier directory component.
function SupplierDirectory({
  eyebrow = "Purchases",
  description = "Manage supplier records, balances, terms and purchasing history.",
  newSupplierPath =
    "/purchases/suppliers/new",
  supplierDetailsBasePath =
    "/purchases/suppliers",
}) {
  const auth = useAuth();
  const [importing,setImporting]=useState(false);
  const [
    suppliers,
    setSuppliers,
  ] = useState([]);

  const [bills, setBills] =
    useState([]);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    activeStatus,
    setActiveStatus,
  ] = useState("All");

  const [
    selectedTerms,
    setSelectedTerms,
  ] = useState(
    "All payment terms"
  );

  // Loads data.
  const loadData = async () => {
    const [nextSuppliers, nextBills] = await Promise.all([
      contactApiService.suppliers(),
      purchasesApiService.list(),
    ]);
    setSuppliers(nextSuppliers);
    setBills(nextBills);
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

  const preparedSuppliers =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return getAllSupplierSummaries(
        suppliers,
        bills
      );
    }, [suppliers, bills]);

  const statusTabs = [
    "All",
    "Active",
    "Inactive",
  ];

  const statusCounts =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return preparedSuppliers.reduce(
        (counts, supplier) => {
          counts.All += 1;

          if (
            Object.prototype.hasOwnProperty.call(
              counts,
              supplier.status
            )
          ) {
            counts[
              supplier.status
            ] += 1;
          }

          return counts;
        },
        {
          All: 0,
          Active: 0,
          Inactive: 0,
        }
      );
    }, [preparedSuppliers]);

  const paymentTerms =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return [
        "All payment terms",
        ...new Set(
          preparedSuppliers
            .map(
              (supplier) =>
                supplier.paymentTerms
            )
            .filter(Boolean)
        ),
      ];
    }, [preparedSuppliers]);

  const filteredSuppliers =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      const search =
        searchTerm
          .trim()
          .toLowerCase();

      return preparedSuppliers.filter(
        (supplier) => {
          const addressText =
            Object.values(
              supplier.address || {}
            )
              .join(" ")
              .toLowerCase();

          const searchableValues = [
            supplier.name,
            supplier.contactName,
            supplier.email,
            supplier.phone,
            supplier.accountNumber,
            addressText,
          ];

          const matchesSearch =
            !search ||
            searchableValues.some(
              (value) =>
                String(value || "")
                  .toLowerCase()
                  .includes(search)
            );

          const matchesStatus =
            activeStatus === "All" ||
            supplier.status ===
              activeStatus;

          const matchesTerms =
            selectedTerms ===
              "All payment terms" ||
            supplier.paymentTerms ===
              selectedTerms;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesTerms
          );
        }
      );
    }, [
      preparedSuppliers,
      searchTerm,
      activeStatus,
      selectedTerms,
    ]);

  const pageSummary =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return preparedSuppliers.reduce(
        (summary, supplier) => {
          if (
            supplier.status ===
            "Active"
          ) {
            summary.activeSuppliers +=
              1;
          }

          summary.totalPurchases +=
            supplier.summary
              .totalPurchases;

          summary.outstanding +=
            supplier.summary
              .outstanding;

          summary.overdue +=
            supplier.summary.overdue;

          return summary;
        },
        {
          activeSuppliers: 0,
          totalPurchases: 0,
          outstanding: 0,
          overdue: 0,
        }
      );
    }, [preparedSuppliers]);

  // Handles export.
  const handleExport = () => {
    if (
      filteredSuppliers.length === 0
    ) {
      window.alert(
        "There are no suppliers to export."
      );

      return;
    }

    const headers = [
      "Account number",
      "Supplier",
      "Contact",
      "Email",
      "Phone",
      "Payment terms",
      "Status",
      "Bill count",
      "Total purchases",
      "Outstanding",
      "Overdue",
    ];

    const rows =
      filteredSuppliers.map(
        (supplier) => [
          supplier.accountNumber,
          supplier.name,
          supplier.contactName,
          supplier.email,
          supplier.phone,
          supplier.paymentTerms,
          supplier.status,
          supplier.summary
            .billCount,
          supplier.summary
            .totalPurchases.toFixed(
              2
            ),
          supplier.summary
            .outstanding.toFixed(
              2
            ),
          supplier.summary
            .overdue.toFixed(2),
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
      [csvContent],
      {
        type:
          "text/csv;charset=utf-8;",
      }
    );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download =
      "suppliers.csv";

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="suppliers-page">
      <PageHeader
        eyebrow={eyebrow}
        title="Suppliers"
        description={description}
        action={<div className="chart-accounts-header-actions">{auth.hasPermission("import_suppliers")&&<button className="invoice-secondary-button" onClick={()=>setImporting(true)}><FileUp size={18}/>Import Suppliers</button>}{auth.hasPermission("manage_contacts") ? (
          <Link
            to={newSupplierPath}
            className="page-primary-button"
          >
            <Plus size={18} />
            Create supplier
          </Link>
        ) : null}</div>}
      />

      <section className="invoice-summary-grid">
        <article className="invoice-summary-card">
          <span>
            Active suppliers
          </span>

          <strong>
            {
              pageSummary.activeSuppliers
            }
          </strong>

          <p>
            Currently available for new
            bills
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>
            Total purchases
          </span>

          <strong>
            {formatCurrency(
              pageSummary.totalPurchases
            )}
          </strong>

          <p>
            Total non-voided supplier
            bills
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>
            Outstanding
          </span>

          <strong>
            {formatCurrency(
              pageSummary.outstanding
            )}
          </strong>

          <p>
            Amount still owed to
            suppliers
          </p>
        </article>

        <article className="invoice-summary-card">
          <span>Overdue</span>

          <strong>
            {formatCurrency(
              pageSummary.overdue
            )}
          </strong>

          <p>
            Supplier balances past their
            due dates
          </p>
        </article>
      </section>

      <section className="invoice-list-card">
        <div className="invoice-status-tabs">
          {statusTabs.map(
            (status) => (
              <button
                key={status}
                type="button"
                className={
                  activeStatus === status
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
              placeholder="Search suppliers"
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
              value={selectedTerms}
              onChange={(event) =>
                setSelectedTerms(
                  event.target.value
                )
              }
            >
              {paymentTerms.map(
                (term) => (
                  <option
                    key={term}
                    value={term}
                  >
                    {term}
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

        <div className="invoice-table-wrapper">
          <table className="invoice-table suppliers-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact</th>
                <th>
                  Payment terms
                </th>
                <th>Status</th>
                <th>Bills</th>
                <th>
                  Total purchases
                </th>
                <th>
                  Outstanding
                </th>
                <th>Overdue</th>
              </tr>
            </thead>

            <tbody>
              {filteredSuppliers.map(
                (supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <Link
                        to={`${supplierDetailsBasePath}/${supplier.id}`}
                        className="invoice-number-link"
                      >
                        {supplier.name}
                      </Link>

                      <small>
                        {
                          supplier.accountNumber
                        }
                      </small>
                    </td>

                    <td>
                      <strong>
                        {supplier.contactName ||
                          "—"}
                      </strong>

                      <small>
                        {supplier.email ||
                          "No email"}
                      </small>

                      {supplier.phone && (
                        <small>
                          {supplier.phone}
                        </small>
                      )}
                    </td>

                    <td>
                      {supplier.paymentTerms}
                    </td>

                    <td>
                      <span
                        className={`supplier-status supplier-status-${String(
                          supplier.status ||
                            "inactive"
                        ).toLowerCase()}`}
                      >
                        {supplier.status}
                      </span>
                    </td>

                    <td>
                      <strong>
                        {
                          supplier.summary
                            .billCount
                        }
                      </strong>

                      {supplier.summary
                        .draftCount > 0 && (
                        <small>
                          {
                            supplier.summary
                              .draftCount
                          }{" "}
                          draft
                        </small>
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          supplier.summary
                            .totalPurchases,
                          supplier.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {formatCurrency(
                          supplier.summary
                            .outstanding,
                          supplier.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong
                        className={
                          supplier.summary
                            .overdue > 0
                            ? "supplier-overdue-value"
                            : ""
                        }
                      >
                        {formatCurrency(
                          supplier.summary
                            .overdue,
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

        {filteredSuppliers.length ===
          0 && (
          <div className="invoice-empty-state">
            <h3>
              No suppliers found
            </h3>

            <p>
              Try changing the search,
              status or payment terms
              filter.
            </p>
          </div>
        )}

        <div className="invoice-pagination">
          <p>
            Showing{" "}
            {
              filteredSuppliers.length
            }{" "}
            of{" "}
            {
              preparedSuppliers.length
            }{" "}
            suppliers
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
      {importing&&<ContactImportModal type="supplier" onClose={()=>setImporting(false)} onCompleted={loadData}/>}
    </div>
  );
}

export default SupplierDirectory;
