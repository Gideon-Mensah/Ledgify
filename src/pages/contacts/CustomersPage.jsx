import {
  Mail,
  FileUp,
  Plus,
  Search,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Link,
  useNavigate,
} from "react-router-dom";

import PageHeader from "../../components/layout/PageHeader";
import ContactImportModal from "../../components/contacts/ContactImportModal";
import { contactApiService } from "../../services/contactApiService";
import { normaliseApiError } from "../../services/apiError";
import { useAuth } from "../../store/AuthContext";

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Gets customer initials.
const getCustomerInitials = (name) => {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "CU";
  }

  return words
    .slice(0, 2)
    .map((word) =>
      word.charAt(0).toUpperCase()
    )
    .join("");
};

// Renders the customers page component.
function CustomersPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [importing,setImporting]=useState(false);

  const [customers, setCustomers] = useState([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    contactApiService.customers().then((data) => {
      if (!cancelled) setCustomers(data);
    }).catch((error) => {
      if (!cancelled) setLoadError(normaliseApiError(error));
    });
    return () => { cancelled = true; };
  }, []);

  const [searchTerm, setSearchTerm] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("All");

  // Recalculates this value only when its inputs change.
  const customerSummary = useMemo(() => {
    const now = new Date();

    const newThisMonth =
      customers.filter((customer) => {
        if (!customer.createdAt) {
          return false;
        }

        const createdDate =
          new Date(customer.createdAt);

        return (
          createdDate.getMonth() ===
            now.getMonth() &&
          createdDate.getFullYear() ===
            now.getFullYear()
        );
      }).length;

    return {
      total: customers.length,

      active: customers.filter(
        (customer) =>
          customer.status === "Active"
      ).length,

      inactive: customers.filter(
        (customer) =>
          customer.status === "Inactive"
      ).length,

      newThisMonth,
    };
  }, [customers]);

  const filteredCustomers =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      const search =
        normaliseText(searchTerm);

      return customers.filter(
        (customer) => {
          const matchesStatus =
            statusFilter === "All" ||
            customer.status ===
              statusFilter;

          const matchesSearch =
            !search ||
            [
              customer.name,
              customer.contactName,
              customer.email,
              customer.phone,
              customer.accountNumber,
            ].some((value) =>
              normaliseText(
                value
              ).includes(search)
            );

          return (
            matchesStatus &&
            matchesSearch
          );
        }
      );
    }, [
      customers,
      searchTerm,
      statusFilter,
    ]);

  // Opens customer.
  const openCustomer = (customerId) => {
    navigate(
      `/contacts/customers/${customerId}`
    );
  };

  return (
    <div className="customers-page">
      {loadError && <div className="invoice-form-alert">{loadError}</div>}
      <PageHeader
        eyebrow="Contacts"
        title="Customers"
        description="Manage customer details, account information and sales activity."
        action={<div className="chart-accounts-header-actions">{auth.hasPermission("import_customers")&&<button className="invoice-secondary-button" onClick={()=>setImporting(true)}><FileUp size={18}/>Import Customers</button>}
          <Link
            to="/contacts/customers/new"
            className="page-primary-button"
          >
            <Plus size={18} />
            Add Customer
          </Link></div>}
      />

      <div className="customers-summary-grid">
        <article className="customers-summary-card">
          <div className="customers-summary-card__icon">
            <Users size={21} />
          </div>

          <div>
            <span>Total Customers</span>
            <strong>
              {customerSummary.total}
            </strong>
          </div>
        </article>

        <article className="customers-summary-card">
          <div className="customers-summary-card__icon">
            <UserCheck size={21} />
          </div>

          <div>
            <span>Active Customers</span>
            <strong>
              {customerSummary.active}
            </strong>
          </div>
        </article>

        <article className="customers-summary-card">
          <div className="customers-summary-card__icon">
            <UserX size={21} />
          </div>

          <div>
            <span>Inactive Customers</span>
            <strong>
              {customerSummary.inactive}
            </strong>
          </div>
        </article>

        <article className="customers-summary-card">
          <div className="customers-summary-card__icon">
            <UserPlus size={21} />
          </div>

          <div>
            <span>New This Month</span>
            <strong>
              {
                customerSummary.newThisMonth
              }
            </strong>
          </div>
        </article>
      </div>

      <section className="customers-directory-card">
        <div className="customers-toolbar">
          <label className="customers-search">
            <Search size={18} />

            <input
              type="search"
              placeholder="Search by name, email, phone or account number"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(
                  event.target.value
                )
              }
            />
          </label>

          <div className="customers-status-filters">
            {[
              "All",
              "Active",
              "Inactive",
            ].map((status) => (
              <button
                key={status}
                type="button"
                className={`customers-filter-button ${
                  statusFilter === status
                    ? "customers-filter-button--active"
                    : ""
                }`}
                onClick={() =>
                  setStatusFilter(status)
                }
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {filteredCustomers.length > 0 ? (
          <div className="customers-table-wrapper">
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Account Number</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {filteredCustomers.map(
                  (customer) => (
                    <tr
                      key={customer.id}
                      className="customers-table-row"
                      tabIndex={0}
                      onClick={() =>
                        openCustomer(
                          customer.id
                        )
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key ===
                            "Enter" ||
                          event.key === " "
                        ) {
                          event.preventDefault();

                          openCustomer(
                            customer.id
                          );
                        }
                      }}
                    >
                      <td>
                        <div className="customers-contact">
                          <div className="customers-avatar">
                            {getCustomerInitials(
                              customer.name
                            )}
                          </div>

                          <div className="customers-contact__details">
                            <Link
                              to={`/contacts/customers/${customer.id}`}
                              className="customer-name-link"
                              onClick={(
                                event
                              ) =>
                                event.stopPropagation()
                              }
                            >
                              {
                                customer.name
                              }
                            </Link>

                            <span>
                              <Mail
                                size={13}
                              />

                              {customer.email ||
                                "No email address"}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        {customer.accountNumber ||
                          "—"}
                      </td>

                      <td>
                        {customer.contactName ||
                          "—"}
                      </td>

                      <td>
                        {customer.phone ||
                          "—"}
                      </td>

                      <td>
                        <span
                          className={`customers-status ${
                            customer.status ===
                            "Active"
                              ? "customers-status--active"
                              : "customers-status--inactive"
                          }`}
                        >
                          {customer.status}
                        </span>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="customers-empty-state">
            <Users size={36} />

            <h2>
              No customers found
            </h2>

            <p>
              Try changing your search or
              status filter.
            </p>
          </div>
        )}
      </section>
      {importing&&<ContactImportModal type="customer" onClose={()=>setImporting(false)} onCompleted={async()=>setCustomers(await contactApiService.customers())}/>}</div>
  );
}

export default CustomersPage;
