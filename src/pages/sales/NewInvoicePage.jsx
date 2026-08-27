// Collect invoice lines and send writable customer, tax, and account IDs to the API.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  Plus,
  Save,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import PageHeader from "../../components/layout/PageHeader";

import { salesApiService } from "../../services/salesApiService";
import { contactApiService } from "../../services/contactApiService";
import { accountLookupService } from "../../services/accountLookupService";
import { normaliseApiError } from "../../services/apiError";
import { taxApiService } from "../../services/taxApiService";

import { inventoryService } from "../../services/inventoryService";
import { useAuth } from "../../store/AuthContext";
import {
  addCalendarDays,
  formatDisplayDate,
  getOrganisationToday,
} from "../../utils/dateUtils";

// Creates row id.
const createRowId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

// Creates empty item.
const createEmptyItem = () => ({
  id: createRowId(),

  productId: "",
  productName: "",
  sku: "",
  itemType: "",

  description: "",
  quantity: 1,
  unitPrice: 0,
  discountRate: 0,
  vatRate: 0,
  taxRateId: "",

  salesAccount: "Sales",
  revenueAccountId: "",

  trackInventory: false,
  availableStock: 0,
  inventoryUnitCost: 0,
});

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

  if (!address) {
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
    .map((value) =>
      String(value || "").trim()
    )
    .filter(Boolean);
};

// Performs the round quantity task.
const roundQuantity = (
  quantity
) => {
  return (
    Math.round(
      ((Number(quantity) || 0) +
        Number.EPSILON) *
        1000
    ) / 1000
  );
};

