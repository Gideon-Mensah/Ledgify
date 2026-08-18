// Render live accounts, journals, periods, and financial reports with preserved drill-down dates.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Calculator, ChevronRight, CircleDollarSign, Ellipsis, Landmark, Plus, Search, ShieldCheck } from "lucide-react";

import PageHeader from "../../components/layout/PageHeader";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import AskAIButton from "../../components/ai/AskAIButton";
import AccountFormModal from "../../components/accounting/AccountFormModal";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { reportService } from "../../services/reportService";
import { useAuth } from "../../store/AuthContext";
import { getJournalSourceRoute, journalSourceLabel } from "../../utils/journalSourceRoutes";

import "../../styles/chartOfAccounts.css";
import "../../styles/journals.css";
import "../../styles/financialYearSettings.css";
import "../../styles/periodLocks.css";
import "../../styles/generalLedger.css";
import "../../styles/trialBalance.css";
import "../../styles/profitAndLoss.css";
import "../../styles/balanceSheet.css";
import "../../styles/cashFlow.css";
import "../../styles/agedReceivables.css";
import "../../styles/agedPayables.css";
import "../../styles/liveReports.css";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const displayValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    if (value.code && value.name) return `${value.code} — ${value.name}`;
    return value.name || value.entry_number || value.invoice_number || value.bill_number || "—";
  }
  return String(value);
};

const numericColumns = new Set([
  "amount", "amount_due", "amount_paid", "balance", "closing_balance",
  "credit", "current", "debit", "difference", "expenses", "income",
  "inventory_value", "net_cash_flow", "net_profit", "opening_balance",
  "quantity", "running_balance", "subtotal", "tax_total", "total",
  "total_assets", "total_credit", "total_debit", "total_equity",
  "total_expenses", "total_financing", "total_income", "total_investing",
  "total_liabilities", "total_liabilities_and_equity", "total_operating",
  "total_outstanding", "total_unclassified", "value",
]);

const columnClass = (column, rows) => {
  if (numericColumns.has(column) || rows.some((row) => typeof row?.[column] === "number")) {
    return "report-number-column";
  }
  if (column === "balanced" || column === "status") return "report-status-column";
  return "";
};

