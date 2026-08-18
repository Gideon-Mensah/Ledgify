// Convert invoice form data into the writable IDs expected by the sales API.

import { api } from "./api";
import { statusLabel, toDateInput, toDisplayDate } from "./domainMappings";

export function mapInvoice(invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    customerId: invoice.customer?.id,
    customer: invoice.customer?.name || "",
    customerEmail: invoice.customer?.email || "",
    issueDate: toDisplayDate(invoice.issue_date),
    dueDate: toDisplayDate(invoice.due_date),
    issueDateIso: invoice.issue_date,
    dueDateIso: invoice.due_date,
    currency: invoice.currency,
    reference: invoice.reference || "",
    notes: invoice.notes || "",
    subtotal: invoice.subtotal,
    taxTotal: invoice.tax_total,
    total: invoice.total,
    amountPaid: invoice.amount_paid,
    amountDue: invoice.amount_due,
    amountCredited: invoice.amount_credited,
    status: statusLabel(invoice.status),
    backendStatus: invoice.status,
    approvedAt: invoice.approved_at,
    payments: invoice.payments || [],
    items: (invoice.lines || []).map((line) => ({
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
      revenueAccountId: line.revenue_account?.id,
      salesAccount: line.revenue_account?.name || "",
    })),
  };
}

export const salesApiService = {
  async list(params = "") {
    const data = await api.get(`invoices/${params ? `?${params}` : ""}`);
    return data.map(mapInvoice);
  },
  async get(id) {
    const [invoice, payments] = await Promise.all([
      api.get(`invoices/${id}/`),
      api.get(`customer-payments/?invoice=${encodeURIComponent(id)}`),
    ]);
    const paymentRows = (Array.isArray(payments) ? payments : payments.results || []).map((payment) => ({
      ...payment, paymentDate: payment.payment_date, paymentMethod: "Payment", bankAccountName: payment.bank_account?.name,
      accountingJournal: payment.accounting_journal, reference: payment.reference, amount: payment.amount,
    }));
    return mapInvoice({ ...invoice, payments: paymentRows });
  },
  async update(id, data) {
    const payload = {
      invoice_number: data.invoiceNumber,
      customer_id: data.customerId,
      issue_date: toDateInput(data.issueDate),
      due_date: toDateInput(data.dueDate),
      currency: data.currency,
      reference: data.reference || "",
      notes: data.notes || "",
      lines: data.items.map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        unit_price: String(item.unitPrice),
        discount_amount: String(item.discountAmount || 0),
        tax_rate: String(item.taxRateId ? (item.vatRate || 0) : 0),
        tax_rate_id: item.taxRateId || null,
        tax_inclusive: data.pricingMode === "inclusive",
        revenue_account_id: item.revenueAccountId,
      })),
    };
    return mapInvoice(await api.patch(`invoices/${id}/`, payload));
  },
  async create(data) {
    const payload = {
      invoice_number: data.invoiceNumber,
      customer_id: data.customerId,
      issue_date: toDateInput(data.issueDate),
      due_date: toDateInput(data.dueDate),
      currency: data.currency || "GBP",
      reference: data.reference || "",
      notes: data.notes || "",
      lines: data.items.map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        unit_price: String(item.unitPrice),
        discount_amount: String(item.discountAmount || 0),
        tax_rate: String(item.taxRateId ? (item.vatRate || 0) : 0),
        tax_rate_id: item.taxRateId || null,
        tax_inclusive: data.pricingMode === "inclusive",
        revenue_account_id: item.revenueAccountId || item.accountId,
      })),
    };
    let invoice = await api.post("invoices/", payload);
    if (data.approve) invoice = await api.post(`invoices/${invoice.id}/approve/`, {});
    return mapInvoice(invoice);
  },
  async approve(id) {
    return mapInvoice(await api.post(`invoices/${id}/approve/`, {}));
  },
  async remove(id) {
    await api.delete(`invoices/${id}/`);
  },
  async duplicate(id) {
    const source = await this.get(id);
    return this.create({
      ...source,
      invoiceNumber: `${source.invoiceNumber}-COPY`,
      items: source.items,
    });
  },
  async recordPayment(invoice, payment) {
    await api.post("customer-payments/", {
      customer_id: invoice.customerId,
      invoice_id: invoice.id,
      bank_account_id: payment.bankAccountId,
      payment_date: payment.paymentDate,
      amount: String(payment.amount),
      currency: invoice.currency,
      reference: payment.reference || invoice.invoiceNumber,
      notes: payment.notes || "",
    });
    return this.get(invoice.id);
  },
};
