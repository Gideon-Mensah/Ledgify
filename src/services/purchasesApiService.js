// Load and update supplier bills through the backend instead of browser-stored financial data.

import { api } from "./api";
import { statusLabel, toDateInput, toDisplayDate } from "./domainMappings";

export function mapBill(bill) {
  return {
    id: bill.id,
    billNumber: bill.bill_number,
    supplierReference: bill.supplier_reference || "",
    supplierId: bill.supplier?.id,
    supplier: bill.supplier?.name || "",
    supplierName: bill.supplier?.name || "",
    issueDate: toDisplayDate(bill.issue_date),
    dueDate: toDisplayDate(bill.due_date),
    issueDateIso: bill.issue_date,
    dueDateIso: bill.due_date,
    currency: bill.currency,
    notes: bill.notes || "",
    subtotal: bill.subtotal,
    taxTotal: bill.tax_total,
    total: bill.total,
    amountPaid: bill.amount_paid,
    amountDue: bill.amount_due,
    amountCredited: bill.amount_credited,
    status: statusLabel(bill.status),
    backendStatus: bill.status,
    approvedAt: bill.approved_at,
    accountingJournal: bill.accounting_journal,
    payments: [],
    items: (bill.lines || []).map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      discountAmount: line.discount_amount,
      discountRate: 0,
      vatRate: line.tax_rate,
      taxRateId: line.tax_rate_id || null,
      taxAmount: line.tax_amount,
      lineTotal: line.line_total,
      expenseAccountId: line.expense_account?.id,
      accountCode: line.expense_account?.code || "",
      accountName: line.expense_account?.name || "",
    })),
  };
}

export const purchasesApiService = {
  async list(params = "") {
    const data = await api.get(`bills/${params ? `?${params}` : ""}`);
    return data.map(mapBill);
  },
  async get(id) {
    const [bill, payments] = await Promise.all([
      api.get(`bills/${id}/`),
      api.get(`supplier-payments/?bill=${encodeURIComponent(id)}`),
    ]);
    const mapped = mapBill(bill);
    mapped.payments = payments.map((payment) => ({
      id: payment.id,
      paymentDate: payment.payment_date,
      amount: payment.amount,
      reference: payment.reference || "",
      status: payment.status,
      paymentMethod: "Supplier payment",
      bankAccountName: payment.bank_account?.name || payment.bank_account?.code || "",
      accountingJournal: payment.accounting_journal,
    }));
    return mapped;
  },
  async create(data) {
    const payload = {
      bill_number: data.billNumber,
      supplier_reference: data.supplierReference || "",
      supplier_id: data.supplierId,
      issue_date: toDateInput(data.issueDate),
      due_date: toDateInput(data.dueDate),
      currency: data.currency || "GBP",
      notes: data.notes || "",
      lines: data.items.map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        unit_price: String(item.unitPrice),
        discount_amount: String(item.discountAmount || 0),
        tax_rate: String(item.taxRateId ? (item.vatRate || 0) : 0),
        tax_rate_id: item.taxRateId || null,
        tax_inclusive: data.pricingMode === "inclusive",
        expense_account_id: item.expenseAccountId || item.accountId,
      })),
    };
    let bill = await api.post("bills/", payload);
    if (data.approve) bill = await api.post(`bills/${bill.id}/approve/`, {});
    return mapBill(bill);
  },
  async approve(id) {
    return mapBill(await api.post(`bills/${id}/approve/`, {}));
  },
  async update(id, data) {
    const payload = {
      bill_number: data.billNumber,
      supplier_reference: data.supplierReference || "",
      supplier_id: data.supplierId,
      issue_date: toDateInput(data.issueDate),
      due_date: toDateInput(data.dueDate),
      currency: data.currency || "GBP",
      notes: data.notes || "",
      lines: data.items.map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        unit_price: String(item.unitPrice),
        discount_amount: String(item.discountAmount || 0),
        tax_rate: String(item.taxRateId ? (item.vatRate || 0) : 0),
        tax_rate_id: item.taxRateId || null,
        tax_inclusive: data.pricingMode === "inclusive",
        expense_account_id: item.expenseAccountId || item.accountId,
      })),
    };
    return mapBill(await api.patch(`bills/${id}/`, payload));
  },
  async duplicate(id) {
    const source = await this.get(id);
    const today = new Date();
    const issueDate = today.toISOString().slice(0, 10);
    const oldIssue = new Date(`${source.issueDateIso}T00:00:00`);
    const oldDue = new Date(`${source.dueDateIso}T00:00:00`);
    const termsDays = Number.isNaN(oldIssue.getTime()) || Number.isNaN(oldDue.getTime())
      ? 0
      : Math.max(0, Math.round((oldDue - oldIssue) / 86400000));
    const due = new Date(`${issueDate}T00:00:00`);
    due.setDate(due.getDate() + termsDays);
    const copyNumber = `${source.billNumber.slice(0, 34)}-COPY-${Date.now().toString(36).toUpperCase()}`;
    return this.create({
      ...source,
      billNumber: copyNumber.slice(0, 50),
      supplierReference: "",
      issueDate,
      dueDate: due.toISOString().slice(0, 10),
      pricingMode: "exclusive",
      approve: false,
    });
  },
  async remove(id) {
    await api.delete(`bills/${id}/`);
  },
  async recordPayment(bill, payment) {
    await api.post("supplier-payments/", {
      supplier_id: bill.supplierId,
      bill_id: bill.id,
      bank_account_id: payment.bankAccountId,
      payment_date: payment.paymentDate,
      amount: String(payment.amount),
      currency: bill.currency,
      reference: payment.reference || bill.billNumber,
      notes: payment.notes || "",
    });
    return this.get(bill.id);
  },
};