function DataTable({ rows, reportTable = false }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const pagination = useTablePagination(safeRows);
  const columns = (() => {
    const keys = new Set();
    safeRows.forEach((row) => Object.keys(row || {}).forEach((key) => keys.add(key)));
    return [...keys].filter((key) => !["id", "created_at", "updated_at"].includes(key));
  })();
  if (!safeRows.length) return <div className="invoice-form-card">No records found for the selected filters.</div>;
  return <><div className={`chart-accounts-table-wrapper${reportTable ? " report-table-wrapper" : ""}`}><table className={`chart-accounts-table${reportTable ? " report-data-table" : ""}`}>
    <thead><tr>{columns.map((column) => <th className={reportTable ? columnClass(column, safeRows) : ""} key={column}>{column.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</th>)}</tr></thead>
    <tbody>{pagination.pageRows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td className={reportTable ? columnClass(column, safeRows) : ""} key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody>
  </table></div><TablePagination {...pagination}/></>;
}

function StatePanel({ loading, error, children, onRetry }) {
  if (loading) return <div className="invoice-form-card">Loading…</div>;
  if (error) return <div className="invoice-form-alert" role="alert"><span>{error}</span>{onRetry && <button type="button" className="invoice-secondary-button" onClick={onRetry}>Try again</button>}</div>;
  return children;
}

export function LiveAccountsPage() {
  const auth = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState(""); const [type, setType] = useState(""); const [status, setStatus] = useState("");
  const [state, setState] = useState({ loading: true, error: "" });
  const [modal, setModal] = useState(null); const [menu, setMenu] = useState(""); const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try { setAccounts(await accountingApiService.accounts()); }
    catch (error) { setState({ loading: false, error: normaliseApiError(error) }); return; }
    setState({ loading: false, error: "" });
  }, []);
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [load]);

  const visible = useMemo(() => accounts.filter((item) => (!type || item.account_type === type) && (!status || item.status === status) && `${item.code} ${item.name}`.toLowerCase().includes(search.toLowerCase())), [accounts, search, status, type]);
  const accountPagination = useTablePagination(visible);
  const count = (value) => accounts.filter((item) => item.account_type === value).length;
  const format = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const saved = async (_, success) => { setModal(null); setMessage(success); await load(); };
  const changeStatus = async (account) => { try { await accountingApiService.updateAccount(account.id, { status: account.status === "active" ? "inactive" : "active" }); setMessage(`${account.code} · ${account.name} ${account.status === "active" ? "deactivated" : "activated"}.`); setMenu(""); await load(); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } };
  const summaries = [[Calculator,"Total accounts",accounts.length],[ShieldCheck,"Active accounts",accounts.filter((item) => item.status === "active").length],[Landmark,"Assets",count("asset")],[CircleDollarSign,"Liabilities",count("liability")],[CircleDollarSign,"Revenue",count("revenue")],[CircleDollarSign,"Expenses",count("expense")]];
  return <div className="chart-accounts-page"><PageHeader eyebrow="Accounting" title="Chart of Accounts" description="Manage the accounts used to record and report your organisation's finances." action={<div className="chart-accounts-header-actions"><Link className="invoice-secondary-button" to="/settings/financial">Accounting Settings</Link>{auth.hasPermission("export_reports") && <ReportExportMenu title="Chart of Accounts" rows={visible}/>} {auth.hasPermission("manage_accounts") && <button className="page-primary-button" onClick={() => setModal("new")}><Plus size={16}/>Add Account</button>}</div>}/>
    {message && <div className="chart-accounts-success"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss message">×</button></div>}
    <div className="chart-account-summary-grid">{summaries.map(([Icon,label,value]) => <article className="chart-account-summary-card" key={label}><div className="chart-account-summary-icon"><Icon size={19}/></div><div><span>{label}</span><strong>{value}</strong></div></article>)}</div>
    <section className="chart-accounts-panel"><div className="chart-accounts-toolbar"><label className="chart-account-search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account code or name" aria-label="Search accounts"/></label><select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by account type"><option value="">All accounts</option>{["asset","liability","equity","revenue","expense"].map((value) => <option key={value} value={value}>{format(value)}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></div>
      <StatePanel {...state} onRetry={() => void load()}>{visible.length ? <div className="chart-accounts-table-wrapper"><table className="chart-accounts-table coa-table"><thead><tr><th>Code</th><th>Account name</th><th>Type</th><th>Class</th><th>Status</th><th>Actions</th></tr></thead><tbody>{accountPagination.pageRows.map((account) => <tr className={account.status === "archived" ? "chart-account-row-archived" : ""} key={account.id}><td><Link to={`/accounting/accounts/${account.id}`} className="chart-account-code">{account.code}</Link></td><td><div className="chart-account-name"><Link to={`/accounting/accounts/${account.id}`}><strong>{account.name}</strong></Link><span>{account.description || `${account.code} · ${account.name}`}</span>{account.account_type === "asset" && account.account_class === "bank" && <span className={account.bank_account ? "banking-link-badge is-linked" : "banking-link-badge"}>{account.bank_account ? "Linked to Banking" : "Not linked to Banking"}</span>}</div></td><td><span className={`account-type-badge account-type-${account.account_type}`}>{format(account.account_type)}</span></td><td><span className="chart-account-class">{format(account.account_class)}</span></td><td><div className="chart-account-status-cell"><span className={`chart-account-status chart-account-status-${account.status}`}>{format(account.status)}</span>{account.is_system_account && <span className="chart-account-system-badge">System / Control Account</span>}</div></td><td><div className="chart-account-menu-wrap"><button className="chart-account-menu-button" aria-label={`Actions for ${account.code} · ${account.name}`} aria-expanded={menu === account.id} onClick={() => setMenu(menu === account.id ? "" : account.id)}><Ellipsis size={18}/></button>{menu === account.id && <div className="chart-account-menu"><Link to={`/accounting/accounts/${account.id}`}>View Account Details</Link><Link to={`/accounting/general-ledger?account_id=${account.id}`}>View General Ledger</Link>{auth.hasPermission("manage_accounts") && <button onClick={() => { setModal(account); setMenu(""); }}>Edit Account</button>}{auth.hasPermission("manage_accounts") && !account.is_system_account && <button onClick={() => void changeStatus(account)}>{account.status === "active" ? "Deactivate Account" : "Activate Account"}</button>}</div>}</div></td></tr>)}</tbody></table></div> : <div className="chart-accounts-empty"><Calculator size={30}/><h2>No accounts found</h2><p>{accounts.length ? "Try changing your search or filters." : "Add your first account to start building your chart of accounts."}</p>{!accounts.length && auth.hasPermission("manage_accounts") && <button className="page-primary-button" onClick={() => setModal("new")}>Add Account</button>}</div>}</StatePanel><TablePagination {...accountPagination}/></section>
    {modal && <AccountFormModal key={modal === "new" ? "new" : modal.id} isOpen account={modal === "new" ? null : modal} currency={auth.selectedOrganisation?.base_currency} onClose={() => setModal(null)} onSaved={saved}/>}</div>;
}