// Renders the new invoice page component.
function NewInvoicePage({ editMode = false }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { invoiceId } = useParams();

  const [searchParams] =
    useSearchParams();

  const [customers, setCustomers] = useState([]);
  const [revenueAccounts, setRevenueAccounts] = useState([]);

  const [
    catalogueItems,
    setCatalogueItems,
  ] = useState([]);

  const requestedCustomerId =
    searchParams.get("customerId");

  const today = getOrganisationToday(auth.selectedOrganisation?.timezone);

  const [
    invoiceDetails,
    setInvoiceDetails,
  ] = useState({
    customerId: "",
    invoiceNumber: "",
    invoiceDate: today,
    dueDate: addCalendarDays(
      today,
      14
    ),
    reference: "",
    currency: "GBP",
    pricingMode: "exclusive",
    notes:
      "Please use the invoice number as your payment reference.",
  });

  const [items, setItems] =
    useState([
      createEmptyItem(),
    ]);
  const [taxRates, setTaxRates] = useState([]);

  const [errors, setErrors] =
    useState({});

  const [isSaving, setIsSaving] =
    useState(false);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(editMode);
  const [isEditableInvoice, setIsEditableInvoice] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([contactApiService.customers(), accountLookupService.revenue(), taxApiService.rates()])
      .then(([nextCustomers, accounts, configuredRates]) => {
        if (cancelled) return;
        setCustomers(nextCustomers);
        setRevenueAccounts(accounts);
        setTaxRates((Array.isArray(configuredRates) ? configuredRates : configuredRates.results || [])
          .filter((rate) => rate.status === "ACTIVE" && ["SALES", "BOTH"].includes(rate.scope)));
        setItems((current) => current.map((item) => ({
          ...item,
          revenueAccountId: item.revenueAccountId || accounts[0]?.id || "",
        })));
      })
      .catch((error) => {
        if (!cancelled) setErrors({ form: normaliseApiError(error) });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!editMode || !invoiceId) return undefined;
    let cancelled = false;
    salesApiService.get(invoiceId).then((existing) => {
      if (cancelled) return;
      if (existing.backendStatus !== "draft") {
        setIsEditableInvoice(false);
        setErrors({ form: "This invoice has been approved and can no longer be edited. Use a credit note or another correction workflow." });
      }
      setInvoiceDetails({ customerId: String(existing.customerId || ""), invoiceNumber: existing.invoiceNumber, invoiceDate: existing.issueDateIso, dueDate: existing.dueDateIso, reference: existing.reference || "", currency: existing.currency, pricingMode: "exclusive", notes: existing.notes || "" });
      setItems(existing.items.map((line) => ({ ...createEmptyItem(), id: line.id || createRowId(), description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountRate: line.discountRate || 0, vatRate: line.vatRate || 0, taxRateId: line.taxRateId || "", revenueAccountId: line.revenueAccountId || "" })));
      setIsLoadingInvoice(false);
    }).catch((error) => { if (!cancelled) { setErrors({ form: normaliseApiError(error) }); setIsLoadingInvoice(false); } });
    return () => { cancelled = true; };
  }, [editMode, invoiceId]);

  const loadCatalogue =
    useCallback(async () => {
      const products = await inventoryService.products({ status: "active" });
      setCatalogueItems(Array.isArray(products) ? products : products.results || []);
    }, []);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(loadCatalogue);
    return () => window.cancelAnimationFrame(initialLoad);
  }, [loadCatalogue]);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    window.addEventListener(
      "focus",
      loadCatalogue
    );

    return () => {
      window.removeEventListener(
        "focus",
        loadCatalogue
      );
    };
  }, [loadCatalogue]);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => {
    const requestedCustomer =
      customers.find(
        (customer) =>
          String(customer.id) ===
          String(
            requestedCustomerId
          )
      );

    setInvoiceDetails(
      (currentDetails) => ({
        ...currentDetails,

        invoiceNumber:
          currentDetails.invoiceNumber || `INV-${Date.now()}`,

        customerId:
          requestedCustomer
            ? String(
                requestedCustomer.id
              )
            : currentDetails.customerId,

        currency:
          requestedCustomer?.currency ||
          currentDetails.currency,
      })
    );
    });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [
    customers,
    requestedCustomerId,
  ]);

  const selectedCustomer =
    customers.find(
      (customer) =>
        String(customer.id) ===
        String(
          invoiceDetails.customerId
        )
    );

  const selectedCustomerAddress =
    getCustomerAddressLines(
      selectedCustomer?.address
    );

  // Recalculates this value only when its inputs change.
  const productMap = useMemo(
    () =>
      catalogueItems.reduce(
        (map, product) => {
          map[
            String(product.id)
          ] = product;

          return map;
        },
        {}
      ),
    [catalogueItems]
  );

  const requestedStockByProduct =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return items.reduce(
        (totals, item) => {
          if (
            !item.productId ||
            !item.trackInventory
          ) {
            return totals;
          }

          const productKey =
            String(
              item.productId
            );

          totals[productKey] =
            roundQuantity(
              (totals[productKey] ||
                0) +
                (Number(
                  item.quantity
                ) || 0)
            );

          return totals;
        },
        {}
      );
    }, [items]);

  // Handles invoice change.
  const handleInvoiceChange = (
    event
  ) => {
    const { name, value } =
      event.target;

    setInvoiceDetails(
      (currentDetails) => {
        if (
          name === "customerId"
        ) {
          const nextCustomer =
            customers.find(
              (customer) =>
                String(
                  customer.id
                ) === String(value)
            );

          return {
            ...currentDetails,
            customerId: value,

            currency:
              nextCustomer?.currency ||
              currentDetails.currency,
          };
        }

        return {
          ...currentDetails,
          [name]: value,
        };
      }
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        [name]: "",
        form: "",
      })
    );
  };

  // Handles product change.
  const handleProductChange = (
    itemId,
    productId
  ) => {
    const product =
      catalogueItems.find(
        (currentProduct) =>
          String(
            currentProduct.id
          ) === String(productId)
      );

    setItems(
      (currentItems) =>
        currentItems.map(
          (item) => {
            if (
              item.id !== itemId
            ) {
              return item;
            }

            if (!product) {
              return {
                ...createEmptyItem(),
                id: item.id,
              };
            }

            return {
              ...item,

              productId:
                String(product.id),

              productName:
                product.name || "",

              sku:
                product.sku || "",

              itemType:
                product.type || "",

              description:
                product.description ||
                product.name ||
                "",

              unitPrice:
                Number(
                  product.salesPrice
                ) || 0,

              vatRate:
                Number(
                  product.taxRate
                ) || 0,
              taxRateId: product.defaultSalesTaxRateId || "",

              salesAccount:
                product.salesAccount ||
                "Sales",

              trackInventory:
                Boolean(
                  product.trackInventory
                ),

              availableStock:
                Number(
                  product.quantityOnHand
                ) || 0,

              inventoryUnitCost:
                Number(
                  product.purchaseCost
                ) || 0,
            };
          }
        )
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        items: "",
        form: "",
      })
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

    setItems(
      (currentItems) =>
        currentItems.map(
          (item) =>
            item.id === itemId
              ? {
                  ...item,

                  [field]:
                    numericFields.includes(
                      field
                    )
                      ? value === ""
                        ? ""
                        : Number(value)
                      : value,
                }
              : item
        )
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        items: "",
        form: "",
      })
    );
  };

  // Adds item.
  const addItem = () => {
    setItems(
      (currentItems) => [
        ...currentItems,
        createEmptyItem(),
      ]
    );
  };

  // Removes item.
  const removeItem = (
    itemId
  ) => {
    if (items.length === 1) {
      return;
    }

    setItems(
      (currentItems) =>
        currentItems.filter(
          (item) =>
            item.id !== itemId
        )
    );
  };

  // Recalculates this value only when its inputs change.
  const totals = useMemo(() => {
    return items.reduce(
      (summary, item) => {
        const quantity =
          Number(item.quantity) || 0;

        const unitPrice =
          Number(item.unitPrice) ||
          0;

        const discountRate =
          Number(
            item.discountRate
          ) || 0;

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

        let netAmount =
          discountedAmount;

        let vatAmount =
          discountedAmount *
          (vatRate / 100);

        if (
          invoiceDetails.pricingMode ===
          "inclusive"
        ) {
          const vatDivisor =
            1 + vatRate / 100;

          netAmount =
            vatDivisor > 0
              ? discountedAmount /
                vatDivisor
              : discountedAmount;

          vatAmount =
            discountedAmount -
            netAmount;
        }

        summary.subtotal +=
          netAmount;

        summary.discount +=
          discountAmount;

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
  }, [
    items,
    invoiceDetails.pricingMode,
  ]);

  // Validates invoice.
  const validateInvoice = (
    status
  ) => {
    const nextErrors = {};

    if (
      !invoiceDetails.customerId
    ) {
      nextErrors.customerId =
        "Select a customer.";
    } else if (
      !selectedCustomer
    ) {
      nextErrors.customerId =
        "Select a valid customer.";
    }

    if (
      !invoiceDetails.invoiceNumber.trim()
    ) {
      nextErrors.invoiceNumber =
        "Enter an invoice number.";
    }

    if (
      !invoiceDetails.invoiceDate
    ) {
      nextErrors.invoiceDate =
        "Select an invoice date.";
    }

    if (
      !invoiceDetails.dueDate
    ) {
      nextErrors.dueDate =
        "Select a due date.";
    }

    if (
      invoiceDetails.dueDate &&
      invoiceDetails.invoiceDate &&
      invoiceDetails.dueDate <
        invoiceDetails.invoiceDate
    ) {
      nextErrors.dueDate =
        "The due date cannot be before the invoice date.";
    }

    const validItems =
      items.filter(
        (item) =>
          String(
            item.description || ""
          ).trim() &&
          Number(item.quantity) >
            0
      );

    if (
      validItems.length === 0
    ) {
      nextErrors.items =
        "Add at least one valid invoice item.";
    }

    const invalidPriceItem =
      validItems.find(
        (item) =>
          !Number.isFinite(
            Number(
              item.unitPrice
            )
          ) ||
          Number(item.unitPrice) <
            0
      );

    if (invalidPriceItem) {
      nextErrors.items =
        "Unit prices must be zero or greater.";
    }

    const invalidDiscountItem =
      validItems.find(
        (item) =>
          Number(
            item.discountRate
          ) < 0 ||
          Number(
            item.discountRate
          ) > 100
      );

    if (
      invalidDiscountItem
    ) {
      nextErrors.items =
        "Discount percentages must be between 0% and 100%.";
    }

    /*
     * Draft invoices do not reserve
     * or reduce stock.
     *
     * Stock availability is checked
     * when the invoice is approved.
     */
    if (
      status !== "Draft"
    ) {
      const stockErrors = [];

      Object.entries(
        requestedStockByProduct
      ).forEach(
        ([
          productId,
          requestedQuantity,
        ]) => {
          const liveProduct =
            catalogueItems.find((product) => product.id === productId);

          if (!liveProduct) {
            stockErrors.push(
              "One selected inventory product could not be found."
            );

            return;
          }

          if (
            liveProduct.status !==
            "Active"
          ) {
            stockErrors.push(
              `${liveProduct.name} is archived and cannot be added to an approved invoice.`
            );

            return;
          }

          if (
            !liveProduct.trackInventory
          ) {
            return;
          }

          const availableQuantity =
            Number(
              liveProduct.quantityOnHand
            ) || 0;

          if (
            requestedQuantity >
            availableQuantity +
              0.0005
          ) {
            stockErrors.push(
              `${liveProduct.name} requires ${requestedQuantity}, but only ${availableQuantity} is available.`
            );
          }
        }
      );

      if (
        stockErrors.length > 0
      ) {
        nextErrors.items =
          stockErrors.join(" ");
      }
    }

    setErrors(nextErrors);

    return (
      Object.keys(nextErrors)
        .length === 0
    );
  };

  // Handles save.
  const handleSave = async (
    status
  ) => {
    if (editMode && !isEditableInvoice) return;
    if (
      !validateInvoice(status)
    ) {
      return;
    }

    setIsSaving(true);

    try {
      const validItems =
        items.filter(
          (item) =>
            String(
              item.description ||
                ""
            ).trim() &&
            Number(item.quantity) >
              0
        );

      const invoice =
        await (editMode ? salesApiService.update(invoiceId,
          {
            invoiceNumber: invoiceDetails.invoiceNumber.trim(), customerId: selectedCustomer.id,
            issueDate: invoiceDetails.invoiceDate, dueDate: invoiceDetails.dueDate, reference: invoiceDetails.reference.trim(),
            currency: invoiceDetails.currency, pricingMode: invoiceDetails.pricingMode, notes: invoiceDetails.notes.trim(),
            items: validItems.map((item) => ({ ...item, discountAmount: (Number(item.quantity) * Number(item.unitPrice)) * (Number(item.discountRate || 0) / 100) })),
          }) : salesApiService.create(
          {
            invoiceNumber:
              invoiceDetails.invoiceNumber.trim(),

            customerId:
              selectedCustomer.id,

            customer:
              selectedCustomer.name,

            customerEmail:
              selectedCustomer.email,

            customerAddress:
              selectedCustomerAddress,

            issueDate:
              formatDisplayDate(
                invoiceDetails.invoiceDate
              ),

            dueDate:
              formatDisplayDate(
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

            items:
              validItems.map(
                (item) => {
                  const selectedProduct =
                    item.productId
                      ? catalogueItems.find((product) => product.id === item.productId)
                      : null;

                  return {
                    id:
                      createRowId(),

                    productId:
                      selectedProduct?.id ||
                      null,

                    productName:
                      selectedProduct?.name ||
                      item.productName ||
                      "",

                    sku:
                      selectedProduct?.sku ||
                      item.sku ||
                      "",

                    itemType:
                      selectedProduct?.type ||
                      item.itemType ||
                      "",

                    description:
                      String(
                        item.description ||
                          ""
                      ).trim(),

                    quantity:
                      Number(
                        item.quantity
                      ),

                    unitPrice:
                      Number(
                        item.unitPrice
                      ),

                    discountRate:
                      Number(
                        item.discountRate
                      ) || 0,

                    vatRate:
                      Number(
                        item.vatRate
                      ) || 0,
                    taxRateId: item.taxRateId || null,

                    salesAccount:
                      selectedProduct?.salesAccount ||
                      item.salesAccount ||
                      "Sales",

                    revenueAccountId:
                      item.revenueAccountId || revenueAccounts[0]?.id,

                    trackInventory:
                      Boolean(
                        selectedProduct?.trackInventory
                      ),

                    inventoryUnitCost:
                      Number(
                        selectedProduct?.purchaseCost
                      ) || 0,

                    availableStockAtCreation:
                      Number(
                        selectedProduct?.quantityOnHand
                      ) || 0,
                  };
                }
              ),
            approve: status !== "Draft",
          }
        ));

      navigate(
        `/sales/invoices/${invoice.id}`
      );
    } catch (error) {
      console.error(
        "Unable to create invoice:",
        error
      );

      setErrors({
        form:
          normaliseApiError(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingInvoice) return <div className="new-invoice-page"><section className="invoice-form-card">Loading invoice…</section></div>;
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

      <PageHeader
        eyebrow="Sales"
        title="New invoice"
        description="Create and send a customer invoice."
      />

      {errors.form && (
        <div className="invoice-form-alert">
          {errors.form}
        </div>
      )}

      <div className="invoice-form-layout">
        <section className="invoice-form-main">
          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Invoice details
                </h2>

                <p>
                  Select the customer and
                  payment terms.
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
                    handleInvoiceChange
                  }
                >
                  <option value="">
                    Select customer
                  </option>

                  {customers.map(
                    (customer) => (
                      <option
                        key={customer.id}
                        value={customer.id}
                      >
                        {customer.name}

                        {customer.status ===
                        "Inactive"
                          ? " — Inactive"
                          : ""}
                      </option>
                    )
                  )}
                </select>

                {errors.customerId && (
                  <small className="form-error-message">
                    {
                      errors.customerId
                    }
                  </small>
                )}

                {selectedCustomer && (
                  <div className="invoice-customer-preview">
                    <strong>
                      {selectedCustomer.email ||
                        "No email address"}
                    </strong>

                    <p>
                      {selectedCustomerAddress.length >
                      0
                        ? selectedCustomerAddress.join(
                            ", "
                          )
                        : "No address provided"}
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
                    {
                      errors.invoiceNumber
                    }
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
                  placeholder="Optional reference"
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
                    {
                      errors.invoiceDate
                    }
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
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Invoice items
                </h2>

                <p>
                  Select products and
                  services from the live
                  inventory catalogue.
                </p>
              </div>
            </div>

            {errors.items && (
              <div className="invoice-form-alert">
                <TriangleAlert
                  size={18}
                />

                <span>
                  {errors.items}
                </span>
              </div>
            )}

            <div className="invoice-items-wrapper">
              <div className="invoice-items-header invoice-items-header-discount">
                <span>Product</span>
                <span>Description</span>
                <span>Revenue account</span>
                <span>Quantity</span>
                <span>Unit price</span>
                <span>Discount</span>
                <span>VAT</span>
                <span>Total</span>
                <span />
              </div>

              {items.map((item) => {
                const selectedProduct =
                  item.productId
                    ? productMap[
                        String(
                          item.productId
                        )
                      ]
                    : null;

                const totalRequested =
                  item.productId
                    ? Number(
                        requestedStockByProduct[
                          String(
                            item.productId
                          )
                        ]
                      ) || 0
                    : 0;

                const availableStock =
                  Number(
                    selectedProduct?.quantityOnHand
                  ) || 0;

                const hasStockShortage =
                  Boolean(
                    selectedProduct?.trackInventory
                  ) &&
                  totalRequested >
                    availableStock +
                      0.0005;

                const grossAmount =
                  Number(
                    item.quantity
                  ) *
                  Number(
                    item.unitPrice
                  );

                const discountAmount =
                  grossAmount *
                  (Number(
                    item.discountRate
                  ) /
                    100);

                const discountedAmount =
                  grossAmount -
                  discountAmount;

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
                    <div className="invoice-product-selector-cell">
                      <select
                        value={
                          item.productId
                        }
                        onChange={(
                          event
                        ) =>
                          handleProductChange(
                            item.id,
                            event.target
                              .value
                          )
                        }
                      >
                        <option value="">
                          Manual line item
                        </option>

                        {catalogueItems.map(
                          (product) => (
                            <option
                              key={
                                product.id
                              }
                              value={
                                product.id
                              }
                            >
                              {product.name} ·{" "}
                              {product.sku}
                              {product.type ===
                              "Product"
                                ? product.trackInventory
                                  ? ` · ${product.quantityOnHand} available`
                                  : " · Stock not tracked"
                                : " · Service"}
                            </option>
                          )
                        )}
                      </select>

                      {selectedProduct && (
                        <div className="invoice-product-meta">
                          <span>
                            {
                              selectedProduct.sku
                            }
                          </span>

                          {selectedProduct.type ===
                          "Service" ? (
                            <span className="invoice-product-service-badge">
                              Service
                            </span>
                          ) : selectedProduct.trackInventory ? (
                            <span
                              className={
                                hasStockShortage
                                  ? "invoice-product-stock-badge invoice-product-stock-short"
                                  : "invoice-product-stock-badge"
                              }
                            >
                              {availableStock}{" "}
                              available
                            </span>
                          ) : (
                            <span className="invoice-product-service-badge">
                              Stock not tracked
                            </span>
                          )}
                        </div>
                      )}

                      {hasStockShortage && (
                        <small className="invoice-product-stock-warning">
                          Total requested:{" "}
                          {totalRequested}
                        </small>
                      )}
                    </div>

                    <input
                      value={
                        item.description
                      }
                      placeholder="Description"
                      onChange={(
                        event
                      ) =>
                        handleItemChange(
                          item.id,
                          "description",
                          event.target
                            .value
                        )
                      }
                    />

                    <select
                      aria-label="Revenue account"
                      value={item.revenueAccountId || ""}
                      onChange={(event) => handleItemChange(
                        item.id,
                        "revenueAccountId",
                        event.target.value
                      )}
                    >
                      <option value="">Revenue account</option>
                      {revenueAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      aria-label="Quantity"
                      value={
                        item.quantity
                      }
                      onChange={(
                        event
                      ) =>
                        handleItemChange(
                          item.id,
                          "quantity",
                          event.target
                            .value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label="Unit price"
                      value={
                        item.unitPrice
                      }
                      onChange={(
                        event
                      ) =>
                        handleItemChange(
                          item.id,
                          "unitPrice",
                          event.target
                            .value
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
                        onChange={(
                          event
                        ) =>
                          handleItemChange(
                            item.id,
                            "discountRate",
                            event.target
                              .value
                          )
                        }
                      />

                      <span>%</span>
                    </div>

                    <select value={item.taxRateId || ""} onChange={(event) => {
                      const selected = taxRates.find((rate) => rate.id === event.target.value);
                      handleItemChange(item.id, "taxRateId", event.target.value);
                      handleItemChange(item.id, "vatRate", selected?.rate || 0);
                    }} aria-label="Tax rate">
                      <option value="">No tax</option>
                      {taxRates.filter((rate) => rate.effective_from <= invoiceDetails.invoiceDate
                        && (!rate.effective_to || rate.effective_to >= invoiceDetails.invoiceDate))
                        .map((rate) => <option key={rate.id} value={rate.id}>{rate.code} — {rate.name} ({rate.rate}%)</option>)}
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
                        removeItem(
                          item.id
                        )
                      }
                      aria-label="Remove item"
                    >
                      <Trash2
                        size={17}
                      />
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
                  Add payment
                  instructions.
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
                value={
                  invoiceDetails.notes
                }
                onChange={
                  handleInvoiceChange
                }
              />
            </div>
          </div>
        </section>

        <aside className="invoice-form-sidebar">
          <div className="invoice-total-card">
            <h2>
              Invoice summary
            </h2>

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
              className="invoice-save-draft-button"
              disabled={isSaving || !isEditableInvoice}
              onClick={() =>
                handleSave("Draft")
              }
            >
              <Save size={18} />

              {isSaving
                ? "Saving..."
                : editMode ? "Save changes" : "Save draft"}
            </button>

            {!editMode && <button
              type="button"
              className="invoice-approve-button"
              disabled={isSaving}
              onClick={() =>
                handleSave(
                  "Awaiting payment"
                )
              }
            >
              <Send size={18} />

              {isSaving
                ? "Approving..."
                : "Approve invoice"}
            </button>}

            <p>
              Draft invoices do not affect
              stock. Approved invoices
              require sufficient available
              inventory.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default NewInvoicePage;
