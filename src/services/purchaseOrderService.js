import {
  purchaseOrders as defaultPurchaseOrders,
} from "../data/purchaseOrders";

const STORAGE_KEY =
  "ledgify_purchase_orders";

// Performs the clone data task.
const cloneData = (data) =>
  JSON.parse(JSON.stringify(data));

// Normalizes text.
const normaliseText = (value) =>
  String(value ?? "").trim();

// Normalizes supplier address.
const normaliseSupplierAddress = (
  address
) => {
  if (Array.isArray(address)) {
    return address
      .map((line) =>
        normaliseText(line)
      )
      .filter(Boolean);
  }

  if (
    address &&
    typeof address === "object"
  ) {
    return [
      address.line1,
      address.line2,
      address.city,
      address.county,
      address.postcode,
      address.country,
    ]
      .map((line) =>
        normaliseText(line)
      )
      .filter(Boolean);
  }

  return [];
};

// Saves to storage.
const saveToStorage = (
  purchaseOrders
) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(purchaseOrders)
  );

  return purchaseOrders;
};

// Performs the initialise purchase orders task.
const initialisePurchaseOrders = () => {
  const storedOrders =
    localStorage.getItem(STORAGE_KEY);

  if (storedOrders) {
    try {
      const parsedOrders =
        JSON.parse(storedOrders);

      if (
        Array.isArray(parsedOrders)
      ) {
        return parsedOrders;
      }
    } catch (error) {
      console.error(
        "Unable to read saved purchase orders:",
        error
      );
    }
  }

  const initialOrders =
    cloneData(defaultPurchaseOrders);

  saveToStorage(initialOrders);

  return initialOrders;
};

// Gets purchase orders.
export const getPurchaseOrders = () => {
  return initialisePurchaseOrders();
};

// Gets purchase order by id.
export const getPurchaseOrderById = (
  purchaseOrderId
) => {
  return (
    getPurchaseOrders().find(
      (purchaseOrder) =>
        String(purchaseOrder.id) ===
        String(purchaseOrderId)
    ) || null
  );
};

// Saves purchase orders.
export const savePurchaseOrders = (
  purchaseOrders
) => {
  if (
    !Array.isArray(purchaseOrders)
  ) {
    throw new Error(
      "Purchase orders must be supplied as an array."
    );
  }

  return saveToStorage(
    purchaseOrders
  );
};

// Updates purchase order.
export const updatePurchaseOrder = (
  purchaseOrderId,
  updatedFields
) => {
  const purchaseOrders =
    getPurchaseOrders();

  const currentOrder =
    purchaseOrders.find(
      (purchaseOrder) =>
        String(purchaseOrder.id) ===
        String(purchaseOrderId)
    );

  if (!currentOrder) {
    throw new Error(
      "Purchase order not found."
    );
  }

  const updatedOrder = {
    ...currentOrder,
    ...updatedFields,

    id: currentOrder.id,

    supplierId:
      updatedFields.supplierId !==
        undefined &&
      updatedFields.supplierId !==
        null &&
      updatedFields.supplierId !== ""
        ? Number(
            updatedFields.supplierId
          )
        : currentOrder.supplierId ??
          null,

    supplierAddress:
      updatedFields.supplierAddress !==
      undefined
        ? normaliseSupplierAddress(
            updatedFields.supplierAddress
          )
        : normaliseSupplierAddress(
            currentOrder.supplierAddress
          ),

    items:
      updatedFields.items !== undefined
        ? cloneData(
            updatedFields.items
          )
        : cloneData(
            currentOrder.items || []
          ),

    updatedAt:
      new Date().toISOString(),
  };

  const updatedOrders =
    purchaseOrders.map(
      (purchaseOrder) =>
        String(purchaseOrder.id) ===
        String(purchaseOrderId)
          ? updatedOrder
          : purchaseOrder
    );

  savePurchaseOrders(
    updatedOrders
  );

  return updatedOrder;
};

// Deletes purchase order.
export const deletePurchaseOrder = (
  purchaseOrderId
) => {
  const purchaseOrder =
    getPurchaseOrderById(
      purchaseOrderId
    );

  if (!purchaseOrder) {
    throw new Error(
      "Purchase order not found."
    );
  }

  const remainingOrders =
    getPurchaseOrders().filter(
      (currentOrder) =>
        String(currentOrder.id) !==
        String(purchaseOrderId)
    );

  savePurchaseOrders(
    remainingOrders
  );

  return purchaseOrder;
};

// Gets next purchase order number.
export const getNextPurchaseOrderNumber =
  () => {
    const highestNumber =
      getPurchaseOrders().reduce(
        (
          highest,
          purchaseOrder
        ) => {
          const numericPart =
            Number(
              String(
                purchaseOrder.orderNumber ||
                  ""
              ).replace(/\D/g, "")
            );

          if (
            !Number.isFinite(
              numericPart
            )
          ) {
            return highest;
          }

          return Math.max(
            highest,
            numericPart
          );
        },
        1000
      );

    return `PO-${
      highestNumber + 1
    }`;
  };

