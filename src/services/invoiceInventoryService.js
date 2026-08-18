import {
  getProductById,
  setProductStockQuantity,
} from "./productService";

const STOCK_ADJUSTMENTS_STORAGE_KEY =
  "ledgify_stock_adjustments";

const INVENTORY_AFFECTING_STATUSES =
  new Set([
    "Approved",
    "Sent",
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

const roundQuantity = (
  value
) => {
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
  const stored =
    localStorage.getItem(
      STOCK_ADJUSTMENTS_STORAGE_KEY
    );

  if (!stored) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(stored);

    return Array.isArray(parsed)
      ? parsed
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
};

const toStorageDate = (
  value
) => {
  const parsed = value
    ? new Date(value)
    : new Date();

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }

  const year =
    parsed.getFullYear();

  const month = String(
    parsed.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    parsed.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const normaliseInvoiceDate = (
  value
) => {
  if (!value) {
    return new Date()
      .toISOString()
      .slice(0, 10);
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

  const match = text.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
  );

  if (match) {
    const monthMap = {
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
      monthMap[
        match[2].toLowerCase()
      ];

    if (
      month !== undefined
    ) {
      return toStorageDate(
        new Date(
          Number(match[3]),
          month,
          Number(match[1])
        )
      );
    }
  }

  return toStorageDate(text);
};

const getRequirements = (
  items = []
) => {
  const requirements =
    new Map();

  items.forEach((item) => {
    if (
      !item?.productId ||
      Number(item.quantity) <= 0
    ) {
      return;
    }

    const product =
      getProductById(
        item.productId
      );

    if (!product) {
      throw new Error(
        `The inventory item linked to ${
          item.description ||
          "an invoice line"
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
        `${product.name} is archived and cannot be used on an approved invoice.`
      );
    }

    const key =
      String(product.id);

    const existing =
      requirements.get(key);

    requirements.set(
      key,
      {
        productId:
          product.id,

        productName:
          product.name,

        sku:
          product.sku || "",

        unitCost:
          roundMoney(
            product.purchaseCost
          ),

        quantity:
          roundQuantity(
            (existing?.quantity ||
              0) +
              Number(
                item.quantity
              )
          ),
      }
    );
  });

  return Array.from(
    requirements.values()
  );
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
          "Inventory rollback failed:",
          error
        );
      }
    });
};

export const invoiceStatusAffectsInventory =
  (status) => {
    return (
      INVENTORY_AFFECTING_STATUSES.has(
        status
      )
    );
  };

export const hasInvoiceFinancialChanges =
  (
    currentInvoice,
    nextInvoice
  ) => {
    const createSignature = (
      invoice
    ) => {
      return JSON.stringify({
        currency:
          invoice?.currency ||
          "GBP",

        pricingMode:
          invoice?.pricingMode ||
          "exclusive",

        items: (
          invoice?.items || []
        ).map((item) => ({
          productId:
            item.productId ??
            null,

          description:
            String(
              item.description ||
                ""
            ).trim(),

          quantity:
            roundQuantity(
              item.quantity
            ),

          unitPrice:
            roundMoney(
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
        })),
      });
    };

    return (
      createSignature(
        currentInvoice
      ) !==
      createSignature(
        nextInvoice
      )
    );
  };

export const commitInvoiceInventory =
  (invoice) => {
    if (
      invoice.inventoryCommitted
    ) {
      return {
        inventoryCommitted:
          true,

        inventoryCommittedAt:
          invoice.inventoryCommittedAt ||
          new Date().toISOString(),

        inventoryCommitments:
          invoice.inventoryCommitments ||
          [],

        inventoryMovementIds:
          invoice.inventoryMovementIds ||
          [],
      };
    }

    const requirements =
      getRequirements(
        invoice.items || []
      );

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
      };
    }

    requirements.forEach(
      (requirement) => {
        const product =
          getProductById(
            requirement.productId
          );

        const available =
          Number(
            product?.quantityOnHand
          ) || 0;

        if (
          requirement.quantity >
          available + 0.0005
        ) {
          throw new Error(
            `${requirement.productName} requires ${requirement.quantity}, but only ${available} is available.`
          );
        }
      }
    );

    const previousAdjustments =
      readAdjustments();

    const snapshots = [];
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

          const quantityBefore =
            roundQuantity(
              product.quantityOnHand
            );

          const quantityAfter =
            roundQuantity(
              quantityBefore -
                requirement.quantity
            );

          const movementId =
            createId();

          snapshots.push({
            productId:
              requirement.productId,

            quantityBefore,
          });

          setProductStockQuantity(
            requirement.productId,
            quantityAfter,
            {
              allowArchived:
                true,
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
              normaliseInvoiceDate(
                invoice.issueDate
              ),

            adjustmentType:
              "Decrease",

            reason:
              "Invoice sale",

            enteredQuantity:
              requirement.quantity,

            quantityChange:
              roundQuantity(
                -requirement.quantity
              ),

            quantityBefore,
            quantityAfter,

            unitCost:
              requirement.unitCost,

            valueImpact:
              roundMoney(
                -requirement.quantity *
                  requirement.unitCost
              ),

            reference:
              invoice.invoiceNumber ||
              "",

            notes:
              `Stock issued for invoice ${
                invoice.invoiceNumber ||
                invoice.id
              }${
                invoice.customer
                  ? ` to ${invoice.customer}`
                  : ""
              }.`,

            adjustedBy:
              "System",

            sourceType:
              "Invoice",

            sourceId:
              invoice.id,

            sourceNumber:
              invoice.invoiceNumber ||
              "",

            sourceAction:
              "Stock issued",

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
      };
    } catch (error) {
      rollbackProducts(
        snapshots
      );

      saveAdjustments(
        previousAdjustments
      );

      throw error;
    }
  };

export const restoreInvoiceInventory =
  (
    invoice,
    restorationReason =
      "Invoice reversal"
  ) => {
    if (
      !invoice.inventoryCommitted
    ) {
      return {
        inventoryCommitted:
          false,

        inventoryRestoredAt:
          invoice.inventoryRestoredAt ||
          null,

        inventoryReversalMovementIds:
          invoice.inventoryReversalMovementIds ||
          [],
      };
    }

    const commitments =
      Array.isArray(
        invoice.inventoryCommitments
      )
        ? invoice.inventoryCommitments
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
        if (
          !getProductById(
            commitment.productId
          )
        ) {
          throw new Error(
            `${
              commitment.productName ||
              "An inventory product"
            } could not be found, so stock could not be restored.`
          );
        }
      }
    );

    const previousAdjustments =
      readAdjustments();

    const snapshots = [];
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
              commitment.quantity
            );

          const quantityAfter =
            roundQuantity(
              quantityBefore +
                quantityChange
            );

          const reversalId =
            createId();

          const unitCost =
            roundMoney(
              commitment.unitCost ??
                product.purchaseCost
            );

          snapshots.push({
            productId:
              commitment.productId,

            quantityBefore,
          });

          setProductStockQuantity(
            commitment.productId,
            quantityAfter,
            {
              allowArchived:
                true,
            }
          );

          reversals.push({
            id:
              reversalId,

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
              new Date()
                .toISOString()
                .slice(0, 10),

            adjustmentType:
              "Increase",

            reason:
              "Invoice reversal",

            enteredQuantity:
              quantityChange,

            quantityChange,

            quantityBefore,
            quantityAfter,

            unitCost,

            valueImpact:
              roundMoney(
                quantityChange *
                  unitCost
              ),

            reference:
              invoice.invoiceNumber ||
              "",

            notes:
              `Stock restored from invoice ${
                invoice.invoiceNumber ||
                invoice.id
              }. Reason: ${restorationReason}.`,

            adjustedBy:
              "System",

            sourceType:
              "Invoice",

            sourceId:
              invoice.id,

            sourceNumber:
              invoice.invoiceNumber ||
              "",

            sourceAction:
              "Stock restored",

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

            return reversalMovementId
              ? {
                  ...adjustment,

                  reversedAt:
                    now.toISOString(),

                  reversalMovementId,
                }
              : adjustment;
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
        snapshots
      );

      saveAdjustments(
        previousAdjustments
      );

      throw error;
    }
  };