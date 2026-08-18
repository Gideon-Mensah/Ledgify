const positiveDecimal = (value) => /^\+?0*[1-9]\d*(?:\.\d+)?$/.test(String(value ?? "").trim()) ||
  /^\+?0*\.\d*[1-9]\d*$/.test(String(value ?? "").trim());

export const canEditBill = (bill, hasPermission) =>
  bill?.backendStatus === "draft" && hasPermission("create_bill");

export const canDeleteBill = canEditBill;

export const canDuplicateBill = (_bill, hasPermission) => hasPermission("create_bill");

export const canRecordBillPayment = (bill, hasPermission) =>
  ["approved", "partly_paid"].includes(bill?.backendStatus) &&
  positiveDecimal(bill?.amountDue) &&
  hasPermission("create_supplier_payment");
// Mirror backend bill status rules so the UI does not offer predictably invalid actions.

