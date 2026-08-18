import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, CheckCircle2, CircleDollarSign, FileText, Landmark, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";

import Modal from "../common/Modal";
import TablePagination from "../common/TablePagination";
import PageHeader from "../layout/PageHeader";
import { useTablePagination } from "../../hooks/useTablePagination";
import { normaliseApiError } from "../../services/apiError";
import { bankService } from "../../services/bankService";
import { useAuth } from "../../store/AuthContext";
import "../../styles/bankTransactions.css";

const today = () => new Date().toISOString().slice(0, 10);
const list = (value) => Array.isArray(value) ? value : value?.results || [];
const humanise = (value) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateOnly = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—";
const money = (value, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));

export default function BankingTransactionsWorkspace() {
  const auth = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ status: "", type: "", bank_account: "", date_from: "", date_to: "" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [state, setState] = useState({ loading: true, saving: false, error: "", success: "" });
  const [form, setForm] = useState({ bank_account_id: "", transaction_date: today(), description: "", reference: "", transaction_type: "money_in", amount: "" });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const [bankRows, transactions] = await Promise.all([bankService.accounts(), bankService.transactions(filters)]);
      setAccounts(list(bankRows));
      setRows(list(transactions));
      setState((current) => ({ ...current, loading: false }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: normaliseApiError(error) }));
    }
  }, [filters]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setState((current) => ({ ...current, saving: true, error: "", success: "" }));
    const account = accounts.find((item) => item.id === form.bank_account_id);
    try {
      await bankService.createTransaction({ ...form, currency: account?.currency, external_id: "" });
      setForm((current) => ({ ...current, description: "", reference: "", amount: "" }));
      setShowForm(false);
      await load();
      setState((current) => ({ ...current, saving: false, success: "Bank transaction added to the reconciliation queue." }));
    } catch (error) {
      setState((current) => ({ ...current, saving: false, error: normaliseApiError(error) }));
    }
  };

  const visible = useMemo(() => rows.filter((row) => !search.trim() || [row.description, row.reference, row.external_id, row.bank_account?.name, row.amount].some((value) => String(value || "").toLowerCase().includes(search.toLowerCase()))), [rows, search]);
  const pagination = useTablePagination(visible);
  const totals = useMemo(() => visible.reduce((current, row) => ({
    moneyIn: current.moneyIn + (row.transaction_type === "money_in" ? Number(row.amount || 0) : 0),
    moneyOut: current.moneyOut + (row.transaction_type === "money_out" ? Number(row.amount || 0) : 0),
    unreconciled: current.unreconciled + (row.status === "unreconciled" ? 1 : 0),
  }), { moneyIn: 0, moneyOut: 0, unreconciled: 0 }), [visible]);
  const displayCurrency = accounts.find((account) => account.id === filters.bank_account)?.currency || auth.selectedOrganisation?.base_currency || "GBP";
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => { setFilters({ status: "", type: "", bank_account: "", date_from: "", date_to: "" }); setSearch(""); };

  return <div className="bank-transactions-workspace">
    <PageHeader eyebrow="Banking" title="Bank transactions" description="Review imported and manually entered bank activity before matching it to Ledgify accounting records." action={auth.hasPermission("manage_bank_transactions") && <button type="button" className="page-primary-button" onClick={() => setShowForm((value) => !value)}><Plus size={17} />{showForm ? "Close form" : "Add transaction"}</button>} />

    {state.error && <div className="invoice-form-alert" role="alert">{state.error}</div>}
    {state.success && <div className="bank-page-success" role="status">{state.success}</div>}

    <section className="bank-transaction-summary-grid" aria-label="Transaction summary"><Summary icon={<FileText size={20} />} label="Transactions" value={visible.length} help="In the current view" /><Summary icon={<ArrowDownLeft size={20} />} label="Money in" value={money(totals.moneyIn, displayCurrency)} help="Statement receipts" tone="in" /><Summary icon={<ArrowUpRight size={20} />} label="Money out" value={money(totals.moneyOut, displayCurrency)} help="Statement payments" tone="out" /><Summary icon={<CircleDollarSign size={20} />} label="Unreconciled" value={totals.unreconciled} help="Still requiring review" tone={totals.unreconciled ? "warning" : "good"} /></section>

    {showForm && auth.hasPermission("manage_bank_transactions") && <form className="bank-transaction-create" onSubmit={create}><header><span><Plus size={19} /></span><div><h2>Add bank transaction</h2><p>Enter statement activity only. Accounting is created later when the item is coded or matched.</p></div></header><div className="bank-transaction-create-grid"><label>Bank account<select required value={form.bank_account_id} onChange={(event) => setForm({ ...form, bank_account_id: event.target.value })}><option value="">Select active account</option>{accounts.filter((account) => account.status === "active").map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Transaction date<input required max={today()} type="date" value={form.transaction_date} onChange={(event) => setForm({ ...form, transaction_date: event.target.value })} /></label><label>Direction<select value={form.transaction_type} onChange={(event) => setForm({ ...form, transaction_type: event.target.value })}><option value="money_in">Money in</option><option value="money_out">Money out</option></select></label><label>Amount<input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></label><label className="is-wide">Description<input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Statement description" /></label><label>Reference<input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="Optional bank reference" /></label></div><footer><button type="button" className="invoice-secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button disabled={state.saving} className="page-primary-button" type="submit">{state.saving ? "Adding…" : "Add transaction"}</button></footer></form>}

    <section className="bank-transaction-panel"><header className="bank-transaction-panel-heading"><div><h2>Transaction activity</h2><p>Filter statement activity, inspect its status, or continue to reconciliation.</p></div><Link className="invoice-secondary-button" to="/banking/reconciliation">Open reconciliation</Link></header><div className="bank-transaction-filters"><div className="bank-transaction-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search description, reference, account or amount" /></div><label>Account<select value={filters.bank_account} onChange={(event) => updateFilter("bank_account", event.target.value)}><option value="">All bank accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Status<select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">All statuses</option><option value="unreconciled">Unreconciled</option><option value="reconciled">Reconciled</option><option value="ignored">Ignored</option></select></label><label>Direction<select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}><option value="">Money in and out</option><option value="money_in">Money in</option><option value="money_out">Money out</option></select></label><label>From<input type="date" value={filters.date_from} onChange={(event) => updateFilter("date_from", event.target.value)} /></label><label>To<input type="date" value={filters.date_to} onChange={(event) => updateFilter("date_to", event.target.value)} /></label>{(activeFilters > 0 || search) && <button type="button" className="bank-transaction-clear" onClick={clearFilters}><SlidersHorizontal size={14} />Clear filters</button>}</div>

      {state.loading ? <div className="bank-transaction-loading"><span className="header-spinner" />Loading bank transactions…</div> : visible.length ? <><div className="bank-transaction-table-wrapper"><table><thead><tr><th>Date</th><th>Bank account</th><th>Description</th><th>Reference</th><th className="bank-transaction-number">Money in</th><th className="bank-transaction-number">Money out</th><th>Status</th><th>Action</th></tr></thead><tbody>{pagination.pageRows.map((row) => <tr key={row.id}><td><span className="bank-transaction-date"><CalendarDays size={14} />{dateOnly(row.transaction_date)}</span></td><td><strong>{row.bank_account?.name || "—"}</strong><small>{row.currency}</small></td><td><strong>{row.description}</strong></td><td>{row.reference || "—"}</td><td className="bank-transaction-number money-in-value">{row.transaction_type === "money_in" ? money(row.amount, row.currency) : "—"}</td><td className="bank-transaction-number money-out-value">{row.transaction_type === "money_out" ? money(row.amount, row.currency) : "—"}</td><td><span className={`bank-transaction-status is-${row.status}`}>{humanise(row.status)}</span></td><td><button type="button" className="invoice-secondary-button" onClick={() => setSelected(row)}>View details</button></td></tr>)}</tbody></table></div><TablePagination {...pagination} /></> : <div className="bank-transaction-empty"><CheckCircle2 size={28} /><h3>No transactions found</h3><p>{activeFilters || search ? "No bank activity matches the selected filters." : "Bank transactions will appear here after they are imported or entered."}</p>{activeFilters || search ? <button type="button" className="invoice-secondary-button" onClick={clearFilters}>Clear filters</button> : null}</div>}
    </section>

    <Modal isOpen={Boolean(selected)} title="Bank transaction details" description="Statement activity and its reconciliation trace." onClose={() => setSelected(null)}>{selected && <div className="bank-transaction-detail"><div className="bank-transaction-detail-hero"><span className={selected.transaction_type === "money_in" ? "is-in" : "is-out"}>{selected.transaction_type === "money_in" ? <ArrowDownLeft size={21} /> : <ArrowUpRight size={21} />}</span><div><small>{humanise(selected.transaction_type)}</small><strong>{money(selected.amount, selected.currency)}</strong><p>{selected.description}</p></div></div><dl><div><dt>Date</dt><dd>{dateOnly(selected.transaction_date)}</dd></div><div><dt>Bank account</dt><dd>{selected.bank_account?.name || "—"}</dd></div><div><dt>Reference</dt><dd>{selected.reference || "—"}</dd></div><div><dt>External ID</dt><dd>{selected.external_id || "—"}</dd></div><div><dt>Status</dt><dd><span className={`bank-transaction-status is-${selected.status}`}>{humanise(selected.status)}</span></dd></div><div><dt>Matched as</dt><dd>{humanise(selected.reconciliation_type || "Not reconciled")}</dd></div></dl>{selected.accounting_journal && <Link className="bank-transaction-journal-link" to={`/accounting/journals/${selected.accounting_journal}`}><Landmark size={16} />View accounting journal</Link>}<footer><button type="button" className="invoice-secondary-button" onClick={() => setSelected(null)}>Close</button>{selected.status === "unreconciled" && <Link className="page-primary-button" to={`/banking/reconciliation?bank_account=${selected.bank_account?.id}`}>Reconcile transaction</Link>}</footer></div>}</Modal>
  </div>;
}

function Summary({ icon, label, value, help, tone = "" }) { return <article className={tone ? `is-${tone}` : ""}><span className="bank-transaction-summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{help}</small></div></article>; }
