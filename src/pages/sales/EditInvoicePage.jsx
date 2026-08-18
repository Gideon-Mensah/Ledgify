// Allow changes only while the backend invoice remains an editable draft.

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import {
  editInvoice,
  getInvoiceById,
} from "../../services/invoiceService";

const customers = [
  {
    id: 1,
    name: "Bluewave Consulting",
    email: "accounts@bluewaveconsulting.co.uk",
    address: [
      "18 Victoria Street",
      "Manchester",
      "M1 4AB",
      "United Kingdom",
    ],
  },
  {
    id: 2,
    name: "Northstar Retail",
    email: "finance@northstarretail.co.uk",
    address: [
      "24 Market Road",
      "Leeds",
      "LS1 6DT",
      "United Kingdom",
    ],
  },
  {
    id: 3,
    name: "Oakfield Services",
    email: "accounts@oakfieldservices.co.uk",
    address: [
      "14 Westfield Road",
      "Sheffield",
      "S10 2AB",
      "United Kingdom",
    ],
  },
];

const products = [
  {
    id: 1,
    name: "Accounting consultation",
    description:
      "Professional accounting consultation service",
    unitPrice: 150,
    vatRate: 20,
  },
  {
    id: 2,
    name: "Monthly bookkeeping",
    description:
      "Monthly bookkeeping and financial records management",
    unitPrice: 350,
    vatRate: 20,
  },
  {
    id: 3,
    name: "Payroll processing",
    description:
      "Monthly employee payroll processing",
    unitPrice: 250,
    vatRate: 20,
  },
  {
    id: 4,
    name: "VAT return preparation",
    description:
      "Preparation and review of VAT return",
    unitPrice: 180,
    vatRate: 20,
  },
];

// Creates empty item.
const createEmptyItem = () => ({
  id: crypto.randomUUID(),
  productId: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  discountRate: 0,
  vatRate: 20,
});

// Parses display date.
const parseDisplayDate = (dateValue) => {
  if (!dateValue) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }

  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  const year = parsedDate.getFullYear();
  const month = String(
    parsedDate.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    parsedDate.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// Formats display date.
const formatDisplayDate = (date) => {
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
};

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(amount) || 0);

