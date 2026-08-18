import {
  getProductById,
  setProductStockQuantity,
} from "./productService";

const STOCK_ADJUSTMENTS_STORAGE_KEY =
  "ledgify_stock_adjustments";

const INVENTORY_AFFECTING_STATUSES =
  new Set([
    "Awaiting payment",
    "Partly paid",
    "Paid",
    "Overdue",
  ]);

const createId = () => {
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

const roundQuantity = (value) => {
  return (
    Math.round(
      ((Number(value) || 0) +
        Number.EPSILON) *
        1000
    ) / 1000
  );
};

const roundMoney = (value) => {
  return (
    Math.round(
      ((Number(value) || 0) +
        Number.EPSILON) *
        100
    ) / 100
  );
};

const readAdjustments = () => {
  const storedAdjustments =
    localStorage.getItem(
      STOCK_ADJUSTMENTS_STORAGE_KEY
    );

  if (!storedAdjustments) {
    return [];
  }

  try {
    const parsedAdjustments =
      JSON.parse(storedAdjustments);

    return Array.isArray(
      parsedAdjustments
    )
      ? parsedAdjustments
      : [];
  } catch (error) {
    console.error(
      "Unable to read stock adjustments:",
      error
    );

    return [];
  }
};

const saveAdjustments = (
  adjustments
) => {
  localStorage.setItem(
    STOCK_ADJUSTMENTS_STORAGE_KEY,
    JSON.stringify(adjustments)
  );

  return adjustments;
};

const getLocalDate = (
  date = new Date()
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

const normaliseDocumentDate = (
  value
) => {
  if (!value) {
    return getLocalDate();
  }

  const text =
    String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return text;
  }

  const displayDateMatch =
    text.match(
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

    const month =
      monthNumbers[
        displayDateMatch[2]
          .toLowerCase()
      ];

    if (
      month !== undefined
    ) {
      return getLocalDate(
        new Date(
          Number(
            displayDateMatch[3]
          ),
          month,
          Number(
            displayDateMatch[1]
          )
        )
      );
    }
  }

  const parsedDate =
    new Date(text);

  return Number.isNaN(
    parsedDate.getTime()
  )
    ? getLocalDate()
    : getLocalDate(parsedDate);
};

const calculateInventoryUnitCost = (
  item,
  pricingMode
) => {
  const unitPrice =
    Number(item?.unitPrice) || 0;

  const discountRate =
    Number(
      item?.discountRate
    ) || 0;

  const vatRate =
    Number(item?.vatRate) || 0;

  let unitCost =
    unitPrice *
    (1 -
      Math.min(
        Math.max(
          discountRate,
          0
        ),
        100
      ) /
        100);

  if (
    pricingMode === "inclusive" &&
    vatRate > 0
  ) {
    unitCost =
      unitCost /
      (1 + vatRate / 100);
  }

  return roundMoney(unitCost);
};

const getBillRequirements = (
  bill
) => {
  const requirements =
    new Map();

  const items = Array.isArray(
    bill?.items
  )
    ? bill.items
    : [];

  items.forEach((item) => {
    const quantity =
      roundQuantity(
        item?.quantity
      );

    if (
      !item?.productId ||
      quantity <= 0
    ) {
      return;
    }

    const product =
      getProductById(
        item.productId
      );

    if (!product) {
      throw new Error(
        `The product linked to ${
          item.description ||
          "a bill line"
        } could not be found.`
      );
    }

    if (
      product.type !==
        "Product" ||
      !product.trackInventory
    ) {
      return;
    }

    if (
      product.status !==
      "Active"
    ) {
      throw new Error(
        `${product.name} is archived and cannot be received through an approved bill.`
      );
    }

    const key =
      String(product.id);

    const unitCost =
      calculateInventoryUnitCost(
        item,
        bill.pricingMode ||
          "exclusive"
      );

    const existing =
      requirements.get(key);

    const totalQuantity =
      roundQuantity(
        (existing?.quantity ||
          0) + quantity
      );

    const totalCost =
      roundMoney(
        (existing?.totalCost ||
          0) +
          quantity * unitCost
      );

    requirements.set(key, {
      productId:
        product.id,

      productName:
        product.name,

      sku:
        product.sku || "",

      quantity:
        totalQuantity,

      totalCost,
    });
  });

  return Array.from(
    requirements.values()
  ).map((requirement) => ({
    ...requirement,

    unitCost:
      requirement.quantity > 0
        ? roundMoney(
            requirement.totalCost /
              requirement.quantity
          )
        : 0,
  }));
};

const rollbackProducts = (
  snapshots
) => {
  [...snapshots]
    .reverse()
    .forEach((snapshot) => {
      try {
        setProductStockQuantity(
          snapshot.productId,
          snapshot.quantityBefore,
          {
            allowArchived: true,
          }
        );
      } catch (error) {
        console.error(
          "Bill inventory rollback failed:",
          error
        );
      }
    });
};

const restoreAdjustmentHistory = (
  adjustments
) => {
  try {
    saveAdjustments(
      adjustments
    );
  } catch (error) {
    console.error(
      "Stock-adjustment history rollback failed:",
      error
    );
  }
};

export const billStatusAffectsInventory =
  (status) => {
    return (
      INVENTORY_AFFECTING_STATUSES.has(
        status
      )
    );
  };

export const commitBillInventory = (
  bill
) => {
  if (
    bill.inventoryCommitted
  ) {
    return {
      inventoryCommitted:
        true,

      inventoryCommittedAt:
        bill.inventoryCommittedAt ||
        new Date().toISOString(),

      inventoryCommitments:
        bill.inventoryCommitments ||
        [],

      inventoryMovementIds:
        bill.inventoryMovementIds ||
        [],

      inventoryRestoredAt:
        null,

      inventoryReversalMovementIds:
        [],
    };
  }

  const requirements =
    getBillRequirements(bill);

  if (
    requirements.length === 0
  ) {
    return {
      inventoryCommitted:
        false,

      inventoryCommittedAt:
        null,

      inventoryCommitments:
        [],

      inventoryMovementIds:
        [],

      inventoryRestoredAt:
        null,

      inventoryReversalMovementIds:
        [],
    };
  }

  const previousAdjustments =
    readAdjustments();

  const productSnapshots = [];
  const movements = [];
  const commitments = [];

  const now = new Date();

  try {
    requirements.forEach(
      (requirement) => {
        const product =
          getProductById(
            requirement.productId
          );

        if (!product) {
          throw new Error(
            `${requirement.productName} could not be found.`
          );
        }

        const quantityBefore =
          roundQuantity(
            product.quantityOnHand
          );

        const quantityAfter =
          roundQuantity(
            quantityBefore +
              requirement.quantity
          );

        const movementId =
          createId();

        productSnapshots.push({
          productId:
            requirement.productId,

          quantityBefore,
        });

        setProductStockQuantity(
          requirement.productId,
          quantityAfter,
          {
            allowArchived: true,
          }
        );

        movements.push({
          id: movementId,

          productId:
            requirement.productId,

          productName:
            requirement.productName,

          sku:
            requirement.sku,

          date:
            normaliseDocumentDate(
              bill.issueDate
            ),

          adjustmentType:
            "Increase",

          reason:
            "Bill purchase",

          enteredQuantity:
            requirement.quantity,

          quantityChange:
            requirement.quantity,

          quantityBefore,
          quantityAfter,

          unitCost:
            requirement.unitCost,

          valueImpact:
            roundMoney(
              requirement.quantity *
                requirement.unitCost
            ),

          reference:
            bill.supplierReference ||
            bill.billNumber ||
            "",

          notes:
            `Stock received from bill ${
              bill.billNumber ||
              bill.id
            }${
              bill.supplier
                ? ` supplied by ${bill.supplier}`
                : ""
            }.`,

          adjustedBy:
            "System",

          sourceType:
            "Bill",

          sourceId:
            bill.id,

          sourceNumber:
            bill.billNumber ||
            "",

          sourceAction:
            "Stock received",

          createdAt:
            now.toISOString(),
        });

        commitments.push({
          productId:
            requirement.productId,

          productName:
            requirement.productName,

          sku:
            requirement.sku,

          quantity:
            requirement.quantity,

          unitCost:
            requirement.unitCost,

          movementId,
        });
      }
    );

    saveAdjustments([
      ...movements,
      ...previousAdjustments,
    ]);

    return {
      inventoryCommitted:
        true,

      inventoryCommittedAt:
        now.toISOString(),

      inventoryCommitments:
        commitments,

      inventoryMovementIds:
        movements.map(
          (movement) =>
            movement.id
        ),

      inventoryRestoredAt:
        null,

      inventoryReversalMovementIds:
        [],
    };
  } catch (error) {
    rollbackProducts(
      productSnapshots
    );

    restoreAdjustmentHistory(
      previousAdjustments
    );

    throw error;
  }
};

export const restoreBillInventory = (
  bill,
  restorationReason =
    "Bill reversal"
) => {
  if (
    !bill.inventoryCommitted
  ) {
    return {
      inventoryCommitted:
        false,

      inventoryRestoredAt:
        bill.inventoryRestoredAt ||
        null,

      inventoryReversalMovementIds:
        bill.inventoryReversalMovementIds ||
        [],
    };
  }

  const commitments =
    Array.isArray(
      bill.inventoryCommitments
    )
      ? bill.inventoryCommitments
      : [];

  if (
    commitments.length === 0
  ) {
    return {
      inventoryCommitted:
        false,

      inventoryRestoredAt:
        new Date().toISOString(),

      inventoryReversalMovementIds:
        [],
    };
  }

  commitments.forEach(
    (commitment) => {
      const product =
        getProductById(
          commitment.productId
        );

      if (!product) {
        throw new Error(
          `${
            commitment.productName ||
            "An inventory product"
          } could not be found, so the bill inventory cannot be reversed.`
        );
      }

      const currentQuantity =
        Number(
          product.quantityOnHand
        ) || 0;

      const quantityToReverse =
        Number(
          commitment.quantity
        ) || 0;

      if (
        quantityToReverse >
        currentQuantity + 0.0005
      ) {
        throw new Error(
          `${product.name} cannot be reversed because the bill added ${quantityToReverse} units, but only ${currentQuantity} units remain in stock.`
        );
      }
    }
  );

  const previousAdjustments =
    readAdjustments();

  const productSnapshots = [];
  const reversals = [];
  const reversalMap =
    new Map();

  const now = new Date();

  try {
    commitments.forEach(
      (commitment) => {
        const product =
          getProductById(
            commitment.productId
          );

        const quantityBefore =
          roundQuantity(
            product.quantityOnHand
          );

        const quantityChange =
          roundQuantity(
            Number(
              commitment.quantity
            ) || 0
          );

        const quantityAfter =
          roundQuantity(
            quantityBefore -
              quantityChange
          );

        const reversalId =
          createId();

        const unitCost =
          roundMoney(
            commitment.unitCost ??
              product.purchaseCost
          );

        productSnapshots.push({
          productId:
            commitment.productId,

          quantityBefore,
        });

        setProductStockQuantity(
          commitment.productId,
          quantityAfter,
          {
            allowArchived: true,
          }
        );

        reversals.push({
          id: reversalId,

          productId:
            commitment.productId,

          productName:
            commitment.productName ||
            product.name,

          sku:
            commitment.sku ||
            product.sku ||
            "",

          date:
            getLocalDate(now),

          adjustmentType:
            "Decrease",

          reason:
            "Bill reversal",

          enteredQuantity:
            quantityChange,

          quantityChange:
            roundQuantity(
              -quantityChange
            ),

          quantityBefore,
          quantityAfter,

          unitCost,

          valueImpact:
            roundMoney(
              -quantityChange *
                unitCost
            ),

          reference:
            bill.supplierReference ||
            bill.billNumber ||
            "",

          notes:
            `Stock removed after reversing bill ${
              bill.billNumber ||
              bill.id
            }. Reason: ${restorationReason}.`,

          adjustedBy:
            "System",

          sourceType:
            "Bill",

          sourceId:
            bill.id,

          sourceNumber:
            bill.billNumber ||
            "",

          sourceAction:
            "Stock receipt reversed",

          reversalOfMovementId:
            commitment.movementId ||
            null,

          createdAt:
            now.toISOString(),
        });

        if (
          commitment.movementId
        ) {
          reversalMap.set(
            String(
              commitment.movementId
            ),
            reversalId
          );
        }
      }
    );

    const markedAdjustments =
      previousAdjustments.map(
        (adjustment) => {
          const reversalMovementId =
            reversalMap.get(
              String(
                adjustment.id
              )
            );

          if (
            !reversalMovementId
          ) {
            return adjustment;
          }

          return {
            ...adjustment,

            reversedAt:
              now.toISOString(),

            reversalMovementId,
          };
        }
      );

    saveAdjustments([
      ...reversals,
      ...markedAdjustments,
    ]);

    return {
      inventoryCommitted:
        false,

      inventoryRestoredAt:
        now.toISOString(),

      inventoryReversalMovementIds:
        reversals.map(
          (movement) =>
            movement.id
        ),
    };
  } catch (error) {
    rollbackProducts(
      productSnapshots
    );

    restoreAdjustmentHistory(
      previousAdjustments
    );

    throw error;
  }
};