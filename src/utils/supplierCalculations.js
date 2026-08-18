import {
  getBillBalance,
} from "./billCalculations";

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Gets supplier bills.
export const getSupplierBills = (
  supplier,
  bills = []
) => {
  if (!supplier) {
    return [];
  }

  return bills.filter((bill) => {
    const hasSupplierId =
      bill.supplierId !== undefined &&
      bill.supplierId !== null &&
      bill.supplierId !== "";

    if (hasSupplierId) {
      return (
        Number(bill.supplierId) ===
        Number(supplier.id)
      );
    }

    return (
      normaliseText(bill.supplier) ===
      normaliseText(supplier.name)
    );
  });
};

// Gets supplier summary.
export const getSupplierSummary = (
  supplier,
  bills = []
) => {
  const supplierBills =
    getSupplierBills(
      supplier,
      bills
    );

  return supplierBills.reduce(
    (summary, bill) => {
      const balance =
        getBillBalance(bill);

      summary.billCount += 1;

      if (bill.status === "Draft") {
        summary.draftCount += 1;
      }

      if (bill.status === "Voided") {
        return summary;
      }

      summary.totalPurchases +=
        balance.total;

      summary.amountPaid +=
        balance.amountPaid;

      summary.outstanding +=
        balance.outstanding;

      if (bill.status === "Overdue") {
        summary.overdue +=
          balance.outstanding;
      }

      return summary;
    },
    {
      billCount: 0,
      draftCount: 0,
      totalPurchases: 0,
      amountPaid: 0,
      outstanding: 0,
      overdue: 0,
    }
  );
};

// Gets all supplier summaries.
export const getAllSupplierSummaries = (
  suppliers = [],
  bills = []
) => {
  return suppliers.map(
    (supplier) => ({
      ...supplier,
      summary:
        getSupplierSummary(
          supplier,
          bills
        ),
    })
  );
};