export function LiveJournalsPage() {
  const auth = useAuth();
  const [journals, setJournals] = useState([]);
  const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [source, setSource] = useState("");
  const [state, setState] = useState({ loading: true, error: "" });
  const load = useCallback(async () => { setState({ loading: true, error: "" }); try { setJournals(await accountingApiService.journals()); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);
  const sources = [...new Set(journals.map((journal) => journal.source_type).filter(Boolean))];
  const rows = journals.filter((journal) => (!status || journal.status === status) && (!source || journal.source_type === source) && `${journal.entry_number} ${journal.reference} ${journal.description}`.toLowerCase().includes(search.toLowerCase()));
  const journalPagination = useTablePagination(rows);
  const total = (journal, field) => (journal.lines || []).reduce((sum, line) => sum + Number(line[field] || 0), 0);
  const money = (value, journal) => new Intl.NumberFormat("en-GB", { style: "currency", currency: journal.organisation?.base_currency || "GBP" }).format(value);
  return <div className="journals-page"><PageHeader eyebrow="Accounting" title="Journal entries" description="Review complete journal postings, sources, balances and audit history." action={auth.hasPermission("create_journal") ? <Link className="page-primary-button" to="/accounting/journals/new"><Plus size={16}/>New Journal</Link> : null} />
    <section className="chart-accounts-panel"><div className="chart-accounts-toolbar"><label className="chart-account-search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, reference or description" aria-label="Search journals"/></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter journals by status"><option value="">All statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="reversed">Reversed</option></select><select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter journals by source"><option value="">All sources</option>{sources.map((value) => <option key={value} value={value}>{journalSourceLabel(value)}</option>)}</select></div>
      <StatePanel {...state} onRetry={() => void load()}>{rows.length ? <div className="chart-accounts-table-wrapper"><table className="chart-accounts-table journal-list-table"><thead><tr><th>Journal number</th><th>Date</th><th>Description</th><th>Source</th><th>Status</th><th className="report-number-column">Debit</th><th className="report-number-column">Credit</th><th>Created by</th><th>Actions</th></tr></thead><tbody>{journalPagination.pageRows.map((journal) => <tr key={journal.id}><td><Link className="invoice-number-link" to={`/accounting/journals/${journal.id}`}>{journal.entry_number}</Link></td><td>{journal.date}</td><td>{journal.description || "—"}</td><td>{journalSourceLabel(journal.source_type)}</td><td><span className={`chart-account-status chart-account-status-${journal.status}`}>{journal.status}</span></td><td className="report-number-column">{money(total(journal, "debit"), journal)}</td><td className="report-number-column">{money(total(journal, "credit"), journal)}</td><td>{journal.created_by?.name || "—"}</td><td><Link className="invoice-secondary-button" to={`/accounting/journals/${journal.id}`}>View</Link></td></tr>)}</tbody></table></div> : <div className="chart-accounts-empty"><Calculator size={30}/><h2>No journals found</h2><p>Try changing the search or filters.</p></div>}</StatePanel><TablePagination {...journalPagination}/>
    </section></div>;
}

function AdministrationPage({ kind }) {
  const auth = useAuth();
  const years = kind === "years";
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, error: "" });
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try { setRows(await (years ? accountingApiService.financialYears() : accountingApiService.periods())); setState({ loading: false, error: "" }); }
    catch (error) { setState({ loading: false, error: normaliseApiError(error) }); }
  }, [years]);
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [load]);
  const create = async () => {
    const name = window.prompt("Name"); const startDate = name && window.prompt("Start date (YYYY-MM-DD)"); const endDate = startDate && window.prompt("End date (YYYY-MM-DD)");
    if (!name || !startDate || !endDate) return;
    try { await (years ? accountingApiService.createFinancialYear({ name, start_date: startDate, end_date: endDate }) : accountingApiService.createPeriod({ name, start_date: startDate, end_date: endDate })); await load(); }
    catch (error) { window.alert(normaliseApiError(error)); }
  };
  const changeStatus = async (row) => {
    try {
      if (row.status === "open") await (years ? accountingApiService.closeFinancialYear(row.id) : accountingApiService.closePeriod(row.id));
      else { const reason = window.prompt("Reason for reopening"); if (!reason) return; await (years ? accountingApiService.reopenFinancialYear(row.id, { reason }) : accountingApiService.reopenPeriod(row.id, { reason })); }
      await load();
    } catch (error) { window.alert(normaliseApiError(error)); }
  };
  const canManage = auth.hasPermission(years ? "manage_financial_years" : "close_period");
  const canChangeStatus = (row) => auth.hasPermission(
    row.status === "open"
      ? years ? "close_financial_year" : "close_period"
      : years ? "reopen_financial_year" : "reopen_period"
  );
  return <div className={years ? "financial-year-settings-page" : "period-locks-page"}><PageHeader eyebrow="Accounting settings" title={years ? "Financial years" : "Accounting periods"} description="Organisation accounting calendar and status controls." action={canManage ? <button className="page-primary-button" onClick={create}>Add</button> : null} />
    <StatePanel {...state}><DataTable rows={rows} />{rows.filter(canChangeStatus).map((row) => <button key={row.id} className="invoice-secondary-button" onClick={() => changeStatus(row)}>{row.status === "open" ? "Close" : "Reopen"} {row.name}</button>)}</StatePanel></div>;
}

