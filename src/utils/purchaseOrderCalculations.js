// Calculates purchase order totals.
export const calculatePurchaseOrderTotals = (
  purchaseOrder
) => {
  return (
    purchaseOrder?.items || []
  ).reduce(
    (totals, item) => {
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
        grossAmount -
        discountAmount;

      let netAmount =
        discountedAmount;

      let vatAmount =
        discountedAmount *
        (vatRate / 100);

      let total =
        netAmount + vatAmount;

      if (
        purchaseOrder?.pricingMode ===
        "inclusive"
      ) {
        netAmount =
          vatRate > 0
            ? discountedAmount /
              (1 + vatRate / 100)
            : discountedAmount;

        vatAmount =
          discountedAmount -
          netAmount;

        total =
          discountedAmount;
      }

      totals.subtotal +=
        netAmount;

      totals.discount +=
        discountAmount;

      totals.vat += vatAmount;
      totals.total += total;

      return totals;
    },
    {
      subtotal: 0,
      discount: 0,
      vat: 0,
      total: 0,
    }
  );
};

// Gets purchase order receipt summary.
export const getPurchaseOrderReceiptSummary =
  (purchaseOrder) => {
    const items =
      purchaseOrder?.items || [];

    const totalOrdered =
      items.reduce(
        (total, item) =>
          total +
          (Number(item.quantity) || 0),
        0
      );

    const totalReceived =
      items.reduce(
        (total, item) =>
          total +
          Math.min(
            Number(
              item.quantityReceived
            ) || 0,
            Number(item.quantity) || 0
          ),
        0
      );

    const remaining = Math.max(
      totalOrdered - totalReceived,
      0
    );

    let receiptStatus =
      "Not received";

    if (
      totalOrdered > 0 &&
      remaining <= 0.005
    ) {
      receiptStatus =
        "Fully received";
    } else if (
      totalReceived > 0
    ) {
      receiptStatus =
        "Partially received";
    }

    return {
      totalOrdered,
      totalReceived,
      remaining,
      receiptStatus,
    };
  };