// Renders the edit invoice page component.
function EditInvoicePage() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState(null);
  const [invoiceDetails, setInvoiceDetails] =
    useState(null);
  const [items, setItems] = useState([]);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] =
    useState(false);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => {
    const selectedInvoice =
      getInvoiceById(invoiceId);

    if (!selectedInvoice) {
      setInvoice(null);
      return;
    }

    setInvoice(selectedInvoice);

    const matchedCustomer = customers.find(
      (customer) =>
        customer.name ===
        selectedInvoice.customer
    );

    setInvoiceDetails({
      customerId:
        matchedCustomer?.id?.toString() || "",
      customerName:
        selectedInvoice.customer || "",
      customerEmail:
        selectedInvoice.customerEmail || "",
      customerAddress:
        selectedInvoice.customerAddress || [],
      invoiceNumber:
        selectedInvoice.invoiceNumber || "",
      invoiceDate: parseDisplayDate(
        selectedInvoice.issueDate
      ),
      dueDate: parseDisplayDate(
        selectedInvoice.dueDate
      ),
      reference:
        selectedInvoice.reference || "",
      currency:
        selectedInvoice.currency || "GBP",
      pricingMode:
        selectedInvoice.pricingMode ||
        "exclusive",
      notes: selectedInvoice.notes || "",
      status: selectedInvoice.status || "Draft",
    });

    setItems(
      (selectedInvoice.items || []).map(
        (item) => ({
          ...item,
          id:
            item.id ||
            crypto.randomUUID(),
          productId:
            item.productId || "",
          discountRate:
            Number(item.discountRate) || 0,
        })
      )
    );
    });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [invoiceId]);

  const selectedCustomer =
    customers.find(
      (customer) =>
        customer.id ===
        Number(invoiceDetails?.customerId)
    );

  // Recalculates this value only when its inputs change.
  const totals = useMemo(() => {
    if (!invoiceDetails) {
      return {
        subtotal: 0,
        discount: 0,
        vat: 0,
        total: 0,
      };
    }

    return items.reduce(
      (summary, item) => {
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
          grossAmount - discountAmount;

        let netAmount = discountedAmount;
        let vatAmount =
          discountedAmount *
          (vatRate / 100);

        if (
          invoiceDetails.pricingMode ===
          "inclusive"
        ) {
          netAmount =
            discountedAmount /
            (1 + vatRate / 100);

          vatAmount =
            discountedAmount - netAmount;
        }

        summary.subtotal += netAmount;
        summary.discount += discountAmount;
        summary.vat += vatAmount;
        summary.total +=
          netAmount + vatAmount;

        return summary;
      },
      {
        subtotal: 0,
        discount: 0,
        vat: 0,
        total: 0,
      }
    );
  }, [items, invoiceDetails]);

  if (!invoice || !invoiceDetails) {
    return (
      <div className="new-invoice-page">
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
          <h1>Invoice not found</h1>
          <p>
            The invoice you are trying to edit
            does not exist.
          </p>
        </section>
      </div>
    );
  }

  // Handles invoice change.
  const handleInvoiceChange = (event) => {
    const { name, value } = event.target;

    setInvoiceDetails((currentDetails) => ({
      ...currentDetails,
      [name]: value,
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      [name]: "",
    }));
  };

  // Handles customer change.
  const handleCustomerChange = (event) => {
    const customerId = event.target.value;

    setInvoiceDetails((currentDetails) => ({
      ...currentDetails,
      customerId,
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      customerId: "",
    }));
  };

  // Handles product change.
  const handleProductChange = (
    itemId,
    productId
  ) => {
    const selectedProduct = products.find(
      (product) =>
        product.id === Number(productId)
    );

    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              productId,
              description:
                selectedProduct?.description ||
                "",
              unitPrice:
                selectedProduct?.unitPrice || 0,
              vatRate:
                selectedProduct?.vatRate || 0,
            }
          : item
      )
    );
  };

  // Handles item change.
  const handleItemChange = (
    itemId,
    field,
    value
  ) => {
    const numericFields = [
      "quantity",
      "unitPrice",
      "discountRate",
      "vatRate",
    ];

    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]:
                numericFields.includes(field)
                  ? Number(value)
                  : value,
            }
          : item
      )
    );
  };

  // Adds item.
  const addItem = () => {
    setItems((currentItems) => [
      ...currentItems,
      createEmptyItem(),
    ]);
  };

  // Removes item.
  const removeItem = (itemId) => {
    if (items.length === 1) {
      return;
    }

    setItems((currentItems) =>
      currentItems.filter(
        (item) => item.id !== itemId
      )
    );
  };

  // Validates invoice.
  const validateInvoice = () => {
    const nextErrors = {};

    if (
      !invoiceDetails.customerId &&
      !invoiceDetails.customerName
    ) {
      nextErrors.customerId =
        "Select a customer.";
    }

    if (
      !invoiceDetails.invoiceNumber.trim()
    ) {
      nextErrors.invoiceNumber =
        "Enter an invoice number.";
    }

    if (!invoiceDetails.invoiceDate) {
      nextErrors.invoiceDate =
        "Select an invoice date.";
    }

    if (!invoiceDetails.dueDate) {
      nextErrors.dueDate =
        "Select a due date.";
    }

    if (
      invoiceDetails.invoiceDate &&
      invoiceDetails.dueDate &&
      invoiceDetails.dueDate <
        invoiceDetails.invoiceDate
    ) {
      nextErrors.dueDate =
        "The due date cannot be before the invoice date.";
    }

    const validItems = items.filter(
      (item) =>
        item.description.trim() &&
        Number(item.quantity) > 0
    );

    if (validItems.length === 0) {
      nextErrors.items =
        "Add at least one valid invoice item.";
    }

    setErrors(nextErrors);

    return (
      Object.keys(nextErrors).length === 0
    );
  };

  // Handles save.
  const handleSave = () => {
    if (!validateInvoice()) {
      return;
    }

    setIsSaving(true);

    try {
      const customer =
        selectedCustomer || {
          name: invoiceDetails.customerName,
          email: invoiceDetails.customerEmail,
          address:
            invoiceDetails.customerAddress,
        };

      const updatedInvoice = editInvoice(
        invoice.id,
        {
          invoiceNumber:
            invoiceDetails.invoiceNumber.trim(),
          customer: customer.name,
          customerEmail:
            customer.email || "",
          customerAddress:
            customer.address || [],
          issueDate: formatDisplayDate(
            invoiceDetails.invoiceDate
          ),
          dueDate: formatDisplayDate(
            invoiceDetails.dueDate
          ),
          reference:
            invoiceDetails.reference.trim(),
          currency:
            invoiceDetails.currency,
          pricingMode:
            invoiceDetails.pricingMode,
          notes:
            invoiceDetails.notes.trim(),
          status: invoiceDetails.status,
          items: items
            .filter(
              (item) =>
                item.description.trim() &&
                Number(item.quantity) > 0
            )
            .map((item) => ({
              id:
                item.id ||
                crypto.randomUUID(),
              productId:
                item.productId || "",
              description:
                item.description.trim(),
              quantity:
                Number(item.quantity),
              unitPrice:
                Number(item.unitPrice),
              discountRate:
                Number(
                  item.discountRate
                ) || 0,
              vatRate:
                Number(item.vatRate) || 0,
            })),
        }
      );

      navigate(
        `/sales/invoices/${updatedInvoice.id}`
      );
    } catch (error) {
      console.error(
        "Unable to update invoice:",
        error
      );

      alert(
        "The invoice could not be updated."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="new-invoice-page">
      <div className="invoice-back-row">
        <Link
          to={`/sales/invoices/${invoice.id}`}
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to invoice
        </Link>
      </div>

      <PageHeader
        eyebrow="Sales"
        title={`Edit ${invoice.invoiceNumber}`}
        description="Update the invoice details and line items."
      />

      <div className="invoice-form-layout">
        <section className="invoice-form-main">
          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Invoice details</h2>
                <p>
                  Update the customer, dates and
                  invoice settings.
                </p>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div className="invoice-form-field invoice-form-field-full">
                <label htmlFor="customerId">
                  Customer
                </label>

                <select
                  id="customerId"
                  name="customerId"
                  value={
                    invoiceDetails.customerId
                  }
                  onChange={
                    handleCustomerChange
                  }
                >
                  <option value="">
                    {invoiceDetails.customerName ||
                      "Select customer"}
                  </option>

                  {customers.map((customer) => (
                    <option
                      key={customer.id}
                      value={customer.id}
                    >
                      {customer.name}
                    </option>
                  ))}
                </select>

                {errors.customerId && (
                  <small className="form-error-message">
                    {errors.customerId}
                  </small>
                )}

                {(selectedCustomer ||
                  invoiceDetails.customerName) && (
                  <div className="invoice-customer-preview">
                    <strong>
                      {selectedCustomer?.email ||
                        invoiceDetails.customerEmail}
                    </strong>

                    <p>
                      {(
                        selectedCustomer?.address ||
                        invoiceDetails.customerAddress
                      ).join(", ")}
                    </p>
                  </div>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="invoiceNumber">
                  Invoice number
                </label>

                <input
                  id="invoiceNumber"
                  name="invoiceNumber"
                  value={
                    invoiceDetails.invoiceNumber
                  }
                  onChange={
                    handleInvoiceChange
                  }
                />

                {errors.invoiceNumber && (
                  <small className="form-error-message">
                    {errors.invoiceNumber}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="reference">
                  Reference
                </label>

                <input
                  id="reference"
                  name="reference"
                  value={
                    invoiceDetails.reference
                  }
                  onChange={
                    handleInvoiceChange
                  }
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="invoiceDate">
                  Invoice date
                </label>

                <input
                  id="invoiceDate"
                  name="invoiceDate"
                  type="date"
                  value={
                    invoiceDetails.invoiceDate
                  }
                  onChange={
                    handleInvoiceChange
                  }
                />

                {errors.invoiceDate && (
                  <small className="form-error-message">
                    {errors.invoiceDate}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="dueDate">
                  Due date
                </label>

                <input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  value={
                    invoiceDetails.dueDate
                  }
                  onChange={
                    handleInvoiceChange
                  }
                />

                {errors.dueDate && (
                  <small className="form-error-message">
                    {errors.dueDate}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="currency">
                  Currency
                </label>

                <select
                  id="currency"
                  name="currency"
                  value={
                    invoiceDetails.currency
                  }
                  onChange={
                    handleInvoiceChange
                  }
                >
                  <option value="GBP">
                    GBP – British Pound
                  </option>
                  <option value="USD">
                    USD – US Dollar
                  </option>
                  <option value="EUR">
                    EUR – Euro
                  </option>
                  <option value="GHS">
                    GHS – Ghana Cedi
                  </option>
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="pricingMode">
                  Prices are
                </label>

                <select
                  id="pricingMode"
                  name="pricingMode"
                  value={
                    invoiceDetails.pricingMode
                  }
                  onChange={
                    handleInvoiceChange
                  }
                >
                  <option value="exclusive">
                    VAT exclusive
                  </option>
                  <option value="inclusive">
                    VAT inclusive
                  </option>
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="status">
                  Status
                </label>

                <select
                  id="status"
                  name="status"
                  value={
                    invoiceDetails.status
                  }
                  onChange={
                    handleInvoiceChange
                  }
                  disabled={
                    Number(invoice.amountPaid) > 0
                  }
                >
                  <option value="Draft">
                    Draft
                  </option>
                  <option value="Awaiting payment">
                    Awaiting payment
                  </option>
                  <option value="Overdue">
                    Overdue
                  </option>
                </select>

                {Number(invoice.amountPaid) > 0 && (
                  <small className="invoice-field-help">
                    Status cannot be changed after
                    a payment has been recorded.
                  </small>
                )}
              </div>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Invoice items</h2>
                <p>
                  Edit products, quantities,
                  discounts and VAT.
                </p>
              </div>
            </div>

            {errors.items && (
              <div className="invoice-form-alert">
                {errors.items}
              </div>
            )}

            <div className="invoice-items-wrapper">
              <div className="invoice-items-header invoice-items-header-discount">
                <span>Product</span>
                <span>Description</span>
                <span>Quantity</span>
                <span>Unit price</span>
                <span>Discount</span>
                <span>VAT</span>
                <span>Total</span>
                <span />
              </div>

              {items.map((item) => {
                const grossAmount =
                  Number(item.quantity) *
                  Number(item.unitPrice);

                const discountedAmount =
                  grossAmount *
                  (1 -
                    Number(
                      item.discountRate
                    ) /
                      100);

                const vatAmount =
                  invoiceDetails.pricingMode ===
                  "inclusive"
                    ? discountedAmount -
                      discountedAmount /
                        (1 +
                          Number(
                            item.vatRate
                          ) /
                            100)
                    : discountedAmount *
                      (Number(
                        item.vatRate
                      ) /
                        100);

                const lineTotal =
                  invoiceDetails.pricingMode ===
                  "inclusive"
                    ? discountedAmount
                    : discountedAmount +
                      vatAmount;

                return (
                  <div
                    className="invoice-item-row invoice-item-row-discount"
                    key={item.id}
                  >
                    <select
                      value={item.productId}
                      onChange={(event) =>
                        handleProductChange(
                          item.id,
                          event.target.value
                        )
                      }
                    >
                      <option value="">
                        Select product
                      </option>

                      {products.map(
                        (product) => (
                          <option
                            key={product.id}
                            value={product.id}
                          >
                            {product.name}
                          </option>
                        )
                      )}
                    </select>

                    <input
                      value={item.description}
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "description",
                          event.target.value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "quantity",
                          event.target.value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "unitPrice",
                          event.target.value
                        )
                      }
                    />

                    <div className="invoice-percentage-input">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={
                          item.discountRate
                        }
                        onChange={(event) =>
                          handleItemChange(
                            item.id,
                            "discountRate",
                            event.target.value
                          )
                        }
                      />

                      <span>%</span>
                    </div>

                    <select
                      value={item.vatRate}
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "vatRate",
                          event.target.value
                        )
                      }
                    >
                      <option value={0}>
                        0%
                      </option>
                      <option value={5}>
                        5%
                      </option>
                      <option value={20}>
                        20%
                      </option>
                    </select>

                    <strong>
                      {formatCurrency(
                        lineTotal,
                        invoiceDetails.currency
                      )}
                    </strong>

                    <button
                      type="button"
                      className="invoice-remove-item"
                      disabled={
                        items.length === 1
                      }
                      onClick={() =>
                        removeItem(item.id)
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="invoice-add-item-button"
              onClick={addItem}
            >
              <Plus size={17} />
              Add line item
            </button>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Notes</h2>
                <p>
                  Update payment instructions or
                  customer notes.
                </p>
              </div>
            </div>

            <div className="invoice-form-field">
              <label htmlFor="notes">
                Invoice notes
              </label>

              <textarea
                id="notes"
                name="notes"
                rows="5"
                value={invoiceDetails.notes}
                onChange={
                  handleInvoiceChange
                }
              />
            </div>
          </div>
        </section>

        <aside className="invoice-form-sidebar">
          <div className="invoice-total-card">
            <h2>Updated summary</h2>

            <div className="invoice-total-row">
              <span>Subtotal</span>
              <strong>
                {formatCurrency(
                  totals.subtotal,
                  invoiceDetails.currency
                )}
              </strong>
            </div>

            {totals.discount > 0 && (
              <div className="invoice-total-row">
                <span>Discount</span>
                <strong>
                  -
                  {formatCurrency(
                    totals.discount,
                    invoiceDetails.currency
                  )}
                </strong>
              </div>
            )}

            <div className="invoice-total-row">
              <span>VAT</span>
              <strong>
                {formatCurrency(
                  totals.vat,
                  invoiceDetails.currency
                )}
              </strong>
            </div>

            <div className="invoice-total-row invoice-total-grand">
              <span>Total</span>
              <strong>
                {formatCurrency(
                  totals.total,
                  invoiceDetails.currency
                )}
              </strong>
            </div>
          </div>

          <div className="invoice-action-card">
            <button
              type="button"
              className="invoice-approve-button"
              disabled={isSaving}
              onClick={handleSave}
            >
              <Save size={18} />
              {isSaving
                ? "Saving..."
                : "Save changes"}
            </button>

            <Link
              to={`/sales/invoices/${invoice.id}`}
              className="invoice-save-draft-button"
            >
              Cancel
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default EditInvoicePage;
