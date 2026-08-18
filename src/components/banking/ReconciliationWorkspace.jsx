import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock3, Landmark, Link2, Scale, Search, Sparkles, Unlink } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import PageHeader from "../layout/PageHeader";
import TablePagination from "../common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { bankService } from "../../services/bankService";
import { useAuth } from "../../store/AuthContext";
import "../../styles/reconciliation.css";

const today = () => new Date().toISOString().slice(0, 10);
const list = (value) => Array.isArray(value) ? value : value?.results || [];
const humanise = (value) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateOnly = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—";
const dateTime = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
const money = (value, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));

export default function ReconciliationWorkspace() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState([]);
  const [ledgerAccounts, setLedgerAccounts] = useState([]);
  const [accountId, setAccountId] = useState(searchParams.get("bank_account") || "");
  const [reconciliationDate, setReconciliationDate] = useState(today());
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("unreconciled");
  const [selected, setSelected] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: true, action: false, error: "", success: "" });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void Promise.all([bankService.accounts({ status: "active" }), accountingApiService.accounts({ status: "active" })])
        .then(([bankRows, ledgerRows]) => {
          const available = list(bankRows);
          setAccounts(available);
          setLedgerAccounts(list(ledgerRows));
          setAccountId((current) => current || available[0]?.id || "");
          setState((current) => ({ ...current, loading: false }));
        })
        .catch((error) => setState({ loading: false, action: false, error: normaliseApiError(error), success: "" }));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!accountId) return;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const [summaryData, transactionRows, historyRows] = await Promise.all([
        bankService.reconciliationSummary(accountId, reconciliationDate),
        bankService.transactions({ bank_account: accountId, date_to: reconciliationDate }),
        bankService.reconciliationHistory(accountId),
      ]);
      setSummary(summaryData);
      setTransactions(list(transactionRows));
      setHistory(list(historyRows));
      setSelected(null);
      setSuggestions([]);
      setState((current) => ({ ...current, loading: false }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: normaliseApiError(error) }));
    }
  }, [accountId, reconciliationDate]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadWorkspace());
    return () => cancelAnimationFrame(frame);
  }, [loadWorkspace]);

  const filteredTransactions = useMemo(() => transactions.filter((row) => row.status === tab && (!search.trim() || [row.description, row.reference, row.amount].some((value) => String(value || "").toLowerCase().includes(search.toLowerCase())))), [search, tab, transactions]);
  const transactionPagination = useTablePagination(filteredTransactions);
  const historyPagination = useTablePagination(history);

  const choose = async (row) => {
    setSelected(row);
    setSuggestions([]);
    setTarget("");
    setReason("");
    if (row.status !== "unreconciled") return;
    setState((current) => ({ ...current, action: true, error: "" }));
    try {
      const result = await bankService.suggestions(row.id);
      setSuggestions(result.suggestions || []);
      setState((current) => ({ ...current, action: false }));
    } catch (error) {
      setState((current) => ({ ...current, action: false, error: normaliseApiError(error) }));
    }
  };

  const mutate = async (operation, success) => {
    setState((current) => ({ ...current, action: true, error: "", success: "" }));
    try {
      await operation();
      setSelected(null);
      setSuggestions([]);
      setTarget("");
      setReason("");
      await loadWorkspace();
      setState((current) => ({ ...current, action: false, success }));
    } catch (error) {
      setState((current) => ({ ...current, action: false, error: normaliseApiError(error) }));
    }
  };

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const currency = summary?.bank_account?.currency || selectedAccount?.currency || "GBP";
  const difference = summary?.difference;

  return <div className="reconciliation-workspace">
    <PageHeader eyebrow="Banking" title={selectedAccount ? `Reconcile ${selectedAccount.name}` : "Bank reconciliation"} description="Match statement transactions to records already in Ledgify, or create the accounting entry when one does not exist." />

    <section className="reconciliation-controls" aria-label="Reconciliation scope"><label>Bank account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select a bank account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Statement date<input type="date" value={reconciliationDate} max={today()} onChange={(event) => setReconciliationDate(event.target.value)} /></label>{summary?.bank_account?.ledger_account && <div><span>Linked ledger</span><Link to={`/accounting/accounts/${summary.bank_account.ledger_account.id}`}>{summary.bank_account.ledger_account.code} · {summary.bank_account.ledger_account.name}</Link></div>}</section>

    {state.error && <div className="invoice-form-alert" role="alert">{state.error}</div>}
    {state.success && <div className="bank-page-success" role="status">{state.success}</div>}

    {!accounts.length && !state.loading ? <section className="reconciliation-empty"><Landmark size={30} /><h2>No linked bank accounts</h2><p>Set up a bank account and link it to an active ledger bank account before reconciling.</p><Link className="page-primary-button" to="/banking/accounts">Set up ledger account</Link></section> : <>
      {summary && <section className="reconciliation-summary-grid"><SummaryCard label="Book balance" value={money(summary.book_balance, currency)} help="Balance in Ledgify's posted General Ledger" icon={<Landmark size={20} />} /><SummaryCard label="Statement balance" value={summary.statement_balance_available ? money(summary.statement_balance, currency) : "Not available"} help={`Imported statement activity to ${dateOnly(reconciliationDate)}`} icon={<Scale size={20} />} /><SummaryCard label="Difference" value={difference === null || difference === undefined ? "Not available" : money(difference, currency)} help="Statement balance minus book balance" tone={Number(difference) === 0 ? "good" : "warning"} icon={<Link2 size={20} />} /><SummaryCard label="Unreconciled" value={summary.unreconciled_count} help={`Last reconciled: ${dateTime(summary.last_reconciled_at)}`} tone={summary.unreconciled_count ? "warning" : "good"} icon={<Clock3 size={20} />} /></section>}

      {summary && <div className={`reconciliation-explanation ${summary.complete ? "is-complete" : ""}`}>{summary.complete ? <CheckCircle2 size={19} /> : <Scale size={19} />}<div><strong>{summary.complete ? "Reconciliation complete" : "Difference still to explain"}</strong><p>{summary.complete ? "All statement items through this date are reconciled and the statement and book balances agree." : summary.statement_balance_available ? "The difference may include statement items not yet recorded in the ledger, deposits in transit, or uncleared payments. Ledgify will not force it to zero." : "Import statement activity or provide an opening statement balance before comparing it with the ledger."}</p></div></div>}

      <section className="reconciliation-panel"><header className="reconciliation-panel-header"><div><h2>Statement transactions</h2><p>Only transactions on or before the selected statement date are included.</p></div><div className="reconciliation-tabs"><button className={tab === "unreconciled" ? "active" : ""} onClick={() => { setTab("unreconciled"); setSelected(null); }}>To reconcile <span>{transactions.filter((row) => row.status === "unreconciled").length}</span></button><button className={tab === "reconciled" ? "active" : ""} onClick={() => { setTab("reconciled"); setSelected(null); }}>Reconciled <span>{transactions.filter((row) => row.status === "reconciled").length}</span></button><button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); setSelected(null); }}>History</button></div></header>
        {tab !== "history" && <div className="reconciliation-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search description, reference or amount" /></div>}
        {state.loading ? <div className="reconciliation-loading"><span className="header-spinner" />Loading reconciliation data…</div> : tab === "history" ? <HistoryTable rows={historyPagination.pageRows} /> : <TransactionsTable rows={transactionPagination.pageRows} onChoose={choose} />}
        {!state.loading && tab === "history" && <TablePagination {...historyPagination} />}
        {!state.loading && tab !== "history" && <TablePagination {...transactionPagination} />}
      </section>

      {selected && <section className="reconciliation-review"><header><div><span className={selected.transaction_type === "money_in" ? "money-in" : "money-out"}>{selected.transaction_type === "money_in" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><div><h2>{selected.description}</h2><p>{dateOnly(selected.transaction_date)} · {selected.reference || "No reference"}</p></div></div><strong>{money(selected.amount, selected.currency)}</strong></header>{selected.status === "unreconciled" ? <div className="reconciliation-match-layout"><div className="reconciliation-suggestions"><h3><Sparkles size={16} />Suggested existing matches</h3>{state.action ? <p>Finding safe matches…</p> : suggestions.length ? suggestions.map((item) => <article key={`${item.match_type}-${item.object_id}`}><div><span className="reconciliation-match-type">{humanise(item.match_type)}</span><h4>{item.label}</h4><p>{item.metadata?.payment_date ? dateOnly(item.metadata.payment_date) : item.metadata?.due_date ? dateOnly(item.metadata.due_date) : "Related accounting record"} · {money(item.amount, selected.currency)}</p><small>{item.reasons?.join(" · ") || "Amount and date comparison"}</small></div><div><span className={`reconciliation-confidence is-${item.confidence_label?.toLowerCase()}`}>{item.confidence_label} · {item.confidence}%</span>{auth.hasPermission("reconcile_bank") && <button disabled={state.action} className="page-primary-button" onClick={() => void mutate(() => bankService.acceptSuggestion(selected.id, { match_type: item.match_type, object_id: item.object_id }), "Match accepted. No duplicate accounting entry was created for an existing payment.")}>Accept match</button>}</div></article>) : <div className="reconciliation-no-match">No safe automatic matches were found.</div>}</div>{auth.hasPermission("reconcile_bank") && <aside className="reconciliation-coding"><h3>Create accounting entry</h3><p>Use this only when the statement item has not already been recorded in Ledgify.</p><label>Code to account<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Select ledger account</option>{ledgerAccounts.filter((account) => account.id !== summary?.bank_account?.ledger_account?.id).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><button disabled={!target || state.action} className="page-primary-button" onClick={() => void mutate(() => bankService.reconcileToAccount(selected.id, target), "Accounting entry created and bank transaction reconciled.")}>Code transaction</button><small>This creates a balanced, posted journal through the journal service.</small></aside>}</div> : <div className="reconciliation-unreconcile"><div><h3>Reconciliation details</h3><p>Matched as {humanise(selected.reconciliation_type)} on {dateTime(selected.reconciled_at)}.</p>{selected.accounting_journal && <Link to={`/accounting/journals/${selected.accounting_journal}`}>View linked journal</Link>}</div>{auth.hasPermission("unreconcile_bank") && <div><label>Reason for unreconciling<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for a clear audit trail" /></label><button disabled={!reason.trim() || state.action} className="invoice-secondary-button" onClick={() => void mutate(() => bankService.unreconcile(selected.id, { reason, reversal_date: reconciliationDate }), "Transaction unreconciled and audit history preserved.")}><Unlink size={16} />Unreconcile safely</button></div>}</div>}</section>}
    </>}
  </div>;
}

function SummaryCard({ label, value, help, icon, tone = "" }) { return <article className={tone ? `is-${tone}` : ""}><span className="reconciliation-summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{help}</small></div></article>; }

function TransactionsTable({ rows, onChoose }) { if (!rows.length) return <div className="reconciliation-empty-inline"><CheckCircle2 size={25} /><strong>You&apos;re all caught up</strong><span>No bank transactions remain in this view for the selected account and date.</span></div>; return <div className="reconciliation-table-wrapper"><table><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="reconciliation-number">Money in</th><th className="reconciliation-number">Money out</th><th>Status</th><th>Suggested match / action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateOnly(row.transaction_date)}</td><td><strong>{row.description}</strong></td><td>{row.reference || "—"}</td><td className="reconciliation-number money-in-value">{row.transaction_type === "money_in" ? money(row.amount, row.currency) : "—"}</td><td className="reconciliation-number money-out-value">{row.transaction_type === "money_out" ? money(row.amount, row.currency) : "—"}</td><td><span className={`reconciliation-status is-${row.status}`}>{humanise(row.status)}</span></td><td><button className="invoice-secondary-button" onClick={() => void onChoose(row)}>{row.status === "reconciled" ? "Review" : "Find match"}</button></td></tr>)}</tbody></table></div>; }

function HistoryTable({ rows }) { if (!rows.length) return <div className="reconciliation-empty-inline"><Clock3 size={25} /><strong>No reconciliation history</strong><span>Completed and reversed reconciliation actions will appear here.</span></div>; return <div className="reconciliation-table-wrapper"><table><thead><tr><th>Action date</th><th>Statement transaction</th><th>Matched to</th><th className="reconciliation-number">Amount</th><th>Performed by</th><th>Journal</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{dateTime(item.performed_at)}</td><td><strong>{item.transaction.description}</strong><small>{item.transaction.reference || "No reference"}</small></td><td><span className={`reconciliation-status is-${item.action}`}>{humanise(item.action)}</span><small>{humanise(item.reconciliation_type)}</small></td><td className="reconciliation-number">{money(item.transaction.amount, item.transaction.currency)}</td><td>{item.performed_by?.name || "—"}</td><td>{item.journal ? <Link to={`/accounting/journals/${item.journal.id}`}>{item.journal.entry_number}</Link> : "No journal created"}</td></tr>)}</tbody></table></div>; }