export const LiveFinancialYearsPage = () => <AdministrationPage kind="years" />;
export const LivePeriodsPage = () => <AdministrationPage kind="periods" />;

const reportDefinitions = {
  "general-ledger": { title: "General Ledger", method: "generalLedger", date: "range", className: "general-ledger-page" },
  "trial-balance": { title: "Trial Balance", method: "trialBalance", date: "as_of", className: "trial-balance-page" },
  "profit-and-loss": { title: "Profit & Loss", method: "profitLoss", date: "range", className: "profit-loss-page" },
  "balance-sheet": { title: "Balance Sheet", method: "balanceSheet", date: "as_of", className: "balance-sheet-page" },
  "cash-flow": { title: "Cash Flow Statement", method: "cashFlow", date: "range", className: "cash-flow-page" },
  "aged-receivables": { title: "Aged Receivables", method: "agedReceivables", date: "as_of", className: "aged-receivables-page" },
  "aged-payables": { title: "Aged Payables", method: "agedPayables", date: "as_of", className: "aged-payables-page" },
};

function GeneralLedgerDisplay({ ledgers, filters, currency }) {
  const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));
  const accountQuery = new URLSearchParams({ from: "ledger", ...(filters.start_date ? { start_date: filters.start_date } : {}), ...(filters.end_date ? { end_date: filters.end_date } : {}) });
  if (!ledgers.length) return <div className="chart-accounts-empty"><Calculator size={30}/><h2>No ledger activity</h2><p>No posted journal lines were found for the selected period.</p></div>;
  return <>{ledgers.map((ledger) => <section className="general-ledger-panel" key={ledger.account.id}><header className="journal-details-panel-header"><h2><Link className="invoice-number-link" to={`/accounting/accounts/${ledger.account.id}?${accountQuery}`}>{ledger.account.code} · {ledger.account.name}</Link></h2><p>{ledger.account.account_type.replaceAll("_", " ")} · {ledger.account.account_class.replaceAll("_", " ")} · {ledger.account.normal_balance} normal balance</p></header><div className="journal-details-table-wrapper"><table className="journal-details-table"><thead><tr><th>Date</th><th>Journal</th><th>Reference</th><th>Description</th><th>Source</th><th className="journal-details-amount">Debit</th><th className="journal-details-amount">Credit</th><th className="journal-details-amount">Running balance</th></tr></thead><tbody>{ledger.transactions.length ? ledger.transactions.map((row, index) => { const sourceRoute = getJournalSourceRoute(row.source_type, row.source_id); return <tr key={`${row.journal_id}-${index}`}><td>{row.date}</td><td><Link to={`/accounting/journals/${row.journal_id}`}>{row.entry_number}</Link></td><td>{row.reference || "—"}</td><td>{row.description || "—"}</td><td>{sourceRoute ? <Link to={sourceRoute}>{journalSourceLabel(row.source_type)}</Link> : journalSourceLabel(row.source_type)}</td><td className="journal-details-amount">{Number(row.debit) ? money(row.debit) : "—"}</td><td className="journal-details-amount">{Number(row.credit) ? money(row.credit) : "—"}</td><td className="journal-details-amount">{money(row.running_balance)}</td></tr>; }) : <tr><td colSpan="8" className="journal-details-empty">No transactions for this account in the selected period.</td></tr>}</tbody><tfoot><tr><td colSpan="5">Period totals</td><td className="journal-details-amount">{money(ledger.total_debit)}</td><td className="journal-details-amount">{money(ledger.total_credit)}</td><td className="journal-details-amount">{money(ledger.balance)}</td></tr></tfoot></table></div></section>)}</>;
}

