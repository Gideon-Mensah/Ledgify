import {
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import PageHeader from "../../components/layout/PageHeader";

import {
  getPurchaseOrderById,
  updatePurchaseOrder,
} from "../../services/purchaseOrderService";

import {
  getSuppliers,
} from "../../services/supplierService";

import {
  calculatePurchaseOrderTotals,
} from "../../utils/purchaseOrderCalculations";

// Creates item id.
const createItemId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
};

// Creates empty item.
const createEmptyItem = () => ({
  id: createItemId(),
  description: "",
  quantity: 1,
  unitPrice: "",
  discountRate: 0,
  vatRate: 20,
  quantityReceived: 0,
});

// Normalizes text.
const normaliseText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

// Gets supplier address lines.
const getSupplierAddressLines = (
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

// Finds purchase order supplier.
const findPurchaseOrderSupplier = (
  purchaseOrder,
  suppliers
) => {
  if (!purchaseOrder) {
    return null;
  }

  const supplierById =
    suppliers.find(
      (supplier) =>
        purchaseOrder.supplierId !==
          undefined &&
        purchaseOrder.supplierId !==
          null &&
        purchaseOrder.supplierId !==
          "" &&
        Number(supplier.id) ===
          Number(
            purchaseOrder.supplierId
          )
    );

  if (supplierById) {
    return supplierById;
  }

  const purchaseOrderSupplierName =
    purchaseOrder.supplierName ||
    purchaseOrder.supplier ||
    "";

  return (
    suppliers.find(
      (supplier) =>
        normaliseText(supplier.name) ===
        normaliseText(
          purchaseOrderSupplierName
        )
    ) || null
  );
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

// Renders the edit purchase order page component.
function EditPurchaseOrderPage() {
  const navigate = useNavigate();

  const { purchaseOrderId } =
    useParams();

  // Recalculates this value only when its inputs change.
  const suppliers = useMemo(
    () => getSuppliers(),
    []
  );

  // Recalculates this value only when its inputs change.
  const purchaseOrder = useMemo(
    () =>
      getPurchaseOrderById(
        purchaseOrderId
      ),
    [purchaseOrderId]
  );

  const originalSupplier =
    // Recalculates this value only when its inputs change.
    useMemo(
      () =>
        findPurchaseOrderSupplier(
          purchaseOrder,
          suppliers
        ),
      [purchaseOrder, suppliers]
    );

  const [form, setForm] =
    useState(() => {
      const supplierAddress =
        getSupplierAddressLines(
          purchaseOrder
            ?.supplierAddress ||
            originalSupplier?.address
        );

      return {
        orderNumber:
          purchaseOrder?.orderNumber ||
          "",

        supplierId:
          originalSupplier?.id !==
            undefined &&
          originalSupplier?.id !== null
            ? String(
                originalSupplier.id
              )
            : purchaseOrder
                  ?.supplierId !==
                undefined &&
              purchaseOrder
                ?.supplierId !== null &&
              purchaseOrder
                ?.supplierId !== ""
            ? String(
                purchaseOrder.supplierId
              )
            : "",

        supplierName:
          purchaseOrder
            ?.supplierName ||
          purchaseOrder?.supplier ||
          originalSupplier?.name ||
          "",

        supplierEmail:
          purchaseOrder
            ?.supplierEmail ||
          originalSupplier?.email ||
          "",

        supplierAddress,

        paymentTerms:
          purchaseOrder
            ?.paymentTerms ||
          originalSupplier
            ?.paymentTerms ||
          "30 days",

        supplierReference:
          purchaseOrder
            ?.supplierReference ||
          "",

        orderDate:
          purchaseOrder?.orderDate ||
          "",

        expectedDeliveryDate:
          purchaseOrder
            ?.expectedDeliveryDate ||
          "",

        currency:
          purchaseOrder?.currency ||
          originalSupplier?.currency ||
          "GBP",

        pricingMode:
          purchaseOrder
            ?.pricingMode ||
          "exclusive",

        deliveryAddress:
          purchaseOrder
            ?.deliveryAddress ||
          "",

        notes:
          purchaseOrder?.notes ||
          "",

        items:
          purchaseOrder?.items
            ?.length > 0
            ? purchaseOrder.items.map(
                (item) => ({
                  ...item,

                  id:
                    item.id ||
                    createItemId(),

                  description:
                    String(
                      item.description ||
                        ""
                    ),

                  quantity:
                    Number(
                      item.quantity
                    ) || 0,

                  unitPrice:
                    Number(
                      item.unitPrice
                    ) || 0,

                  discountRate:
                    Number(
                      item.discountRate
                    ) || 0,

                  vatRate:
                    Number(
                      item.vatRate
                    ) || 0,

                  quantityReceived:
                    Number(
                      item.quantityReceived
                    ) || 0,
                })
              )
            : [createEmptyItem()],
      };
    });

  const [errors, setErrors] =
    useState({});

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

  const selectedSupplier =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return (
        suppliers.find(
          (supplier) =>
            Number(supplier.id) ===
            Number(form.supplierId)
        ) || null
      );
    }, [
      suppliers,
      form.supplierId,
    ]);

  const selectedSupplierAddress =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      if (
        Array.isArray(
          form.supplierAddress
        ) &&
        form.supplierAddress.length >
          0
      ) {
        return form.supplierAddress;
      }

      return getSupplierAddressLines(
        selectedSupplier?.address
      );
    }, [
      form.supplierAddress,
      selectedSupplier,
    ]);

  // Recalculates this value only when its inputs change.
  const totals = useMemo(
    () =>
      calculatePurchaseOrderTotals(
        form
      ),
    [form]
  );

  // Handles change.
  const handleChange = (event) => {
    const { name, value } =
      event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      [name]: "",
      form: "",
    }));
  };

  // Handles supplier change.
  const handleSupplierChange = (
    event
  ) => {
    const supplierId =
      event.target.value;

    const supplier =
      suppliers.find(
        (currentSupplier) =>
          Number(
            currentSupplier.id
          ) === Number(supplierId)
      );

    const supplierAddress =
      getSupplierAddressLines(
        supplier?.address
      );

    setForm((currentForm) => ({
      ...currentForm,

      supplierId,

      supplierName:
        supplier?.name || "",

      supplierEmail:
        supplier?.email || "",

      supplierAddress,

      paymentTerms:
        supplier?.paymentTerms ||
        "30 days",

      currency:
        supplier?.currency ||
        currentForm.currency,
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      supplierId: "",
      form: "",
    }));
  };

  // Handles item change.
  const handleItemChange = (
    itemId,
    field,
    value
  ) => {
    setForm((currentForm) => ({
      ...currentForm,

      items:
        currentForm.items.map(
          (item) =>
            item.id === itemId
              ? {
                  ...item,
                  [field]: value,
                }
              : item
        ),
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      items: "",
      form: "",
    }));
  };

  // Adds item.
  const addItem = () => {
    setForm((currentForm) => ({
      ...currentForm,

      items: [
        ...currentForm.items,
        createEmptyItem(),
      ],
    }));
  };

  // Removes item.
  const removeItem = (itemId) => {
    const itemToRemove =
      form.items.find(
        (item) =>
          item.id === itemId
      );

    if (
      Number(
        itemToRemove
          ?.quantityReceived
      ) > 0
    ) {
      window.alert(
        "This line cannot be removed because items have already been received against it."
      );

      return;
    }

    setForm((currentForm) => {
      if (
        currentForm.items.length === 1
      ) {
        return currentForm;
      }

      return {
        ...currentForm,

        items:
          currentForm.items.filter(
            (item) =>
              item.id !== itemId
          ),
      };
    });
  };

  // Validates form.
  const validateForm = () => {
    const nextErrors = {};

    if (
      !String(
        form.orderNumber || ""
      ).trim()
    ) {
      nextErrors.orderNumber =
        "Enter a purchase order number.";
    }

    if (!form.supplierId) {
      nextErrors.supplierId =
        "Select a supplier.";
    } else if (!selectedSupplier) {
      nextErrors.supplierId =
        "Select a valid supplier.";
    }

    if (!form.orderDate) {
      nextErrors.orderDate =
        "Select the order date.";
    }

    if (
      form.expectedDeliveryDate &&
      form.orderDate &&
      form.expectedDeliveryDate <
        form.orderDate
    ) {
      nextErrors.expectedDeliveryDate =
        "The delivery date cannot be before the order date.";
    }

    const validItems =
      form.items.filter(
        (item) =>
          String(
            item.description || ""
          ).trim() &&
          Number(item.quantity) > 0
      );

    if (validItems.length === 0) {
      nextErrors.items =
        "Add at least one valid line item.";
    }

    const hasInvalidItem =
      form.items.some((item) => {
        const description =
          String(
            item.description || ""
          ).trim();

        if (!description) {
          return false;
        }

        const quantity =
          Number(item.quantity);

        const unitPrice =
          Number(item.unitPrice);

        return (
          quantity <= 0 ||
          unitPrice < 0
        );
      });

    if (hasInvalidItem) {
      nextErrors.items =
        "Check the quantity and unit price for each line item.";
    }

    const quantityBelowReceived =
      form.items.some((item) => {
        const quantity =
          Number(item.quantity) || 0;

        const quantityReceived =
          Number(
            item.quantityReceived
          ) || 0;

        return (
          quantity <
          quantityReceived
        );
      });

    if (quantityBelowReceived) {
      nextErrors.items =
        "The ordered quantity cannot be less than the quantity already received.";
    }

    setErrors(nextErrors);

    return (
      Object.keys(nextErrors)
        .length === 0
    );
  };

  // Saves purchase order changes.
  const savePurchaseOrderChanges = (
    status
  ) => {
    if (!validateForm()) {
      return;
    }

    setIsSaving(true);

    try {
      const cleanItems =
        form.items
          .filter((item) =>
            String(
              item.description || ""
            ).trim()
          )
          .map((item) => {
            const quantity =
              Number(item.quantity) || 0;

            const unitPrice =
              Number(
                item.unitPrice
              ) || 0;

            const discountRate =
              Number(
                item.discountRate
              ) || 0;

            const vatRate =
              Number(
                item.vatRate
              ) || 0;

            const quantityReceived =
              Number(
                item.quantityReceived
              ) || 0;

            const lineTotals =
              calculatePurchaseOrderTotals(
                {
                  pricingMode:
                    form.pricingMode,

                  items: [
                    {
                      ...item,
                      quantity,
                      unitPrice,
                      discountRate,
                      vatRate,
                    },
                  ],
                }
              );

            return {
              ...item,

              description:
                String(
                  item.description
                ).trim(),

              quantity,
              unitPrice,
              discountRate,
              vatRate,
              quantityReceived,

              netAmount:
                lineTotals.subtotal,

              vatAmount:
                lineTotals.vat,

              total:
                lineTotals.total,
            };
          });

      const supplierAddress =
        getSupplierAddressLines(
          selectedSupplier.address
        );

      const updatedPurchaseOrder =
        updatePurchaseOrder(
          purchaseOrder.id,
          {
            ...form,

            status,

            supplierId:
              Number(
                selectedSupplier.id
              ),

            supplierName:
              selectedSupplier.name,

            supplierEmail:
              selectedSupplier.email ||
              "",

            supplierAddress,

            paymentTerms:
              selectedSupplier
                .paymentTerms ||
              form.paymentTerms ||
              "30 days",

            currency:
              form.currency ||
              selectedSupplier.currency ||
              "GBP",

            items: cleanItems,

            subtotal:
              totals.subtotal,

            discount:
              totals.discount,

            taxTotal:
              totals.vat,

            vatTotal:
              totals.vat,

            total:
              totals.total,
          }
        );

      navigate(
        `/purchases/orders/${updatedPurchaseOrder.id}`
      );
    } catch (error) {
      setErrors({
        form:
          error.message ||
          "The purchase order could not be updated.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handles submit.
  const handleSubmit = (event) => {
    event.preventDefault();

    savePurchaseOrderChanges(
      purchaseOrder?.status ||
        "Draft"
    );
  };

  if (!purchaseOrder) {
    return (
      <div className="new-invoice-page">
        <div className="invoice-back-row">
          <Link
            to="/purchases/orders"
            className="invoice-back-link"
          >
            <ArrowLeft size={17} />
            Back to purchase orders
          </Link>
        </div>

        <div className="invoice-form-card">
          <h2>
            Purchase order not found
          </h2>

          <p>
            The purchase order you are
            trying to edit does not
            exist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="new-invoice-page">
      <div className="invoice-back-row">
        <Link
          to={`/purchases/orders/${purchaseOrder.id}`}
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to purchase order
        </Link>
      </div>

      <PageHeader
        eyebrow="Purchases"
        title="Edit purchase order"
        description={`Update ${purchaseOrder.orderNumber}.`}
      />

      <form
        className="invoice-form-layout"
        onSubmit={handleSubmit}
      >
        <section className="invoice-form-main">
          {errors.form && (
            <div className="invoice-form-alert">
              {errors.form}
            </div>
          )}

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Purchase order details
                </h2>

                <p>
                  Update the supplier,
                  order reference and
                  dates.
                </p>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div className="invoice-form-field">
                <label htmlFor="supplierId">
                  Supplier
                </label>

                <select
                  id="supplierId"
                  name="supplierId"
                  value={
                    form.supplierId
                  }
                  onChange={
                    handleSupplierChange
                  }
                >
                  <option value="">
                    Select a supplier
                  </option>

                  {suppliers.map(
                    (supplier) => (
                      <option
                        key={
                          supplier.id
                        }
                        value={
                          supplier.id
                        }
                      >
                        {supplier.name}
                        {supplier.status ===
                        "Inactive"
                          ? " — Inactive"
                          : ""}
                      </option>
                    )
                  )}
                </select>

                {errors.supplierId && (
                  <small className="form-error-message">
                    {
                      errors.supplierId
                    }
                  </small>
                )}

                {selectedSupplier && (
                  <div className="invoice-customer-preview">
                    <strong>
                      {form.supplierEmail ||
                        "No email address"}
                    </strong>

                    <p>
                      {selectedSupplierAddress
                        .length > 0
                        ? selectedSupplierAddress.join(
                            ", "
                          )
                        : "No address provided"}
                    </p>

                    <small>
                      Payment terms:{" "}
                      {form.paymentTerms ||
                        "30 days"}
                    </small>
                  </div>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="orderNumber">
                  Purchase order number
                </label>

                <input
                  id="orderNumber"
                  name="orderNumber"
                  value={
                    form.orderNumber
                  }
                  onChange={handleChange}
                />

                {errors.orderNumber && (
                  <small className="form-error-message">
                    {
                      errors.orderNumber
                    }
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="supplierReference">
                  Supplier reference
                </label>

                <input
                  id="supplierReference"
                  name="supplierReference"
                  value={
                    form.supplierReference
                  }
                  onChange={handleChange}
                  placeholder="Optional"
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="currency">
                  Currency
                </label>

                <select
                  id="currency"
                  name="currency"
                  value={form.currency}
                  onChange={handleChange}
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
                <label htmlFor="orderDate">
                  Order date
                </label>

                <input
                  id="orderDate"
                  name="orderDate"
                  type="date"
                  value={form.orderDate}
                  onChange={handleChange}
                />

                {errors.orderDate && (
                  <small className="form-error-message">
                    {errors.orderDate}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="expectedDeliveryDate">
                  Expected delivery
                </label>

                <input
                  id="expectedDeliveryDate"
                  name="expectedDeliveryDate"
                  type="date"
                  value={
                    form.expectedDeliveryDate
                  }
                  onChange={handleChange}
                />

                {errors.expectedDeliveryDate && (
                  <small className="form-error-message">
                    {
                      errors.expectedDeliveryDate
                    }
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="pricingMode">
                  Tax pricing
                </label>

                <select
                  id="pricingMode"
                  name="pricingMode"
                  value={
                    form.pricingMode
                  }
                  onChange={handleChange}
                >
                  <option value="exclusive">
                    Tax exclusive
                  </option>

                  <option value="inclusive">
                    Tax inclusive
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Line items</h2>

                <p>
                  Update the products or
                  services included in
                  this order.
                </p>
              </div>

              <button
                type="button"
                className="invoice-add-line-button"
                onClick={addItem}
              >
                <Plus size={17} />
                Add line
              </button>
            </div>

            {errors.items && (
              <div className="invoice-form-alert">
                {errors.items}
              </div>
            )}

            <div className="invoice-line-items-wrapper">
              <table className="invoice-line-items-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Discount</th>
                    <th>VAT</th>
                    <th>Total</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>

                <tbody>
                  {form.items.map(
                    (item) => {
                      const itemTotals =
                        calculatePurchaseOrderTotals(
                          {
                            pricingMode:
                              form.pricingMode,

                            items: [item],
                          }
                        );

                      return (
                        <tr key={item.id}>
                          <td>
                            <input
                              value={
                                item.description
                              }
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
                              placeholder="Item description"
                            />
                          </td>

                          <td>
                            <input
                              type="number"
                              min={
                                Number(
                                  item.quantityReceived
                                ) || 0
                              }
                              step="0.01"
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
                          </td>

                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
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
                              placeholder="0.00"
                            />
                          </td>

                          <td>
                            <select
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
                            >
                              <option value="0">
                                0%
                              </option>

                              <option value="5">
                                5%
                              </option>

                              <option value="10">
                                10%
                              </option>

                              <option value="15">
                                15%
                              </option>

                              <option value="20">
                                20%
                              </option>
                            </select>
                          </td>

                          <td>
                            <select
                              value={item.vatRate}
                              onChange={(
                                event
                              ) =>
                                handleItemChange(
                                  item.id,
                                  "vatRate",
                                  event.target
                                    .value
                                )
                              }
                            >
                              <option value="20">
                                20%
                              </option>

                              <option value="5">
                                5%
                              </option>

                              <option value="0">
                                0%
                              </option>
                            </select>
                          </td>

                          <td>
                            <strong>
                              {formatCurrency(
                                itemTotals.total,
                                form.currency
                              )}
                            </strong>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="invoice-line-delete-button"
                              onClick={() =>
                                removeItem(
                                  item.id
                                )
                              }
                              disabled={
                                form.items
                                  .length ===
                                  1 ||
                                Number(
                                  item.quantityReceived
                                ) > 0
                              }
                              aria-label="Remove line item"
                              title={
                                Number(
                                  item.quantityReceived
                                ) > 0
                                  ? "Received lines cannot be removed"
                                  : "Remove line item"
                              }
                            >
                              <Trash2 size={17} />
                            </button>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Delivery information
                </h2>

                <p>
                  Update delivery
                  instructions and
                  supplier notes.
                </p>
              </div>
            </div>

            <div className="invoice-form-field">
              <label htmlFor="deliveryAddress">
                Delivery address
              </label>

              <textarea
                id="deliveryAddress"
                name="deliveryAddress"
                rows="4"
                value={
                  form.deliveryAddress
                }
                onChange={handleChange}
                placeholder="Enter the delivery address"
              />
            </div>

            <div className="invoice-form-field">
              <label htmlFor="notes">
                Notes
              </label>

              <textarea
                id="notes"
                name="notes"
                rows="4"
                value={form.notes}
                onChange={handleChange}
                placeholder="Add instructions or notes for the supplier"
              />
            </div>
          </div>
        </section>

        <aside className="invoice-form-sidebar">
          <div className="invoice-total-card">
            <h2>Order summary</h2>

            <div className="invoice-total-row">
              <span>Subtotal</span>

              <strong>
                {formatCurrency(
                  totals.subtotal,
                  form.currency
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
                    form.currency
                  )}
                </strong>
              </div>
            )}

            <div className="invoice-total-row">
              <span>VAT</span>

              <strong>
                {formatCurrency(
                  totals.vat,
                  form.currency
                )}
              </strong>
            </div>

            <div className="invoice-total-row invoice-total-row-final">
              <span>Total</span>

              <strong>
                {formatCurrency(
                  totals.total,
                  form.currency
                )}
              </strong>
            </div>
          </div>

          <div className="invoice-action-card">
            <button
              type="button"
              className="invoice-approve-button"
              disabled={isSaving}
              onClick={() =>
                savePurchaseOrderChanges(
                  "Approved"
                )
              }
            >
              <Send size={18} />

              {isSaving
                ? "Saving..."
                : "Save and approve"}
            </button>

            <button
              type="submit"
              className="invoice-save-draft-button"
              disabled={isSaving}
            >
              <Save size={18} />

              {isSaving
                ? "Saving..."
                : "Save changes"}
            </button>

            <Link
              to={`/purchases/orders/${purchaseOrder.id}`}
              className="invoice-cancel-link"
            >
              Cancel
            </Link>
          </div>
        </aside>
      </form>
    </div>
  );
}

export default EditPurchaseOrderPage;