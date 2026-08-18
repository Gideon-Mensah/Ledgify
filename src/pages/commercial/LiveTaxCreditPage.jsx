import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileMinus2, Info, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import { api } from "../../services/api";
import { accountingApiService } from "../../services/accountingApiService";
import { commercialService } from "../../services/commercialService";
import { contactApiService } from "../../services/contactApiService";
import { taxApiService } from "../../services/taxApiService";
import { normaliseApiError } from "../../services/apiError";
import "../../styles/creditNoteForm.css";

const today = () => new Date().toISOString().slice(0, 10);
const blankLine = () => ({ id: crypto.randomUUID(), source_line_id: null, description: "", quantity: "1", unit_price: "0",
  discount_amount: "0", tax_rate_id: "", tax_rate: "0", account_id: "" });

export default function LiveTaxCreditPage({ supplier = false }) {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]); const [sources, setSources] = useState([]);
  const [accounts, setAccounts] = useState([]); const [rates, setRates] = useState([]);
  const [lines, setLines] = useState([blankLine()]); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({ number: `${supplier ? "SC" : "CN"}-${Date.now()}`,
    contact: "", source: "", issue_date: today(), currency: "GBP", reference: "", notes: "", inclusive: false }));
  useEffect(() => { Promise.all([
    supplier ? contactApiService.suppliers() : contactApiService.customers(),
    api.get(supplier ? "bills/" : "invoices/"),
    accountingApiService.accounts({ account_type: supplier ? "expense" : "revenue", status: "active" }),
    taxApiService.rates(),
  ]).then(([nextContacts, nextSources, nextAccounts, nextRates]) => {
    setContacts(nextContacts); setSources(nextSources); setAccounts(nextAccounts);
    setRates(nextRates.filter((rate) => rate.status === "ACTIVE" && [supplier ? "PURCHASES" : "SALES", "BOTH"].includes(rate.scope)));
  }).catch((requestError) => setError(normaliseApiError(requestError))); }, [supplier]);
  const eligibleRates = useMemo(() => rates.filter((rate) => rate.effective_from <= form.issue_date
    && (!rate.effective_to || rate.effective_to >= form.issue_date)), [rates, form.issue_date]);
  const previewTotals = useMemo(() => lines.reduce((totals, line) => {
    const net = Math.max(0, Number(line.quantity || 0) * Number(line.unit_price || 0) - Number(line.discount_amount || 0));
    const tax = form.inclusive ? net - (net / (1 + Number(line.tax_rate || 0) / 100)) : net * Number(line.tax_rate || 0) / 100;
    return { subtotal: totals.subtotal + (form.inclusive ? net - tax : net), tax: totals.tax + tax, total: totals.total + (form.inclusive ? net : net + tax) };
  }, { subtotal: 0, tax: 0, total: 0 }), [form.inclusive, lines]);
  const chooseSource = async (id) => {
    setForm((current) => ({ ...current, source: id })); if (!id) return;
    try {
      const source = await api.get(`${supplier ? "bills" : "invoices"}/${id}/`);
      setForm((current) => ({ ...current, contact: supplier ? source.supplier.id : source.customer.id, currency: source.currency }));
      setLines(source.lines.map((line) => ({ id: crypto.randomUUID(), source_line_id: line.id, description: line.description,
        quantity: line.quantity, unit_price: line.unit_price, discount_amount: line.discount_amount,
        tax_rate_id: line.tax_rate_id || "", tax_rate: line.tax_rate,
        account_id: supplier ? line.expense_account.id : line.revenue_account.id })));
    } catch (requestError) { setError(normaliseApiError(requestError)); }
  };
  const changeLine = (id, field, value) => setLines((current) => current.map((line) => {
    if (line.id !== id) return line; const next = { ...line, [field]: value };
    if (field === "tax_rate_id") next.tax_rate = eligibleRates.find((rate) => rate.id === value)?.rate || "0";
    return next;
  }));
  const submit = async (event) => {
    event.preventDefault(); setError(""); setSaving(true);
    const payload = { [supplier ? "credit_number" : "credit_note_number"]: form.number,
      [supplier ? "supplier_id" : "customer_id"]: form.contact,
      [supplier ? "bill_id" : "invoice_id"]: form.source || null, issue_date: form.issue_date,
      currency: form.currency, reference: form.reference, notes: form.notes,
      lines: lines.map((line) => ({ source_line_id: line.source_line_id || undefined, description: line.description, quantity: line.quantity,
        unit_price: line.unit_price, discount_amount: line.discount_amount, tax_rate: line.tax_rate,
        tax_rate_id: line.tax_rate_id || null, tax_inclusive: form.inclusive,
        [supplier ? "expense_account_id" : "revenue_account_id"]: line.account_id })) };
    try {
      const result = supplier ? await commercialService.createSupplierCredit(payload) : await commercialService.createCustomerCredit(payload);
      navigate(supplier ? `/purchases/supplier-credits/${result.id}` : `/sales/credit-notes/${result.id}`);
    } catch (requestError) { setError(normaliseApiError(requestError)); setSaving(false); }
  };
  const base = supplier ? "/purchases/supplier-credits" : "/sales/credit-notes";
  const formatMoney = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: form.currency || "GBP" }).format(Number(value || 0));
  return <div className="credit-note-form-page"><PageHeader eyebrow={supplier ? "Purchases" : "Sales"}
    title={supplier ? "New supplier credit" : "New customer credit note"}
    description={supplier ? "Record a supplier credit while preserving the original bill and tax treatment." : "Reduce or reverse an invoice with a controlled, auditable customer credit."}
    action={<Link className="invoice-secondary-button" to={base}><ArrowLeft size={16} />Back to credits</Link>} />
    {error && <div className="invoice-form-alert" role="alert">{error}</div>}
    <form className="credit-note-form" onSubmit={submit}><section className="credit-note-form-card"><header><span><FileMinus2 size={20} /></span><div><h2>Credit details</h2><p>Identify the party and, where possible, connect the credit to its original document.</p></div></header><div className="credit-note-form-grid">
      <label>Credit number<input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>
      <label>{supplier ? "Supplier" : "Customer"}<select required value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}><option value="">Select {supplier ? "supplier" : "customer"}</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
      <label>Original {supplier ? "bill" : "invoice"}<select value={form.source} onChange={(e) => void chooseSource(e.target.value)}><option value="">Standalone credit</option>{sources.map((source) => <option key={source.id} value={source.id}>{supplier ? source.bill_number : source.invoice_number}</option>)}</select><small>Selecting a document copies its party, currency and lines.</small></label>
      <label>Issue date<input required type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></label>
      <label>Currency<input required maxLength="3" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
      <label>Reference<input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional external reference" /></label>
      <label className="credit-note-notes">Internal notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reason for the credit or internal context" /></label>
      <label className="credit-note-tax-toggle"><input type="checkbox" checked={form.inclusive} onChange={(e) => setForm({ ...form, inclusive: e.target.checked })} /><span><strong>Prices include tax</strong><small>Line prices will be treated as tax inclusive.</small></span></label>
    </div></section><section className="credit-note-form-card"><header className="credit-note-lines-heading"><span><FileMinus2 size={20} /></span><div><h2>Credit lines</h2><p>Enter only the quantities and values being credited.</p></div><button type="button" className="invoice-secondary-button" onClick={() => setLines([...lines, blankLine()])}><Plus size={15} />Add line</button></header><div className="credit-note-entry-table"><div className="credit-note-entry-head"><span>Description</span><span>Quantity</span><span>Unit price</span><span>Discount</span><span>Tax rate</span><span>Account</span><span /></div>{lines.map((line, index) => <div className="credit-note-entry-row" key={line.id}>
      <label><span>Description</span><input required value={line.description} onChange={(e) => changeLine(line.id, "description", e.target.value)} placeholder={`Credit line ${index + 1}`} />{line.source_line_id && <small>Copied from original document</small>}</label>
      <label><span>Quantity</span><input required min="0.0001" step="0.0001" type="number" value={line.quantity} onChange={(e) => changeLine(line.id, "quantity", e.target.value)} /></label>
      <label><span>Unit price</span><input required min="0" step="0.0001" type="number" value={line.unit_price} onChange={(e) => changeLine(line.id, "unit_price", e.target.value)} /></label>
      <label><span>Discount</span><input min="0" step="0.01" type="number" value={line.discount_amount} onChange={(e) => changeLine(line.id, "discount_amount", e.target.value)} /></label>
      <label><span>Tax rate</span><select value={line.tax_rate_id} onChange={(e) => changeLine(line.id, "tax_rate_id", e.target.value)}><option value="">No tax</option>{eligibleRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.code} · {rate.rate}%</option>)}</select></label>
      <label><span>Account</span><select required value={line.account_id} onChange={(e) => changeLine(line.id, "account_id", e.target.value)}><option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
      <button type="button" className="credit-note-remove-line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} aria-label={`Remove credit line ${index + 1}`}><Trash2 size={16} /></button>
    </div>)}</div></section><div className="credit-note-form-bottom"><aside><Info size={17} /><p>The preview is for review only. Final tax and totals are calculated and validated by Ledgify when the draft is saved.</p></aside><section className="credit-note-preview-totals"><div><span>Subtotal</span><strong>{formatMoney(previewTotals.subtotal)}</strong></div><div><span>Tax</span><strong>{formatMoney(previewTotals.tax)}</strong></div><div><span>Draft total</span><strong>{formatMoney(previewTotals.total)}</strong></div></section></div><footer className="credit-note-form-actions"><Link className="invoice-secondary-button" to={base}>Cancel</Link><button disabled={saving} className="page-primary-button" type="submit">{saving ? "Saving draft…" : "Save credit note draft"}</button></footer></form>
  </div>;
}