function TrialBalanceDisplay({ report, filters, currency }) {
  const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));
  const context = new URLSearchParams({ source: "trial-balance", as_of_date: filters.as_of_date });
  const pagination = useTablePagination(report.rows);
  return <section className="trial-balance-panel"><div className="journal-details-table-wrapper"><table className="journal-details-table trial-balance-drilldown-table"><thead><tr><th>Account</th><th>Type</th><th>Class</th><th className="journal-details-amount">Debit</th><th className="journal-details-amount">Credit</th><th aria-label="Drill down"/></tr></thead><tbody>{report.rows.length ? pagination.pageRows.map((row) => <tr key={row.account.id}><td><Link className="trial-balance-account-link" to={`/accounting/accounts/${row.account.id}?${context}`}><strong>{row.account.code}</strong><span>{row.account.name}</span></Link></td><td>{humaniseReportValue(row.account.account_type)}</td><td>{humaniseReportValue(row.account.account_class)}</td><td className="journal-details-amount">{Number(row.debit) ? money(row.debit) : "—"}</td><td className="journal-details-amount">{Number(row.credit) ? money(row.credit) : "—"}</td><td><Link className="trial-balance-row-arrow" aria-label={`View activity for ${row.account.code} ${row.account.name}`} to={`/accounting/accounts/${row.account.id}?${context}`}>›</Link></td></tr>) : <tr><td className="journal-details-empty" colSpan="6">No Trial Balance accounts were found as at this date.</td></tr>}</tbody><tfoot><tr><td colSpan="3">Grand total</td><td className="journal-details-amount">{money(report.total_debit)}</td><td className="journal-details-amount">{money(report.total_credit)}</td><td/></tr><tr><td colSpan="3">Difference</td><td className="journal-details-amount" colSpan="2">{money(report.difference)}</td><td/></tr></tfoot></table></div><TablePagination {...pagination}/></section>;
}

