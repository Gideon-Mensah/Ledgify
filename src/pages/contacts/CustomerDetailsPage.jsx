import {
  ArrowLeft,
  Users,
} from "lucide-react";
import {
  useEffect,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import CustomerActivityCard from "../../components/contacts/CustomerActivityCard";
import CustomerHeader from "../../components/contacts/CustomerHeader";
import CustomerInformationCards from "../../components/contacts/CustomerInformationCards";
import CustomerInvoicesCard from "../../components/contacts/CustomerInvoicesCard";
import CustomerSummaryCards from "../../components/contacts/CustomerSummaryCards";

import { contactApiService } from "../../services/contactApiService";
import { salesApiService } from "../../services/salesApiService";
import { normaliseApiError } from "../../services/apiError";

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

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

      const vatRate =
        Number(item.vatRate) || 0;

      const subtotal =
        quantity * unitPrice;

      if (
        invoice.pricingMode ===
          "inclusive" ||
        invoice.pricingMode ===
          "no-tax"
      ) {
        return total + subtotal;
      }

      const vat =
        subtotal * (vatRate / 100);

      return total + subtotal + vat;
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
    invoice.customerId !== undefined &&
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

// Renders the customer details page component.
function CustomerDetailsPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();

  const [customer, setCustomer] =
    useState(null);
  const [allInvoices, setAllInvoices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([contactApiService.get(customerId), salesApiService.list(`customer=${customerId}`)])
      .then(([nextCustomer, invoices]) => {
        if (!cancelled) {
          setCustomer(nextCustomer);
          setAllInvoices(invoices);
        }
      })
      .catch((error) => {
        if (!cancelled) window.alert(normaliseApiError(error));
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [customerId]);

  if (isLoading) return <div className="customer-not-found">Loading customer…</div>;

  if (!customer) {
    return (
      <div className="customer-not-found">
        <div className="customer-not-found__icon">
          <Users size={28} />
        </div>

        <h1>Customer not found</h1>

        <p>
          This customer may have been
          deleted or the link is incorrect.
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

  const customerInvoices =
    allInvoices.filter((invoice) =>
      belongsToCustomer(
        invoice,
        customer
      )
    );

  const financialSummary =
    customerInvoices.reduce(
      (summary, invoice) => {
        const invoiceTotal =
          calculateInvoiceTotal(invoice);

        const amountPaid =
          Number(invoice.amountPaid) || 0;

        return {
          totalSales:
            summary.totalSales +
            invoiceTotal,

          totalPaid:
            summary.totalPaid +
            amountPaid,

          outstandingBalance:
            summary.outstandingBalance +
            Math.max(
              invoiceTotal -
                amountPaid,
              0
            ),
        };
      },
      {
        totalSales: 0,
        totalPaid: 0,
        outstandingBalance: 0,
      }
    );

  const currency =
    customer.currency ||
    customerInvoices[0]?.currency ||
    "GBP";

  // Handles toggle status.
  const handleToggleStatus = async () => {
    const nextStatus =
      customer.status === "Active"
        ? "Inactive"
        : "Active";

    const action =
      nextStatus === "Inactive"
        ? "archive"
        : "restore";

    const confirmed = window.confirm(
      `Are you sure you want to ${action} ${customer.name}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const updatedCustomer =
        await contactApiService.updateCustomer(
          customer.id,
          { ...customer, status: nextStatus }
        );

      setCustomer(updatedCustomer);
    } catch (error) {
      window.alert(
        error.message ||
          "Unable to update customer status."
      );
    }
  };

  // Handles delete.
  const handleDelete = async () => {
    if (
      customerInvoices.length > 0
    ) {
      window.alert(
        "This customer cannot be deleted because linked invoices exist. Archive the customer instead."
      );

      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${customer.name}? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await contactApiService.remove(customer.id);

      navigate(
        "/contacts/customers",
        {
          replace: true,
        }
      );
    } catch (error) {
      window.alert(
        error.message ||
          "Unable to delete customer."
      );
    }
  };

  return (
    <div className="customer-details-page">
      <CustomerHeader
        customer={customer}
        onToggleStatus={
          handleToggleStatus
        }
        onDelete={handleDelete}
      />

      <CustomerSummaryCards
        outstandingBalance={
          financialSummary.outstandingBalance
        }
        totalSales={
          financialSummary.totalSales
        }
        totalPaid={
          financialSummary.totalPaid
        }
        creditLimit={
          customer.creditLimit
        }
        currency={currency}
      />

      <CustomerInformationCards
        customer={customer}
      />

      <CustomerInvoicesCard
        customer={customer}
        invoices={customerInvoices}
      />

      <CustomerActivityCard
        customer={customer}
        invoices={customerInvoices}
      />
    </div>
  );
}

export default CustomerDetailsPage;
