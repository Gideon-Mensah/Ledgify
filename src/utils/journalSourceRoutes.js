// Link journal sources back to the business document that created the accounting entry.

const labels = {
  manual: "Manual journal", invoice: "Sales invoice", bill: "Supplier bill", payment: "Payment",
  bank: "Bank transaction", adjustment: "Adjustment", customer_credit: "Customer credit note",
  supplier_credit: "Supplier credit", customer_refund: "Customer refund", bad_debt: "Bad debt write-off",
  supplier_refund: "Supplier refund", bank_transfer: "Bank transfer", year_end_close: "Year-end close",
  inventory_adjustment: "Inventory adjustment", inventory_receipt: "Inventory receipt", inventory_issue: "Inventory issue",
  customer_return: "Customer return", supplier_return: "Supplier return", stock_count: "Stock count",
  fixed_asset_acquisition: "Fixed asset acquisition", depreciation: "Depreciation", fixed_asset_disposal: "Fixed asset disposal",
  payroll: "Payroll", payroll_payment: "Payroll payment", fx_revaluation: "FX revaluation", fx_realised: "Realised FX",
  manufacturing_material_issue: "Manufacturing material issue", manufacturing_completion: "Manufacturing completion",
  manufacturing_cost: "Manufacturing cost", manufacturing_variance: "Manufacturing variance",
};

export const journalSourceLabel = (type) => labels[type] || String(type || "Unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function getJournalSourceRoute(type, id) {
  if (!id) return null;
  if (type === "invoice") return `/sales/invoices/${id}`;
  if (type === "bill") return `/purchases/bills/${id}`;
  if (["customer_credit"].includes(type)) return `/sales/credit-notes/${id}`;
  if (["supplier_credit"].includes(type)) return `/purchases/supplier-credits/${id}`;
  if (["fixed_asset_acquisition", "fixed_asset_disposal"].includes(type)) return `/fixed-assets/${id}`;
  if (["manufacturing_material_issue", "manufacturing_completion", "manufacturing_cost", "manufacturing_variance"].includes(type)) return `/manufacturing/production-orders/${id}`;
  return null;
}