function StatementSection({ name, rows, report, filters, currency }) {
  const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));
  const isCashFlow = report === "cash-flow";
  const source = report === "profit-and-loss" ? "profit-loss" : report;
  const pagination = useTablePagination(rows);
  return <section className="invoice-form-card report-section" key={name}>
    <h2>{humaniseReportValue(name)}</h2>
    {rows.length ? <><div className="report-table-wrapper"><table className="report-data-table financial-drilldown-table"><thead><tr><th>Account</th><th className="report-number-column">Amount</th><th aria-label="Drill down"/></tr></thead><tbody>{pagination.pageRows.map((row) => {
      const account = row.account;
      const query = new URLSearchParams({ source, ...(filters.start_date ? { start_date: filters.start_date } : {}), ...(filters.end_date ? { end_date: filters.end_date } : {}), ...(filters.as_of_date ? { as_of_date: filters.as_of_date } : {}), report_amount: String(row.amount) });
      const href = isCashFlow ? `/accounting/cash-flow/breakdown/${row.row_key}?${query}` : account?.id ? `/accounting/accounts/${account.id}?${query}` : null;
      return <tr key={row.row_key || account?.id || account?.name} className={href ? "financial-drilldown-row" : "financial-calculated-row"}><td>{href ? <Link className="financial-account-link" to={href}><strong>{account?.code}</strong><span>{account?.name}</span></Link> : <span className="financial-calculated-label">{account?.name || "Calculated line"}<small>Calculated report line</small></span>}</td><td className="report-number-column">{money(row.amount)}</td><td>{href && <Link className="trial-balance-row-arrow" aria-label={`View breakdown for ${account?.code || "cash flow"} ${account?.name || name}`} to={href}><ChevronRight size={17}/></Link>}</td></tr>;
    })}</tbody></table></div><TablePagination {...pagination}/></> : <div className="journal-details-empty">No activity for this report section in the selected period.</div>}
  </section>;
}