// Creates purchase order.
export const createPurchaseOrder = (
  purchaseOrderData
) => {
  const purchaseOrders =
    getPurchaseOrders();

  const supplierName =
    normaliseText(
      purchaseOrderData.supplierName
    );

  if (!supplierName) {
    throw new Error(
      "A supplier is required."
    );
  }

  const orderNumber =
    normaliseText(
      purchaseOrderData.orderNumber
    ) ||
    getNextPurchaseOrderNumber();

  const duplicateOrderNumber =
    purchaseOrders.some(
      (purchaseOrder) =>
        normaliseText(
          purchaseOrder.orderNumber
        ).toLowerCase() ===
        orderNumber.toLowerCase()
    );

  if (duplicateOrderNumber) {
    throw new Error(
      "A purchase order already uses this order number."
    );
  }

  const nextId =
    purchaseOrders.length > 0
      ? Math.max(
          ...purchaseOrders.map(
            (purchaseOrder) =>
              Number(
                purchaseOrder.id
              ) || 0
          )
        ) + 1
      : 1;

  const now =
    new Date().toISOString();

  const newPurchaseOrder = {
    id: nextId,

    orderNumber,

    supplierId:
      purchaseOrderData.supplierId !==
        undefined &&
      purchaseOrderData.supplierId !==
        null &&
      purchaseOrderData.supplierId !==
        ""
        ? Number(
            purchaseOrderData.supplierId
          )
        : null,

    supplierName,

    supplierEmail:
      normaliseText(
        purchaseOrderData.supplierEmail
      ),

    supplierAddress:
      normaliseSupplierAddress(
        purchaseOrderData.supplierAddress
      ),

    paymentTerms:
      purchaseOrderData.paymentTerms ||
      "30 days",

    supplierReference:
      normaliseText(
        purchaseOrderData
          .supplierReference
      ),

    orderDate:
      purchaseOrderData.orderDate ||
      "",

    expectedDeliveryDate:
      purchaseOrderData
        .expectedDeliveryDate || "",

    status:
      purchaseOrderData.status ||
      "Draft",

    currency:
      purchaseOrderData.currency ||
      "GBP",

    pricingMode:
      purchaseOrderData.pricingMode ||
      "exclusive",

    deliveryAddress:
      normaliseText(
        purchaseOrderData
          .deliveryAddress
      ),

    notes:
      normaliseText(
        purchaseOrderData.notes
      ),

    items:
      Array.isArray(
        purchaseOrderData.items
      )
        ? cloneData(
            purchaseOrderData.items
          )
        : [],

    subtotal:
      Number(
        purchaseOrderData.subtotal
      ) || 0,

    discount:
      Number(
        purchaseOrderData.discount
      ) || 0,

    taxTotal:
      Number(
        purchaseOrderData.taxTotal
      ) || 0,

    vatTotal:
      Number(
        purchaseOrderData.vatTotal
      ) ||
      Number(
        purchaseOrderData.taxTotal
      ) ||
      0,

    total:
      Number(
        purchaseOrderData.total
      ) || 0,

    createdAt: now,
    updatedAt: now,
  };

  savePurchaseOrders([
    newPurchaseOrder,
    ...purchaseOrders,
  ]);

  return newPurchaseOrder;
};

// Performs the duplicate purchase order task.
export const duplicatePurchaseOrder = (
  purchaseOrderId
) => {
  const originalOrder =
    getPurchaseOrderById(
      purchaseOrderId
    );

  if (!originalOrder) {
    throw new Error(
      "Purchase order not found."
    );
  }

  const now = new Date();

  const orderDate =
    now
      .toISOString()
      .split("T")[0];

  const duplicatedItems =
    (originalOrder.items || []).map(
      (item) => ({
        ...item,
        id:
          typeof crypto !==
            "undefined" &&
          typeof crypto.randomUUID ===
            "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        quantityReceived: 0,
      })
    );

  return createPurchaseOrder({
    orderNumber:
      getNextPurchaseOrderNumber(),

    supplierId:
      originalOrder.supplierId ??
      null,

    supplierName:
      originalOrder.supplierName,

    supplierEmail:
      originalOrder.supplierEmail ||
      "",

    supplierAddress:
      originalOrder.supplierAddress ||
      [],

    paymentTerms:
      originalOrder.paymentTerms ||
      "30 days",

    supplierReference: "",

    orderDate,

    expectedDeliveryDate: "",

    status: "Draft",

    currency:
      originalOrder.currency ||
      "GBP",

    pricingMode:
      originalOrder.pricingMode ||
      "exclusive",

    deliveryAddress:
      originalOrder.deliveryAddress ||
      "",

    notes:
      originalOrder.notes || "",

    items: duplicatedItems,

    subtotal:
      originalOrder.subtotal || 0,

    discount:
      originalOrder.discount || 0,

    taxTotal:
      originalOrder.taxTotal || 0,

    vatTotal:
      originalOrder.vatTotal ||
      originalOrder.taxTotal ||
      0,

    total:
      originalOrder.total || 0,
  });
};

// Resets purchase orders.
export const resetPurchaseOrders =
  () => {
    const initialOrders =
      cloneData(
        defaultPurchaseOrders
      );

    savePurchaseOrders(
      initialOrders
    );

    return initialOrders;
  };