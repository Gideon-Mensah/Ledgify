// Calculates document totals.
export const calculateDocumentTotals = (
  document
) => {
  return (document?.items || []).reduce(
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
        grossAmount - discountAmount;

      let netAmount = discountedAmount;
      let vatAmount =
        discountedAmount *
        (vatRate / 100);

      let total =
        netAmount + vatAmount;

      if (
        document?.pricingMode ===
        "inclusive"
      ) {
        netAmount =
          vatRate > 0
            ? discountedAmount /
              (1 + vatRate / 100)
            : discountedAmount;

        vatAmount =
          discountedAmount - netAmount;

        total = discountedAmount;
      }

      totals.subtotal += netAmount;
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

// Gets invoice paid amount.
export const getInvoicePaidAmount = (
  invoice
) => {
  if (
    Number.isFinite(
      Number(invoice?.amountPaid)
    )
  ) {
    return Math.max(
      Number(invoice.amountPaid),
      0
    );
  }

  return (invoice?.payments || []).reduce(
    (total, payment) =>
      total +
      (Number(payment.amount) || 0),
    0
  );
};

// Gets invoice applied credits.
export const getInvoiceAppliedCredits = (
  invoiceId,
  creditNotes
) => {
  return (creditNotes || []).reduce(
    (total, creditNote) => {
      if (
        creditNote.status === "Draft" ||
        creditNote.status === "Voided"
      ) {
        return total;
      }

      const applicationTotal = (
        creditNote.applications || []
      ).reduce(
        (
          applicationSummary,
          application
        ) => {
          if (
            Number(
              application.invoiceId
            ) !== Number(invoiceId)
          ) {
            return applicationSummary;
          }

          return (
            applicationSummary +
            (Number(
              application.amount
            ) || 0)
          );
        },
        0
      );

      return total + applicationTotal;
    },
    0
  );
};

// Gets invoice credit balance.
export const getInvoiceCreditBalance = (
  invoice,
  creditNotes
) => {
  const invoiceTotals =
    calculateDocumentTotals(invoice);

  const paidAmount =
    getInvoicePaidAmount(invoice);

  const appliedCredits =
    getInvoiceAppliedCredits(
      invoice?.id,
      creditNotes
    );

  const outstandingBalance = Math.max(
    invoiceTotals.total -
      paidAmount -
      appliedCredits,
    0
  );

  return {
    invoiceTotal: invoiceTotals.total,
    paidAmount,
    appliedCredits,
    outstandingBalance,
  };
};