const humaniseReportValue = (value) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LiveReportPage({ report }) {
  const auth = useAuth();
  const definition = reportDefinitions[report];
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({ ...(definition.date === "as_of" ? { as_of_date: searchParams.get("as_of_date") || today() } : { start_date: searchParams.get("start_date") || "", end_date: searchParams.get("end_date") || today() }), ...(report === "general-ledger" && searchParams.get("account_id") ? { account_id: searchParams.get("account_id") } : {}) }));
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try { setData(await reportService[definition.method](filters)); setState({ loading: false, error: "" }); }
    catch (error) { setState({ loading: false, error: normaliseApiError(error) }); }
  }, [definition.method, filters]);
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [load]);
  const sections = Array.isArray(data)
    ? [["accounts", data]]
    : data ? Object.entries(data).filter(([, value]) => Array.isArray(value)) : [];
  const totals = data && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data).filter(([, value]) => !Array.isArray(value)))
        : {};
  const exportRows = [...sections.flatMap(([section, rows]) => rows.map((row) => ({ section, ...row }))), ...(Object.keys(totals).length ? [{ section: "Totals", ...totals }] : [])];
  return <div className={definition.className}><PageHeader eyebrow="Financial reports" title={definition.title} description="Review financial performance and position from posted accounting entries." action={<>{auth.hasPermission("use_ai_assistant") && <AskAIButton prompt={`Explain my ${definition.title} for the selected period and highlight anything I should review.`}/>}<ReportExportMenu title={definition.title} rows={exportRows} metadata={filters} disabled={state.loading}/></>} />
    <div className="invoice-form-card">{Object.keys(filters).map((field) => field === "account_id" ? <input key={field} type="hidden" value={filters[field]}/> : <label key={field}>{field.replaceAll("_", " ")} <input type="date" value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))} /></label>)}<button className="page-primary-button" onClick={load}>Refresh</button></div>
    <StatePanel {...state}>{data && <>{report === "general-ledger" ? <GeneralLedgerDisplay ledgers={Array.isArray(data) ? data : []} filters={filters} currency={auth.selectedOrganisation?.base_currency || "GBP"}/> : report === "trial-balance" ? <><div className="trial-balance-summary-grid"><article className="trial-balance-summary-card"><div><span>Total debit</span><strong>{displayValue(data.total_debit)}</strong></div></article><article className="trial-balance-summary-card"><div><span>Total credit</span><strong>{displayValue(data.total_credit)}</strong></div></article><article className={`trial-balance-summary-card ${data.balanced ? "is-balanced" : "is-unbalanced"}`}><div><span>Balance check</span><strong>{data.balanced ? "Balanced" : displayValue(data.difference)}</strong></div></article></div>{data.balanced === false && <div className="invoice-form-alert">This report is out of balance by {displayValue(data.difference)}. Review the underlying posted entries.</div>}<TrialBalanceDisplay report={data} filters={filters} currency={auth.selectedOrganisation?.base_currency || "GBP"}/></> : <>{data.balanced === false && <div className="invoice-form-alert">This report is out of balance by {displayValue(data.difference)}. Review the underlying posted entries.</div>}{Object.keys(totals).length > 0 && <div className="invoice-form-card report-totals-card"><DataTable reportTable rows={[totals]} /></div>}{sections.map(([name, rows]) => ["profit-and-loss", "balance-sheet", "cash-flow"].includes(report) ? <StatementSection key={name} name={name} rows={rows} report={report} filters={filters} currency={auth.selectedOrganisation?.base_currency || "GBP"}/> : <section className="invoice-form-card report-section" key={name}><h2>{humaniseReportValue(name)}</h2><DataTable reportTable rows={rows} /></section>)}</>}</>}</StatePanel></div>;
}

export function LiveStatementPage({ type }) {
  const params = useParams();
  const id = type === "customer" ? params.customerId : params.supplierId;
  const [filters, setFilters] = useState({ [`${type}_id`]: id, start_date: "", end_date: today() });
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try { setData(await reportService[type === "customer" ? "customerStatement" : "supplierStatement"](filters)); setState({ loading: false, error: "" }); }
    catch (error) { setState({ loading: false, error: normaliseApiError(error) }); }
  }, [filters, type]);
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [load]);
  return <div className="invoice-details-page"><PageHeader eyebrow="Finance" title={`${type === "customer" ? "Customer" : "Supplier"} statement`} description="Review opening balance, transactions, and closing balance for the selected period." />
    <div className="invoice-form-card">{["start_date", "end_date"].map((field) => <label key={field}>{field.replaceAll("_", " ")} <input type="date" value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))} /></label>)}</div>
    <StatePanel {...state}>{data && <>{<DataTable rows={[Object.fromEntries(Object.entries(data).filter(([, value]) => !Array.isArray(value)))]} />}{Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([name, rows]) => <section className="invoice-form-card" key={name}><h2>{name.replaceAll("_", " ")}</h2><DataTable rows={rows} /></section>)}</>}</StatePanel></div>;
}
