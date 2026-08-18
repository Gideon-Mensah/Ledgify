import {
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Edit3,
  FileText,
  MapPin,
  PackageCheck,
  Send,
  Trash2,
  Truck,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import PageHeader from "../../components/layout/PageHeader";
import ReceivePurchaseOrderModal from "../../components/purchases/ReceivePurchaseOrderModal";

import {
  createBill,
} from "../../services/billService";

import {
  deletePurchaseOrder,
  getPurchaseOrderById,
  updatePurchaseOrder,
} from "../../services/purchaseOrderService";

import {
  getSuppliers,
} from "../../services/supplierService";

import {
  calculatePurchaseOrderTotals,
  getPurchaseOrderReceiptSummary,
} from "../../utils/purchaseOrderCalculations";

// Creates record id.
const createRecordId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
};

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

// Formats date.
const formatDate = (dateValue) => {
  if (!dateValue) {
    return "Not specified";
  }

  const stringValue =
    String(dateValue);

  const parsedDate =
    /^\d{4}-\d{2}-\d{2}$/.test(
      stringValue
    )
      ? new Date(
          `${stringValue}T00:00:00`
        )
      : new Date(stringValue);

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return stringValue;
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(parsedDate);
};

// Formats date input value.
const formatDateInputValue = (
  date
) => {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// Formats date time.
const formatDateTime = (
  dateValue
) => {
  if (!dateValue) {
    return "Not recorded";
  }

  const parsedDate =
    new Date(dateValue);

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return String(dateValue);
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(parsedDate);
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

// Gets supplier name.
const getSupplierName = (
  purchaseOrder
) => {
  return (
    purchaseOrder?.supplierName ||
    purchaseOrder?.supplier ||
    "Supplier"
  );
};

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

  const supplierName =
    purchaseOrder.supplierName ||
    purchaseOrder.supplier ||
    "";

  return (
    suppliers.find(
      (supplier) =>
        normaliseText(
          supplier.name
        ) ===
        normaliseText(
          supplierName
        )
    ) || null
  );
};

// Gets payment term days.
const getPaymentTermDays = (
  paymentTerms
) => {
  const normalisedTerms =
    normaliseText(paymentTerms);

  if (
    normalisedTerms.includes(
      "immediately"
    ) ||
    normalisedTerms.includes(
      "receipt"
    )
  ) {
    return 0;
  }

  const numberMatch =
    normalisedTerms.match(/\d+/);

  if (!numberMatch) {
    return 30;
  }

  return Number(numberMatch[0]) || 0;
};

// Renders the purchase order details page component.
function PurchaseOrderDetailsPage() {
  const { purchaseOrderId } =
    useParams();

  const navigate = useNavigate();

  // Recalculates this value only when its inputs change.
  const suppliers = useMemo(
    () => getSuppliers(),
    []
  );

  const [
    isReceiveModalOpen,
    setIsReceiveModalOpen,
  ] = useState(false);

  const [
    isReceiving,
    setIsReceiving,
  ] = useState(false);

  const [
    isConvertingToBill,
    setIsConvertingToBill,
  ] = useState(false);

  const purchaseOrder =
    getPurchaseOrderById(
      purchaseOrderId
    );

  const selectedSupplier =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return findPurchaseOrderSupplier(
        purchaseOrder,
        suppliers
      );
    }, [
      purchaseOrder,
      suppliers,
    ]);

  const supplierId =
    selectedSupplier?.id ??
    purchaseOrder?.supplierId ??
    null;

  const supplierUrl =
    supplierId !== null &&
    supplierId !== undefined &&
    supplierId !== ""
      ? `/purchases/suppliers/${supplierId}`
      : null;

  const supplierName =
    getSupplierName(
      purchaseOrder
    );

  const supplierEmail =
    purchaseOrder?.supplierEmail ||
    selectedSupplier?.email ||
    "";

  const supplierAddressLines =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      const savedAddress =
        getSupplierAddressLines(
          purchaseOrder
            ?.supplierAddress
        );

      if (savedAddress.length > 0) {
        return savedAddress;
      }

      return getSupplierAddressLines(
        selectedSupplier?.address
      );
    }, [
      purchaseOrder
        ?.supplierAddress,
      selectedSupplier,
    ]);

  if (!purchaseOrder) {
    return (
      <div className="invoice-details-page purchase-order-details-page">
        <div className="invoice-back-row">
          <Link
            to="/purchases/orders"
            className="invoice-back-link"
          >
            <ArrowLeft size={17} />
            Back to purchase orders
          </Link>
        </div>

        <section className="invoice-form-card">
          <h1>
            Purchase order not found
          </h1>

          <p>
            The requested purchase
            order does not exist or may
            have been deleted.
          </p>
        </section>
      </div>
    );
  }

  const items =
    Array.isArray(
      purchaseOrder.items
    )
      ? purchaseOrder.items
      : [];

  const totals =
    calculatePurchaseOrderTotals({
      ...purchaseOrder,
      items,
    });

  const receiptSummary =
    getPurchaseOrderReceiptSummary({
      ...purchaseOrder,
      items,
    });

  const receipts =
    Array.isArray(
      purchaseOrder.receipts
    )
      ? purchaseOrder.receipts
      : [];

  const totalOrdered =
    Number(
      receiptSummary.totalOrdered
    ) || 0;

  const totalReceived =
    Number(
      receiptSummary.totalReceived
    ) || 0;

  const remainingQuantity =
    Number(
      receiptSummary.remaining
    ) || 0;

  const receiptProgress =
    totalOrdered > 0
      ? Math.min(
          Math.round(
            (totalReceived /
              totalOrdered) *
              100
          ),
          100
        )
      : 0;

  // Handles approve.
  const handleApprove = () => {
    try {
      updatePurchaseOrder(
        purchaseOrder.id,
        {
          status: "Approved",

          approvedAt:
            new Date().toISOString(),
        }
      );

      navigate(0);
    } catch (error) {
      window.alert(
        error.message ||
          "The purchase order could not be approved."
      );
    }
  };

  // Handles mark sent.
  const handleMarkSent = () => {
    try {
      updatePurchaseOrder(
        purchaseOrder.id,
        {
          status: "Sent",

          sentAt:
            new Date().toISOString(),
        }
      );

      navigate(0);
    } catch (error) {
      window.alert(
        error.message ||
          "The purchase order could not be marked as sent."
      );
    }
  };

  // Handles receive items.
  const handleReceiveItems = (
    receiptData
  ) => {
    setIsReceiving(true);

    try {
      const receiptLines =
        Array.isArray(
          receiptData.lines
        )
          ? receiptData.lines
          : [];

      const updatedItems =
        items.map((item) => {
          const receiptLine =
            receiptLines.find(
              (line) =>
                String(
                  line.itemId
                ) ===
                String(item.id)
            );

          if (!receiptLine) {
            return item;
          }

          const orderedQuantity =
            Number(
              item.quantity
            ) || 0;

          const previouslyReceived =
            Number(
              item.quantityReceived
            ) || 0;

          const quantityReceivedNow =
            Number(
              receiptLine.quantity
            ) || 0;

          return {
            ...item,

            quantityReceived:
              Math.min(
                previouslyReceived +
                  quantityReceivedNow,
                orderedQuantity
              ),
          };
        });

      const fullyReceived =
        updatedItems.length > 0 &&
        updatedItems.every(
          (item) =>
            (Number(
              item.quantityReceived
            ) || 0) >=
            (Number(
              item.quantity
            ) || 0)
        );

      const previousReceipts =
        Array.isArray(
          purchaseOrder.receipts
        )
          ? purchaseOrder.receipts
          : [];

      const now =
        new Date().toISOString();

      const newReceipt = {
        id: createRecordId(),

        receiptDate:
          receiptData.receiptDate,

        reference:
          receiptData.reference ||
          "",

        notes:
          receiptData.notes || "",

        receivedAt: now,

        items: receiptLines,
      };

      updatePurchaseOrder(
        purchaseOrder.id,
        {
          items: updatedItems,

          receipts: [
            newReceipt,
            ...previousReceipts,
          ],

          status: fullyReceived
            ? "Closed"
            : purchaseOrder.status,

          receivedAt:
            fullyReceived
              ? now
              : purchaseOrder
                  .receivedAt || null,

          lastReceiptAt: now,
        }
      );

      setIsReceiveModalOpen(
        false
      );

      navigate(0);
    } catch (error) {
      window.alert(
        error.message ||
          "The receipt could not be saved."
      );
    } finally {
      setIsReceiving(false);
    }
  };

  // Handles convert to bill.
  const handleConvertToBill = () => {
    if (
      purchaseOrder.linkedBillId
    ) {
      navigate(
        `/purchases/bills/${purchaseOrder.linkedBillId}`
      );

      return;
    }

    const receivedItems =
      items
        .filter(
          (item) =>
            (Number(
              item.quantityReceived
            ) || 0) > 0
        )
        .map((item) => ({
          ...item,

          id: createRecordId(),

          quantity:
            Number(
              item.quantityReceived
            ) || 0,

          quantityReceived: 0,

          purchaseOrderItemId:
            item.id,
        }));

    if (
      receivedItems.length === 0
    ) {
      window.alert(
        "At least one received item is required before creating a bill."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Create a draft bill from purchase order ${purchaseOrder.orderNumber}?\n\nThe bill will include the quantities received so far.`
      );

    if (!confirmed) {
      return;
    }

    setIsConvertingToBill(true);

    try {
      const issueDate =
        new Date();

      const paymentTerms =
        purchaseOrder.paymentTerms ||
        selectedSupplier
          ?.paymentTerms ||
        "30 days";

      const paymentTermDays =
        getPaymentTermDays(
          paymentTerms
        );

      const dueDate = new Date(
        issueDate
      );

      dueDate.setDate(
        dueDate.getDate() +
          paymentTermDays
      );

      const linkedSupplierId =
        supplierId !== null &&
        supplierId !== undefined &&
        supplierId !== ""
          ? Number(supplierId)
          : null;

      const newBill = createBill(
        {
          supplierId:
            linkedSupplierId,

          supplier:
            supplierName,

          supplierEmail,

          supplierAddress:
            supplierAddressLines,

          supplierReference:
            purchaseOrder.supplierReference ||
            purchaseOrder.orderNumber ||
            "",

          issueDate:
            formatDateInputValue(
              issueDate
            ),

          dueDate:
            formatDateInputValue(
              dueDate
            ),

          paymentTerms,

          currency:
            purchaseOrder.currency ||
            selectedSupplier
              ?.currency ||
            "GBP",

          pricingMode:
            purchaseOrder.pricingMode ||
            "exclusive",

          category:
            purchaseOrder.category ||
            "",

          items: receivedItems,

          notes: [
            `Created from purchase order ${purchaseOrder.orderNumber}.`,

            purchaseOrder.notes ||
              "",
          ]
            .filter(Boolean)
            .join("\n\n"),

          purchaseOrderId:
            purchaseOrder.id,

          purchaseOrderNumber:
            purchaseOrder.orderNumber,

          source:
            "purchase-order",
        },
        "Draft"
      );

      updatePurchaseOrder(
        purchaseOrder.id,
        {
          linkedBillId:
            newBill.id,

          linkedBillNumber:
            newBill.billNumber,

          convertedToBillAt:
            new Date().toISOString(),
        }
      );

      navigate(
        `/purchases/bills/${newBill.id}`
      );
    } catch (error) {
      window.alert(
        error.message ||
          "The purchase order could not be converted to a bill."
      );

      setIsConvertingToBill(
        false
      );
    }
  };

  // Handles delete.
  const handleDelete = () => {
    if (
      purchaseOrder.linkedBillId
    ) {
      window.alert(
        "This purchase order cannot be deleted because a bill has already been created from it."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Delete purchase order ${purchaseOrder.orderNumber}?\n\nThis action cannot be undone.`
      );

    if (!confirmed) {
      return;
    }

    try {
      deletePurchaseOrder(
        purchaseOrder.id
      );

      navigate(
        "/purchases/orders",
        {
          replace: true,
        }
      );
    } catch (error) {
      window.alert(
        error.message ||
          "The purchase order could not be deleted."
      );
    }
  };

  return (
    <div className="invoice-details-page purchase-order-details-page">
      <div className="invoice-back-row">
        <Link
          to="/purchases/orders"
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to purchase orders
        </Link>
      </div>

      <PageHeader
        eyebrow="Purchases"
        title={
          purchaseOrder.orderNumber ||
          "Purchase order"
        }
        description={
          <>
            Purchase order for{" "}
            {supplierUrl ? (
              <Link
                to={supplierUrl}
                className="invoice-number-link"
              >
                {supplierName}
              </Link>
            ) : (
              supplierName
            )}
          </>
        }
        action={
          <div className="page-header-actions">
            {supplierUrl && (
              <Link
                to={supplierUrl}
                className="secondary-button"
              >
                <Building2 size={17} />
                View supplier
              </Link>
            )}

            <Link
              to={`/purchases/orders/${purchaseOrder.id}/edit`}
              className="secondary-button"
            >
              <Edit3 size={17} />
              Edit
            </Link>

            <button
              type="button"
              className="secondary-button purchase-order-details-delete-button"
              onClick={handleDelete}
            >
              <Trash2 size={17} />
              Delete
            </button>

            {purchaseOrder.status ===
              "Draft" && (
              <button
                type="button"
                className="primary-button"
                onClick={
                  handleApprove
                }
              >
                <CheckCircle2
                  size={17}
                />
                Approve
              </button>
            )}

            {purchaseOrder.status ===
              "Approved" && (
              <button
                type="button"
                className="primary-button"
                onClick={
                  handleMarkSent
                }
              >
                <Send size={17} />
                Mark as sent
              </button>
            )}

            {[
              "Approved",
              "Sent",
            ].includes(
              purchaseOrder.status
            ) &&
              remainingQuantity > 0 && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    setIsReceiveModalOpen(
                      true
                    )
                  }
                >
                  <PackageCheck
                    size={17}
                  />
                  Receive items
                </button>
              )}

            {totalReceived > 0 &&
              !purchaseOrder
                .linkedBillId && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    handleConvertToBill
                  }
                  disabled={
                    isConvertingToBill
                  }
                >
                  <FileText size={17} />

                  {isConvertingToBill
                    ? "Creating bill..."
                    : "Convert to bill"}
                </button>
              )}

            {purchaseOrder
              .linkedBillId && (
              <Link
                to={`/purchases/bills/${purchaseOrder.linkedBillId}`}
                className="primary-button"
              >
                <FileText size={17} />
                View bill
              </Link>
            )}
          </div>
        }
      />

      <div className="invoice-details-summary-row">
        <div className="invoice-details-status">
          <span
            className={`purchase-order-status-badge purchase-order-status-${getStatusClassName(
              purchaseOrder.status
            )}`}
          >
            {purchaseOrder.status ||
              "Draft"}
          </span>
        </div>

        <div className="invoice-details-summary-item">
          <CalendarDays size={18} />

          <div>
            <span>Order date</span>

            <strong>
              {formatDate(
                purchaseOrder.orderDate
              )}
            </strong>
          </div>
        </div>

        <div className="invoice-details-summary-item">
          <Truck size={18} />

          <div>
            <span>
              Expected delivery
            </span>

            <strong>
              {formatDate(
                purchaseOrder
                  .expectedDeliveryDate
              )}
            </strong>
          </div>
        </div>

        <div className="invoice-details-summary-item">
          <PackageCheck size={18} />

          <div>
            <span>
              Receipt status
            </span>

            <strong>
              {receiptSummary
                .receiptStatus ||
                "Not received"}
            </strong>
          </div>
        </div>
      </div>

      <div className="invoice-details-layout">
        <main className="invoice-details-main">
          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <div>
                <h2>
                  Purchase order items
                </h2>

                <p>
                  Products and services
                  included in this order.
                </p>
              </div>
            </div>

            {items.length > 0 ? (
              <div className="invoice-table-wrapper">
                <table className="invoice-details-table">
                  <thead>
                    <tr>
                      <th>
                        Description
                      </th>

                      <th>
                        Quantity
                      </th>

                      <th>
                        Received
                      </th>

                      <th>
                        Unit price
                      </th>

                      <th>
                        Discount
                      </th>

                      <th>VAT</th>

                      <th>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.map(
                      (
                        item,
                        index
                      ) => {
                        const itemTotals =
                          calculatePurchaseOrderTotals(
                            {
                              pricingMode:
                                purchaseOrder.pricingMode ||
                                "exclusive",

                              items: [
                                item,
                              ],
                            }
                          );

                        return (
                          <tr
                            key={
                              item.id ||
                              `${purchaseOrder.id}-${index}`
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
                              {Number(
                                item.quantityReceived
                              ) || 0}
                            </td>

                            <td>
                              {formatCurrency(
                                item.unitPrice,
                                purchaseOrder.currency
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
                                  itemTotals.total,
                                  purchaseOrder.currency
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
            ) : (
              <div className="invoice-empty-state">
                <h3>
                  No line items
                </h3>

                <p>
                  This purchase order
                  does not contain any
                  items.
                </p>
              </div>
            )}
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <div>
                <h2>
                  Delivery information
                </h2>

                <p>
                  Delivery destination
                  and expected date.
                </p>
              </div>
            </div>

            <div className="purchase-order-delivery-details">
              <div>
                <MapPin size={19} />

                <div>
                  <span>
                    Delivery address
                  </span>

                  <p>
                    {purchaseOrder.deliveryAddress ||
                      "No delivery address was provided."}
                  </p>
                </div>
              </div>

              <div>
                <Truck size={19} />

                <div>
                  <span>
                    Delivery date
                  </span>

                  <p>
                    {formatDate(
                      purchaseOrder
                        .expectedDeliveryDate
                    )}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {purchaseOrder.notes && (
            <section className="invoice-details-card">
              <div className="invoice-details-card-header">
                <div>
                  <h2>Notes</h2>
                </div>
              </div>

              <p className="invoice-details-notes">
                {purchaseOrder.notes}
              </p>
            </section>
          )}

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <div>
                <h2>
                  Receipt history
                </h2>

                <p>
                  Review each delivery
                  recorded against this
                  purchase order.
                </p>
              </div>

              <span className="purchase-receipt-count">
                {receipts.length}
                {receipts.length === 1
                  ? " receipt"
                  : " receipts"}
              </span>
            </div>

            {receipts.length > 0 ? (
              <div className="purchase-receipt-history">
                {receipts.map(
                  (
                    receipt,
                    receiptIndex
                  ) => {
                    const receiptItems =
                      Array.isArray(
                        receipt.items
                      )
                        ? receipt.items
                        : [];

                    const totalReceiptQuantity =
                      receiptItems.reduce(
                        (
                          total,
                          item
                        ) =>
                          total +
                          (Number(
                            item.quantity
                          ) || 0),
                        0
                      );

                    return (
                      <article
                        key={
                          receipt.id ||
                          `${receipt.receivedAt}-${receiptIndex}`
                        }
                        className="purchase-receipt-history-item"
                      >
                        <div className="purchase-receipt-history-heading">
                          <div>
                            <strong>
                              Receipt{" "}
                              {receipts.length -
                                receiptIndex}
                            </strong>

                            <span>
                              {formatDate(
                                receipt.receiptDate
                              )}
                            </span>
                          </div>

                          <span className="purchase-receipt-quantity-badge">
                            {
                              totalReceiptQuantity
                            }{" "}
                            received
                          </span>
                        </div>

                        <div className="purchase-receipt-meta">
                          <div>
                            <span>
                              Delivery note
                            </span>

                            <strong>
                              {receipt.reference ||
                                "No reference"}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Recorded
                            </span>

                            <strong>
                              {formatDateTime(
                                receipt.receivedAt
                              )}
                            </strong>
                          </div>
                        </div>

                        <div className="purchase-receipt-lines">
                          <h3>
                            Items received
                          </h3>

                          {receiptItems.map(
                            (
                              receiptItem,
                              itemIndex
                            ) => (
                              <div
                                key={
                                  receiptItem.itemId ||
                                  `${receipt.id}-${itemIndex}`
                                }
                                className="purchase-receipt-line"
                              >
                                <span>
                                  {receiptItem.description ||
                                    "Untitled item"}
                                </span>

                                <strong>
                                  {Number(
                                    receiptItem.quantity
                                  ) || 0}
                                </strong>
                              </div>
                            )
                          )}
                        </div>

                        {receipt.notes && (
                          <div className="purchase-receipt-notes">
                            <span>
                              Notes
                            </span>

                            <p>
                              {
                                receipt.notes
                              }
                            </p>
                          </div>
                        )}
                      </article>
                    );
                  }
                )}
              </div>
            ) : (
              <div className="purchase-receipt-empty-state">
                <PackageCheck
                  size={30}
                />

                <h3>
                  No receipts recorded
                </h3>

                <p>
                  Received items will
                  appear here after a
                  delivery is recorded.
                </p>
              </div>
            )}
          </section>
        </main>

        <aside className="invoice-details-sidebar">
          <section className="invoice-total-card">
            <h2>Order total</h2>

            <div className="invoice-total-row">
              <span>Subtotal</span>

              <strong>
                {formatCurrency(
                  totals.subtotal,
                  purchaseOrder.currency
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
                    purchaseOrder.currency
                  )}
                </strong>
              </div>
            )}

            <div className="invoice-total-row">
              <span>VAT</span>

              <strong>
                {formatCurrency(
                  totals.vat,
                  purchaseOrder.currency
                )}
              </strong>
            </div>

            <div className="invoice-total-row invoice-total-row-final">
              <span>Total</span>

              <strong>
                {formatCurrency(
                  totals.total,
                  purchaseOrder.currency
                )}
              </strong>
            </div>
          </section>

          <section className="invoice-details-card">
            <div className="invoice-details-card-header">
              <h2>Supplier</h2>
            </div>

            <div className="invoice-details-list">
              <div>
                <span>Name</span>

                {supplierUrl ? (
                  <Link
                    to={supplierUrl}
                    className="invoice-number-link"
                  >
                    {supplierName}
                  </Link>
                ) : (
                  <strong>
                    {supplierName}
                  </strong>
                )}
              </div>

              <div>
                <span>Email</span>

                {supplierEmail ? (
                  <a
                    href={`mailto:${supplierEmail}`}
                  >
                    {supplierEmail}
                  </a>
                ) : (
                  <strong>—</strong>
                )}
              </div>

              <div>
                <span>
                  Supplier reference
                </span>

                <strong>
                  {purchaseOrder.supplierReference ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Account number
                </span>

                <strong>
                  {selectedSupplier
                    ?.accountNumber ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Payment terms
                </span>

                <strong>
                  {purchaseOrder.paymentTerms ||
                    selectedSupplier
                      ?.paymentTerms ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>Currency</span>

                <strong>
                  {purchaseOrder.currency ||
                    selectedSupplier
                      ?.currency ||
                    "GBP"}
                </strong>
              </div>

              <div>
                <span>
                  Tax pricing
                </span>

                <strong>
                  {purchaseOrder.pricingMode ===
                  "inclusive"
                    ? "Tax inclusive"
                    : "Tax exclusive"}
                </strong>
              </div>
            </div>

            {supplierAddressLines
              .length > 0 && (
              <div className="supplier-address-card">
                <MapPin size={18} />

                <div>
                  {supplierAddressLines.map(
                    (
                      line,
                      index
                    ) => (
                      <p
                        key={`${line}-${index}`}
                      >
                        {line}
                      </p>
                    )
                  )}
                </div>
              </div>
            )}

            {supplierUrl && (
              <Link
                to={supplierUrl}
                className="secondary-button invoice-full-width-button"
              >
                <Building2 size={17} />
                View supplier
              </Link>
            )}
          </section>

          {purchaseOrder
            .linkedBillId && (
            <section className="invoice-details-card">
              <div className="invoice-details-card-header">
                <h2>Linked bill</h2>
              </div>

              <div className="invoice-details-list">
                <div>
                  <span>
                    Bill number
                  </span>

                  <strong>
                    {purchaseOrder.linkedBillNumber ||
                      `Bill #${purchaseOrder.linkedBillId}`}
                  </strong>
                </div>

                <div>
                  <span>Created</span>

                  <strong>
                    {formatDateTime(
                      purchaseOrder.convertedToBillAt
                    )}
                  </strong>
                </div>
              </div>

              <Link
                to={`/purchases/bills/${purchaseOrder.linkedBillId}`}
                className="secondary-button invoice-full-width-button purchase-order-view-bill-button"
              >
                <FileText size={16} />
                View bill
              </Link>
            </section>
          )}

          <section className="invoice-details-card">
            <div className="purchase-receipt-progress-heading">
              <h2>
                Receipt progress
              </h2>

              <strong>
                {receiptProgress}%
              </strong>
            </div>

            <div
              className="purchase-receipt-progress-track"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={
                receiptProgress
              }
              aria-label="Purchase order receipt progress"
            >
              <div
                className="purchase-receipt-progress-fill"
                style={{
                  width: `${receiptProgress}%`,
                }}
              />
            </div>

            <div className="invoice-details-list">
              <div>
                <span>Ordered</span>

                <strong>
                  {totalOrdered}
                </strong>
              </div>

              <div>
                <span>Received</span>

                <strong>
                  {totalReceived}
                </strong>
              </div>

              <div>
                <span>Remaining</span>

                <strong>
                  {remainingQuantity}
                </strong>
              </div>

              <div>
                <span>Deliveries</span>

                <strong>
                  {receipts.length}
                </strong>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <ReceivePurchaseOrderModal
        isOpen={
          isReceiveModalOpen
        }
        purchaseOrder={
          purchaseOrder
        }
        isSaving={isReceiving}
        onClose={() =>
          setIsReceiveModalOpen(
            false
          )
        }
        onSave={
          handleReceiveItems
        }
      />
    </div>
  );
}

export default PurchaseOrderDetailsPage;