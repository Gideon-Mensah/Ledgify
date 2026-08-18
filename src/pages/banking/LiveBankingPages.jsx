// Present bank accounts and transactions from the organisation-scoped banking API.

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, Building2, CircleDollarSign, Landmark, Plus, WalletCards } from "lucide-react";

import PageHeader from "../../components/layout/PageHeader";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { bankService } from "../../services/bankService";
import { useAuth } from "../../store/AuthContext";
import ReconciliationWorkspace from "../../components/banking/ReconciliationWorkspace";
import BankingTransactionsWorkspace from "../../components/banking/BankingTransactionsWorkspace";

import "../../styles/banking.css";
import "../../styles/chartOfAccounts.css";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value, code = "GBP") => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: code,
}).format(Number(value) || 0);
function State({ loading, error, children }) {
  if (loading) return <div className="invoice-form-card">Loading banking data…</div>;
  if (error) return <div className="invoice-form-alert">{error}</div>;
  return children;
}
function Feedback({ message }) { return message ? <p className="invoice-form-alert">{message}</p> : null; }
export function LiveBankAccountsPage() {
  const auth = useAuth(); const [searchParams] = useSearchParams(); const [accounts, setAccounts] = useState([]); const [ledgers, setLedgers] = useState([]); const [unlinked, setUnlinked] = useState([]); const [message, setMessage] = useState(""); const [editing, setEditing] = useState(null); const [showForm, setShowForm] = useState(Boolean(searchParams.get("ledger_account_id"))); const [state, setState] = useState({ loading: true, error: "" });
  const [form, setForm] = useState({ name: "", bank_name: "", account_number: "", ledger_account_id: searchParams.get("ledger_account_id") || "", status: "active" });
  const load = useCallback(async () => { setState({ loading: true, error: "" }); try { const [banks, ledgerRows, unlinkedRows] = await Promise.all([bankService.accounts(), accountingApiService.accounts({ class: "bank", status: "active" }), bankService.unlinkedLedgerAccounts()]); setAccounts(banks); setLedgers(ledgerRows.filter((row) => !row.bank_account)); setUnlinked(unlinkedRows); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  const change = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const save = async (event) => { event.preventDefault(); setMessage(""); try { if (editing) await bankService.updateAccount(editing, { name: form.name, bank_name: form.bank_name, account_number: form.account_number, status: form.status }); else await bankService.createAccount({ ...form, sort_code: "", iban: "", swift_bic: "", currency: auth.selectedOrganisation?.base_currency || "GBP", opening_balance: "0.00", opening_balance_date: today() }); setMessage(editing ? "Bank account updated." : "Bank account created."); setEditing(null); setShowForm(false); setForm({ name: "", bank_name: "", account_number: "", ledger_account_id: "", status: "active" }); await load(); } catch (error) { setMessage(normaliseApiError(error)); } };
  const startEdit = (account) => { setEditing(account.id); setShowForm(true); setForm({ name: account.name, bank_name: account.bank_name || "", account_number: account.account_number || "", ledger_account_id: account.ledger_account?.id || "", status: account.status }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const setup = (ledger) => { setEditing(null); setShowForm(true); setForm({ name: ledger.name, bank_name: "", account_number: "", ledger_account_id: ledger.id, status: "active" }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const cancelForm = () => { setEditing(null); setShowForm(false); setMessage(""); setForm({ name: "", bank_name: "", account_number: "", ledger_account_id: "", status: "active" }); };
  const totalBook = accounts.reduce((sum, account) => sum + Number(account.book_balance || 0), 0); const unreconciled = accounts.reduce((sum, account) => sum + Number(account.unreconciled_count || 0), 0);
  const accountPagination = useTablePagination(accounts);
  return <div className="bank-accounts-page"><PageHeader eyebrow="Banking" title="Bank accounts" description="Monitor cash balances and manage bank records linked to the general ledger." action={auth.hasPermission("manage_accounts") && <button className="page-primary-button" type="button" onClick={() => { setEditing(null); setShowForm((value) => !value); }}><Plus size={17}/>{showForm && !editing ? "Close form" : "Add bank account"}</button>} />
    <div className="bank-summary-grid"><article className="bank-summary-card"><span className="bank-summary-icon"><CircleDollarSign size={22}/></span><div><span>Total book cash</span><strong>{money(totalBook, auth.selectedOrganisation?.base_currency)}</strong><small>Across all managed accounts</small></div></article><article className="bank-summary-card"><span className="bank-summary-icon"><WalletCards size={22}/></span><div><span>Bank accounts</span><strong>{accounts.length}</strong><small>{accounts.filter((account) => account.status === "active").length} active</small></div></article><article className={`bank-summary-card ${unreconciled ? "needs-attention" : ""}`}><span className="bank-summary-icon"><AlertCircle size={22}/></span><div><span>Unreconciled transactions</span><strong>{unreconciled}</strong><small>{unreconciled ? "Requires review" : "Everything is up to date"}</small></div></article></div>
    {message && !showForm && <div className="bank-page-success" role="status">{message}</div>}
    {auth.hasPermission("manage_accounts") && showForm && <form className="invoice-form-card bank-account-form" onSubmit={save}><div className="bank-form-heading"><div><span className="bank-form-icon"><Landmark size={20}/></span><div><h2>{editing ? "Edit bank account" : "Add bank account"}</h2><p>Link an active GL account classified as Bank. Existing journal history will not change.</p></div></div></div><div className="bank-account-form-grid"><label>Display name <input required name="name" value={form.name} onChange={change} placeholder="e.g. Main operating account" /></label><label>Bank or institution <input required name="bank_name" value={form.bank_name} onChange={change} placeholder="Institution name" /></label><label>Account number <input required name="account_number" value={form.account_number} onChange={change} placeholder="Account identifier" /></label>{!editing && <label>Existing ledger account <select required name="ledger_account_id" value={form.ledger_account_id} onChange={change}><option value="">Select eligible account</option>{ledgers.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>}<label>Status <select name="status" value={form.status} onChange={change}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div><div className="bank-form-actions"><button className="invoice-secondary-button" type="button" onClick={cancelForm}>Cancel</button><button className="page-primary-button" type="submit">{editing ? "Save changes" : "Set up in Banking"}</button></div><Feedback message={message} /></form>}
    <State {...state}><section className="bank-accounts-section"><div className="bank-section-heading"><div><h2>Managed bank accounts</h2><p>Book and statement balances for accounts connected to your ledger.</p></div><span className="bank-account-count">{accounts.length} {accounts.length === 1 ? "account" : "accounts"}</span></div>{accounts.length ? <div className="bank-account-grid">{accountPagination.pageRows.map((account) => <article className="bank-account-card" key={account.id}><div className="bank-account-card-top"><div className="bank-account-identity"><span className="bank-account-icon"><Building2 size={20}/></span><div><div className="bank-account-name-row"><h3>{account.name}</h3><span className={`bank-account-status is-${account.status}`}>{account.status}</span></div><p>{account.bank_name || "Bank institution not specified"} · {account.account_number || "No account number"}</p></div></div></div><div className="bank-account-balance"><span>Book balance · Posted general ledger</span><strong>{money(account.book_balance, account.currency)}</strong></div><div className="bank-account-details"><div><span>Statement balance</span><strong>{account.statement_balance === null ? "Not available" : money(account.statement_balance, account.currency)}</strong></div><div><span>Difference</span><strong className={Number(account.reconciliation_difference) ? "bank-needs-review" : ""}>{account.reconciliation_difference === null ? "Not available" : money(account.reconciliation_difference, account.currency)}</strong></div><div><span>Linked ledger</span><Link to={`/accounting/accounts/${account.ledger_account.id}?source=chart-of-accounts`}>{account.ledger_account.code} · {account.ledger_account.name}</Link></div><div><span>Unreconciled</span><strong className={account.unreconciled_count ? "bank-needs-review" : ""}>{account.unreconciled_count}</strong></div></div><footer className="bank-account-footer"><Link className="invoice-secondary-button" to={`/accounting/accounts/${account.ledger_account.id}`}>View ledger</Link><Link className="invoice-secondary-button" to={`/banking/reconciliation?bank_account=${account.id}`}>Reconcile</Link>{auth.hasPermission("manage_accounts") && <button type="button" className="invoice-secondary-button" onClick={() => startEdit(account)}>Edit account</button>}</footer></article>)}</div> : <div className="bank-empty-state"><span className="bank-empty-icon"><Landmark size={26}/></span><h3>No bank accounts yet</h3><p>Link an eligible general ledger bank account to start managing transactions and reconciliation.</p>{auth.hasPermission("manage_accounts") && <button type="button" className="page-primary-button" onClick={() => setShowForm(true)}><Plus size={17}/>Add bank account</button>}</div>}<TablePagination {...accountPagination}/></section>
      {unlinked.length > 0 && <section className="invoice-form-card unlinked-bank-ledgers"><h2>Unlinked ledger accounts</h2><p>These eligible GL bank accounts are not yet configured for bank feeds or reconciliation.</p>{unlinked.map((ledger) => <div key={ledger.id}><span><strong>{ledger.code} · {ledger.name}</strong><small>{ledger.currency || auth.selectedOrganisation?.base_currency}</small></span>{auth.hasPermission("manage_accounts") && <button className="invoice-secondary-button" onClick={() => setup(ledger)}>Set up in Banking</button>}</div>)}</section>}</State>
  </div>;
}

export function LiveBankTransactionsPage() {
  return <BankingTransactionsWorkspace />;
}

export function LiveReconciliationPage() {
  return <ReconciliationWorkspace />;
}
