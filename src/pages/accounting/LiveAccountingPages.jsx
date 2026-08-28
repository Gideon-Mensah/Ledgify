// Render live accounts, journals, periods, and financial reports with preserved drill-down dates.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Calculator, CircleDollarSign, Ellipsis, FileUp, Landmark, Plus, Printer, Search, ShieldCheck } from "lucide-react";

import PageHeader from "../../components/layout/PageHeader";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import AskAIButton from "../../components/ai/AskAIButton";
import AccountFormModal from "../../components/accounting/AccountFormModal";
import AccountImportModal from "../../components/accounting/AccountImportModal";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { reportService } from "../../services/reportService";
import { useAuth } from "../../store/AuthContext";
import { getJournalSourceRoute, journalSourceLabel } from "../../utils/journalSourceRoutes";
import { formatCurrency } from "../../utils/currency";

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
  const [modal, setModal] = useState(null); const [importing, setImporting] = useState(false); const [menu, setMenu] = useState(""); const [message, setMessage] = useState("");
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
  return <div className="chart-accounts-page"><PageHeader eyebrow="Accounting" title="Chart of Accounts" description="Manage the accounts used to record and report your organisation's finances." action={<div className="chart-accounts-header-actions"><Link className="invoice-secondary-button" to="/settings/financial">Accounting Settings</Link><Link className="invoice-secondary-button" to="/accounting/opening-balances">Opening Balances</Link>{auth.hasPermission("export_reports") && <ReportExportMenu title="Chart of Accounts" rows={visible}/>} {auth.hasPermission("manage_accounts") && <button className="invoice-secondary-button" onClick={() => setImporting(true)}><FileUp size={16}/>Import Accounts</button>}{auth.hasPermission("manage_accounts") && <button className="page-primary-button" onClick={() => setModal("new")}><Plus size={16}/>New Account</button>}</div>}/>
    {message && <div className="chart-accounts-success"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss message">×</button></div>}
    <div className="chart-account-summary-grid">{summaries.map(([Icon,label,value]) => <article className="chart-account-summary-card" key={label}><div className="chart-account-summary-icon"><Icon size={19}/></div><div><span>{label}</span><strong>{value}</strong></div></article>)}</div>
    <section className="chart-accounts-panel"><div className="chart-accounts-toolbar"><label className="chart-account-search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account code or name" aria-label="Search accounts"/></label><select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by account type"><option value="">All accounts</option>{["asset","liability","equity","revenue","expense"].map((value) => <option key={value} value={value}>{format(value)}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></div>
      <StatePanel {...state} onRetry={() => void load()}>{visible.length ? <div className="chart-accounts-table-wrapper"><table className="chart-accounts-table coa-table"><thead><tr><th>Code</th><th>Account name</th><th>Type</th><th>Class</th><th>Status</th><th>Actions</th></tr></thead><tbody>{accountPagination.pageRows.map((account) => <tr className={account.status === "archived" ? "chart-account-row-archived" : ""} key={account.id}><td><Link to={`/accounting/accounts/${account.id}`} className="chart-account-code">{account.code}</Link></td><td><div className="chart-account-name"><Link to={`/accounting/accounts/${account.id}`}><strong>{account.name}</strong></Link><span>{account.description || `${account.code} · ${account.name}`}</span>{account.account_type === "asset" && account.account_class === "bank" && <span className={account.bank_account ? "banking-link-badge is-linked" : "banking-link-badge"}>{account.bank_account ? "Linked to Banking" : "Not linked to Banking"}</span>}</div></td><td><span className={`account-type-badge account-type-${account.account_type}`}>{format(account.account_type)}</span></td><td><span className="chart-account-class">{format(account.account_class)}</span></td><td><div className="chart-account-status-cell"><span className={`chart-account-status chart-account-status-${account.status}`}>{format(account.status)}</span>{account.is_system_account && <span className="chart-account-system-badge">System / Control Account</span>}</div></td><td><div className="chart-account-menu-wrap"><button className="chart-account-menu-button" aria-label={`Actions for ${account.code} · ${account.name}`} aria-expanded={menu === account.id} onClick={() => setMenu(menu === account.id ? "" : account.id)}><Ellipsis size={18}/></button>{menu === account.id && <div className="chart-account-menu"><Link to={`/accounting/accounts/${account.id}`}>View Account Details</Link><Link to={`/accounting/general-ledger?account_id=${account.id}`}>View General Ledger</Link>{auth.hasPermission("manage_accounts") && <button onClick={() => { setModal(account); setMenu(""); }}>Edit Account</button>}{auth.hasPermission("manage_accounts") && !account.is_system_account && <button onClick={() => void changeStatus(account)}>{account.status === "active" ? "Deactivate Account" : "Activate Account"}</button>}</div>}</div></td></tr>)}</tbody></table></div> : <div className="chart-accounts-empty"><Calculator size={30}/><h2>No accounts found</h2><p>{accounts.length ? "Try changing your search or filters." : "Add your first account to start building your chart of accounts."}</p>{!accounts.length && auth.hasPermission("manage_accounts") && <button className="page-primary-button" onClick={() => setModal("new")}>Add Account</button>}</div>}</StatePanel><TablePagination {...accountPagination}/></section>
    {modal && <AccountFormModal key={modal === "new" ? "new" : modal.id} isOpen account={modal === "new" ? null : modal} currency={auth.selectedOrganisation?.base_currency} onClose={() => setModal(null)} onSaved={saved}/>}
    {importing && <AccountImportModal onClose={() => setImporting(false)} onCompleted={async result => { setMessage(`${result.created_account_ids.length} accounts imported successfully.`); await load(); }}/>}</div>;
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
  const money = (value, journal) => formatCurrency(value, journal.organisation?.base_currency, { locale: "en-GB" });
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
  "profit-and-loss": { title: "Profit and Loss", method: "profitLoss", date: "range", className: "profit-loss-page" },
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

const humaniseReportValue = (value) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const reportMoney = (value, currency) => {
  const amount = Number(value || 0);
  if (Math.abs(amount) < 0.005) return "—";
  const formatted = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};
const sumAmounts = (rows) => rows.reduce((total, row) => total + Number(row.amount || 0), 0);
const reportPeriod = (filters) => filters.as_of_date ? `As at ${filters.as_of_date}` : `${filters.start_date || "Beginning"} to ${filters.end_date}`;
const accountRow = (row, report, filters) => {
  const source = report === "profit-and-loss" ? "profit-loss" : report;
  const query = new URLSearchParams({ source, ...(filters.start_date ? { start_date: filters.start_date } : {}), ...(filters.end_date ? { end_date: filters.end_date } : {}), ...(filters.as_of_date ? { as_of_date: filters.as_of_date } : {}), report_amount: String(row.amount) });
  return { kind: "account", label: `${row.account?.code ? `${row.account.code} · ` : ""}${row.account?.name || "Unlabelled account"}`, amount: Number(row.amount || 0), href: report === "cash-flow" ? `/accounting/cash-flow/breakdown/${row.row_key}?${query}` : row.account?.id ? `/accounting/accounts/${row.account.id}?${query}` : null };
};
const group = (heading, rows, totalLabel, total, report, filters, level = "section") => rows.length ? [{ kind: level, label: heading }, ...rows.map((row) => accountRow(row, report, filters)), { kind: "subtotal", label: totalLabel, amount: Number(total) }] : [];

function statementRows(report, data, filters) {
  if (report === "profit-and-loss") {
    const income = (data.income || []).filter((row) => row.account?.account_class !== "other_income");
    const otherIncome = (data.income || []).filter((row) => row.account?.account_class === "other_income");
    const costs = (data.expenses || []).filter((row) => row.account?.account_class === "cost_of_sales");
    const otherExpenses = (data.expenses || []).filter((row) => row.account?.account_class === "other_expense");
    const operating = (data.expenses || []).filter((row) => !["cost_of_sales", "other_expense"].includes(row.account?.account_class));
    const grossProfit = sumAmounts(income) - sumAmounts(costs);
    const operatingProfit = grossProfit - sumAmounts(operating);
    return [
      ...group("Income", income, "Total Income", sumAmounts(income), report, filters),
      ...group("Cost of Sales", costs, "Total Cost of Sales", sumAmounts(costs), report, filters),
      ...(costs.length ? [{ kind: "major-total", label: "Gross Profit", amount: grossProfit }] : []),
      ...group("Operating Expenses", operating, "Total Operating Expenses", sumAmounts(operating), report, filters),
      ...(operating.length ? [{ kind: "major-total", label: "Operating Profit", amount: operatingProfit }] : []),
      ...group("Other Income", otherIncome, "Total Other Income", sumAmounts(otherIncome), report, filters),
      ...group("Other Expenses", otherExpenses, "Total Other Expenses", sumAmounts(otherExpenses), report, filters),
      { kind: "grand-total", label: Number(data.net_profit) < 0 ? "Net Loss" : "Net Profit", amount: Number(data.net_profit || 0) },
    ];
  }
  if (report === "balance-sheet") {
    const currentAssets = (data.assets || []).filter((row) => ["bank", "current_asset", "receivable"].includes(row.account?.account_class));
    const nonCurrentAssets = (data.assets || []).filter((row) => !currentAssets.includes(row));
    const currentLiabilities = (data.liabilities || []).filter((row) => ["current_liability", "payable"].includes(row.account?.account_class));
    const nonCurrentLiabilities = (data.liabilities || []).filter((row) => !currentLiabilities.includes(row));
    return [
      { kind: "section", label: "Assets" },
      ...group("Current Assets", currentAssets, "Total Current Assets", sumAmounts(currentAssets), report, filters, "subsection"),
      ...group("Non-current Assets", nonCurrentAssets, "Total Non-current Assets", sumAmounts(nonCurrentAssets), report, filters, "subsection"),
      { kind: "grand-total", label: "Total Assets", amount: Number(data.total_assets || 0) },
      { kind: "section", label: "Liabilities" },
      ...group("Current Liabilities", currentLiabilities, "Total Current Liabilities", sumAmounts(currentLiabilities), report, filters, "subsection"),
      ...group("Non-current Liabilities", nonCurrentLiabilities, "Total Non-current Liabilities", sumAmounts(nonCurrentLiabilities), report, filters, "subsection"),
      { kind: "major-total", label: "Total Liabilities", amount: Number(data.total_liabilities || 0) },
      ...group("Equity", data.equity || [], "Total Equity", data.total_equity, report, filters),
      { kind: "grand-total", label: "Total Liabilities and Equity", amount: Number(data.total_liabilities_and_equity || 0) },
    ];
  }
  if (report === "cash-flow") return [
    ...group("Cash Flows from Operating Activities", data.operating || [], "Net Cash from Operating Activities", data.total_operating, report, filters),
    ...group("Cash Flows from Investing Activities", data.investing || [], "Net Cash from Investing Activities", data.total_investing, report, filters),
    ...group("Cash Flows from Financing Activities", data.financing || [], "Net Cash from Financing Activities", data.total_financing, report, filters),
    ...group("Unclassified Cash Flows", data.unclassified || [], "Net Unclassified Cash Flow", data.total_unclassified, report, filters),
    { kind: "major-total", label: Number(data.net_cash_flow) < 0 ? "Net Decrease in Cash" : "Net Increase in Cash", amount: Number(data.net_cash_flow || 0) },
    { kind: "subtotal", label: "Opening Cash Balance", amount: Number(data.opening_cash || 0) },
    { kind: "grand-total", label: "Closing Cash Balance", amount: Number(data.closing_cash || 0) },
  ];
  return [];
}

function FinancialStatement({ report, data, filters, organisation, currency }) {
  const isTrial = report === "trial-balance";
  const rows = isTrial ? [] : statementRows(report, data, filters);
  const title = reportDefinitions[report].title;
  const context = new URLSearchParams({ source: "trial-balance", as_of_date: filters.as_of_date || "" });
  const balanced = data.balanced !== false;
  return <article className="financial-statement" aria-label={`${title} report`}>
    <header className="financial-statement-header"><strong>{organisation || "Ledgify"}</strong><h2>{title}</h2><p>{reportPeriod(filters)}</p><div><span>Currency: {currency}</span><span>Generated: {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}</span></div></header>
    <div className="financial-statement-table-wrap"><table className={`financial-statement-table${isTrial ? " is-trial-balance" : ""}`}>
      <thead>{isTrial ? <tr><th>Account Code</th><th>Account Name</th><th>Account Type</th><th className="is-money">Debit</th><th className="is-money">Credit</th></tr> : <tr><th>Line Item or Account</th><th className="is-money">{filters.as_of_date || filters.end_date || "Amount"}</th></tr>}</thead>
      {isTrial ? <><tbody>{(data.rows || []).length ? data.rows.map((row) => <tr className="financial-statement-account" key={row.account.id}><td><Link to={`/accounting/accounts/${row.account.id}?${context}`}>{row.account.code}</Link></td><td><Link to={`/accounting/accounts/${row.account.id}?${context}`}>{row.account.name}</Link></td><td>{humaniseReportValue(row.account.account_type)}</td><td className="is-money">{Number(row.debit) ? reportMoney(row.debit, currency) : ""}</td><td className="is-money">{Number(row.credit) ? reportMoney(row.credit, currency) : ""}</td></tr>) : <tr><td className="financial-statement-empty" colSpan="5">No Trial Balance accounts were found as at this date.</td></tr>}</tbody><tfoot><tr className="financial-statement-grand-total"><td/><td>Total</td><td/><td className="is-money">{reportMoney(data.total_debit, currency)}</td><td className="is-money">{reportMoney(data.total_credit, currency)}</td></tr></tfoot></> : <tbody>{rows.map((row, index) => <tr className={`financial-statement-${row.kind}`} key={`${row.kind}-${row.label}-${index}`}><td>{row.href ? <Link to={row.href}>{row.label}</Link> : row.label}</td><td className="is-money">{row.amount === undefined ? "" : reportMoney(row.amount, currency)}</td></tr>)}</tbody>}
    </table></div>
    <footer className={`financial-statement-balance ${balanced ? "is-balanced" : "is-unbalanced"}`}>{report === "balance-sheet" ? `Total Assets ${balanced ? "=" : "≠"} Total Liabilities + Total Equity` : isTrial ? `${balanced ? "Balanced" : "Out of balance"} · Difference ${reportMoney(data.difference, currency)}` : report === "cash-flow" ? `Opening Cash Balance + Net Movement ${balanced ? "=" : "≠"} Closing Cash Balance` : "Figures are derived from posted ledger activity for the selected period."}</footer>
  </article>;
}

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
  const isStatement = ["profit-and-loss", "trial-balance", "balance-sheet", "cash-flow"].includes(report);
  const currency = auth.selectedOrganisation?.base_currency || "GBP";
  return <div className={definition.className}><PageHeader eyebrow="Financial reports" title={definition.title} description="Review financial performance and position from posted accounting entries." action={<>{auth.hasPermission("use_ai_assistant") && <AskAIButton prompt={`Explain my ${definition.title} for the selected period and highlight anything I should review.`}/>}<ReportExportMenu title={definition.title} rows={exportRows} metadata={{ ...filters, organisation: auth.selectedOrganisation?.name, currency }} disabled={state.loading || Boolean(state.error)}/>{isStatement && <button className="invoice-secondary-button financial-report-print-button" disabled={!data || state.loading || Boolean(state.error)} onClick={() => window.print()}><Printer size={16}/>Print</button>}</>} />
    <div className="invoice-form-card financial-report-filters">{Object.keys(filters).map((field) => field === "account_id" ? <input key={field} type="hidden" value={filters[field]}/> : <label key={field}>{field.replaceAll("_", " ")} <input type="date" value={filters[field]} onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))} /></label>)}<button className="page-primary-button" onClick={load}>Refresh</button></div>
    <StatePanel {...state}>{data && (isStatement ? <FinancialStatement report={report} data={data} filters={filters} organisation={auth.selectedOrganisation?.name} currency={currency}/> : report === "general-ledger" ? <GeneralLedgerDisplay ledgers={Array.isArray(data) ? data : []} filters={filters} currency={currency}/> : <>{data.balanced === false && <div className="invoice-form-alert">This report is out of balance by {displayValue(data.difference)}. Review the underlying posted entries.</div>}{Object.keys(totals).length > 0 && <div className="invoice-form-card report-totals-card"><DataTable reportTable rows={[totals]} /></div>}{sections.map(([name, rows]) => <section className="invoice-form-card report-section" key={name}><h2>{humaniseReportValue(name)}</h2><DataTable reportTable rows={rows} /></section>)}</>)}</StatePanel></div>;
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
