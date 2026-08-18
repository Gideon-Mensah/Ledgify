// Calculates bill totals.
export const calculateBillTotals = (
  bill
) => {
  return (bill?.items || []).reduce(
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
        bill?.pricingMode ===
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

// Gets bill paid amount.
export const getBillPaidAmount = (
  bill
) => {
  if (
    Number.isFinite(
      Number(bill?.amountPaid)
    )
  ) {
    return Math.max(
      Number(bill.amountPaid),
      0
    );
  }

  return (bill?.payments || []).reduce(
    (total, payment) =>
      total +
      (Number(payment.amount) || 0),
    0
  );
};

// Gets bill balance.
export const getBillBalance = (
  bill
) => {
  const totals =
    calculateBillTotals(bill);

  const amountPaid =
    Math.min(
      getBillPaidAmount(bill),
      totals.total
    );

  return {
    ...totals,
    amountPaid,
    outstanding: Math.max(
      totals.total - amountPaid,
      0
    ),
  };
};