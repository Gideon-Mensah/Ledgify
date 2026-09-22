import SetupChecklist from '../../components/auth/SetupChecklist';
import { getOrganisationCurrency } from "../../utils/organisationCurrency.js";
import { formatCurrency as centralFormatCurrency } from "../../utils/currency.js";
// Summarise the selected organisation's live financial and operational activity.

import { useEffect, useMemo, useState } from "react";
import { Wallet, Landmark, ReceiptText, TrendingUp, CalendarDays, Activity, AlertCircle, BarChart3 } from "lucide-react";

import SummaryCard from "../../components/dashboard/SummaryCard";
import PageHeader from "../../components/layout/PageHeader";
import AskAIButton from "../../components/ai/AskAIButton";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { normaliseApiError } from "../../services/apiError";
import { bankService } from "../../services/bankService";
import { inventoryService } from "../../services/inventoryService";
import { purchasesApiService } from "../../services/purchasesApiService";
import { reportService } from "../../services/reportService";
import { salesApiService } from "../../services/salesApiService";
import { useAuth } from "../../store/AuthContext";
import { AI_ENABLED } from "../../config/featureFlags";

import "../../styles/dashboard.css";

const isoDate = (date) => date.toISOString().slice(0, 10);
const currency = (value, code) => centralFormatCurrency(value, code || getOrganisationCurrency());
const displayDate = (value) => value ? new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
}).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : "—";

const agingLabels = { current: "Not yet due", "1_30": "1–30 days overdue", "31_60": "31–60 days overdue", "61_90": "61–90 days overdue", "90_plus": "Over 90 days overdue" };

// Bars are presentation only: all displayed values come from the existing reports.
// Signed amounts remain visible; bar lengths compare magnitudes, not a time series.
function AmountBars({ rows, currencyCode, label }) {
  const maximum = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 0);
  return <div className="dashboard-bars" role="group" aria-label={label}>
    {rows.map((row) => <div className={`dashboard-bar-row dashboard-bar-${row.tone || 'primary'}`} key={row.label}>
      <div className="dashboard-bar-label"><span>{row.label}</span><strong>{currency(row.value, currencyCode)}</strong></div>
      <svg className="dashboard-bar-track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect width="100" height="6" rx="1" className="dashboard-bar-background" />
        <rect width={maximum ? Math.abs(Number(row.value) || 0) / maximum * 100 : 0} height="6" rx="1" className="dashboard-bar-fill" />
      </svg>
    </div>)}
    {!rows.length && <p className="dashboard-empty-text">No balances to display.</p>}
  </div>;
}

function DashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const dates = useMemo(() => {
    const end = new Date();
    const month = Number(auth.selectedOrganisation?.financial_year_start_month || 1) - 1;
    const start = new Date(end.getFullYear(), month, 1);
    if (start > end) start.setFullYear(start.getFullYear() - 1);
    return { start: isoDate(start), end: isoDate(end) };
  }, [auth.selectedOrganisation?.financial_year_start_month]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [profitLoss, balanceSheet, receivables, payables, invoices, bills, transactions, movements] = await Promise.all([
          reportService.profitLoss({ start_date: dates.start, end_date: dates.end }),
          reportService.balanceSheet({ as_of_date: dates.end }),
          reportService.agedReceivables({ as_of_date: dates.end }),
          reportService.agedPayables({ as_of_date: dates.end }),
          salesApiService.list(), purchasesApiService.list(), bankService.transactions(), inventoryService.movements(),
        ]);
        if (active) { setData({ profitLoss, balanceSheet, receivables, payables, invoices, bills, transactions, movements }); setState({ loading: false, error: "" }); }
      } catch (error) { if (active) setState({ loading: false, error: normaliseApiError(error, "Dashboard data could not be loaded.") }); }
    }
    void load();
    return () => { active = false; };
  }, [dates]);

  const cashBalance = data?.balanceSheet?.assets?.filter((row) => row.account?.account_class === "bank")
    .reduce((total, row) => total + Number(row.amount || 0), 0) || 0;
  const overdueInvoices = data?.invoices?.filter((row) => Number(row.amountDue) > 0 && row.dueDateIso < dates.end).length || 0;
  const overdueBills = data?.bills?.filter((row) => Number(row.amountDue) > 0 && row.dueDateIso < dates.end).length || 0;
  const activity = useMemo(() => {
    if (!data) return [];
    return [
      ...data.invoices.map((item) => ({ type: "Invoice", reference: item.invoiceNumber, description: item.customer, date: item.issueDateIso, amount: item.total, currency: item.currency })),
      ...data.bills.map((item) => ({ type: "Bill", reference: item.billNumber, description: item.supplier, date: item.issueDateIso, amount: item.total, currency: item.currency })),
      ...data.transactions.map((item) => ({ type: "Bank", reference: item.reference, description: item.description, date: item.transaction_date, amount: item.amount, currency: item.currency })),
      ...data.movements.map((item) => ({ type: "Stock", reference: item.reference, description: item.product?.name, date: item.movement_date, amount: item.total_cost, currency: auth.selectedOrganisation?.base_currency })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [auth.selectedOrganisation?.base_currency, data]);
  const activityPagination = useTablePagination(activity);
  const cards = data ? [
    { title: "Cash balance", value: currency(cashBalance, auth.selectedOrganisation?.base_currency), change: `As at ${displayDate(dates.end)}`, icon: Landmark },
    { title: "Outstanding receivables", value: currency(data.receivables.total_outstanding, auth.selectedOrganisation?.base_currency), change: `${overdueInvoices} overdue invoice${overdueInvoices === 1 ? "" : "s"}`, changeType: overdueInvoices ? "negative" : "neutral", icon: Wallet },
    { title: "Outstanding payables", value: currency(data.payables.total_outstanding, auth.selectedOrganisation?.base_currency), change: `${overdueBills} overdue bill${overdueBills === 1 ? "" : "s"}`, changeType: overdueBills ? "negative" : "neutral", icon: ReceiptText },
    { title: "Net profit", value: currency(data.profitLoss.net_profit, auth.selectedOrganisation?.base_currency), change: `Financial year to date · ${Number(data.profitLoss.net_profit) < 0 ? "Net loss" : "Net profit"}`, changeType: Number(data.profitLoss.net_profit) < 0 ? "negative" : "positive", icon: TrendingUp },
  ] : [];

  const currencyCode = auth.selectedOrganisation?.base_currency || getOrganisationCurrency();
  return <div className="dashboard-page">
    <PageHeader eyebrow="Financial overview" title="Dashboard" description={auth.selectedOrganisation?.name || "Your organisation"}
      action={AI_ENABLED && auth.hasPermission("use_ai_assistant") ? <AskAIButton prompt="Explain the key trends and risks on my dashboard." /> : null} />
    <div className="dashboard-period">
      <div><CalendarDays size={17} aria-hidden="true" /><span><strong>Financial year to date</strong><span>{displayDate(dates.start)} — {displayDate(dates.end)}</span></span></div>
      <span className="dashboard-currency-label">Reporting currency <strong>{currencyCode}</strong></span>
    </div>
    {state.loading && <section className="dashboard-loading" role="status" aria-live="polite" aria-busy="true">
      <p>Loading your financial overview…</p>
      <div className="summary-card-grid" aria-hidden="true">{[0, 1, 2, 3].map(index => <div className="dashboard-skeleton-card" key={index}><span/><strong/><span/></div>)}</div>
      <div className="dashboard-skeleton-panel" aria-hidden="true" />
    </section>}
    {state.error && <div className="dashboard-error" role="alert"><AlertCircle size={22} aria-hidden="true" /><div><h2>Financial overview unavailable</h2><p>{state.error}</p><p>Refresh this page to try again. Your records have not been changed.</p></div></div>}
    {data && <>
      <section className="summary-card-grid" aria-label="Key financial figures">{cards.map(card => <SummaryCard key={card.title} {...card} />)}</section>
      <div className="dashboard-insights-grid">
        <section className="dashboard-panel dashboard-performance-panel" aria-labelledby="dashboard-performance-title">
          <div className="dashboard-panel-header"><div><span className="dashboard-section-label">This financial year</span><h2 id="dashboard-performance-title">Income & expenses</h2><p>{displayDate(dates.start)} — {displayDate(dates.end)}</p></div><BarChart3 size={20} aria-hidden="true" /></div>
          <AmountBars currencyCode={currencyCode} label="Income and expenses for the selected reporting period" rows={[
            { label: 'Revenue', value: data.profitLoss.total_income },
            { label: 'Expenses', value: data.profitLoss.total_expenses, tone: 'expense' },
          ]} />
          <div className="dashboard-profit-line"><span>{Number(data.profitLoss.net_profit) < 0 ? 'Net loss' : 'Net profit'}</span><strong>{currency(data.profitLoss.net_profit, currencyCode)}</strong></div>
          <p className="dashboard-chart-note">Period totals, not a historical trend. Bars compare absolute amounts; negative values retain their sign.</p>
        </section>
        <section className="dashboard-panel dashboard-aging-panel" aria-labelledby="dashboard-aging-title">
          <div className="dashboard-panel-header"><div><span className="dashboard-section-label">Outstanding balances</span><h2 id="dashboard-aging-title">Receivables & payables</h2><p>Aging as at {displayDate(dates.end)} · {currencyCode}</p></div></div>
          <div className="dashboard-aging-columns">{[['Receivables', data.receivables, 'primary'], ['Payables', data.payables, 'expense']].map(([title, report, tone]) => <div key={title}>
            <h3>{title}</h3>
            <AmountBars currencyCode={currencyCode} label={`${title} by days overdue`} rows={Object.entries(report.buckets || {}).map(([name, value]) => ({ label: agingLabels[name] || name.replaceAll('_', ' '), value, tone }))} />
          </div>)}</div>
          <p className="dashboard-chart-note">Each column uses its own scale. Exact balances are shown beside every bar.</p>
        </section>
      </div>
      <section className="dashboard-panel dashboard-activity-panel" aria-labelledby="dashboard-activity-title">
        <div className="dashboard-panel-header"><div><span className="dashboard-section-label">Your records</span><h2 id="dashboard-activity-title">Recent activity</h2><p>Invoices, bills, bank transactions and stock movements, newest first.</p></div><span className="dashboard-record-count">{activity.length} record{activity.length === 1 ? '' : 's'}</span></div>
        {activity.length ? <><div className="dashboard-table-wrapper"><table className="dashboard-table">
          <caption>Recent activity · Amounts in each record’s currency</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Reference</th><th scope="col">Description</th><th scope="col" className="dashboard-amount-column">Amount</th></tr></thead>
          <tbody>{activityPagination.pageRows.map((item, index) => <tr key={`${item.type}-${item.reference}-${index}`}>
            <td data-label="Date">{displayDate(item.date)}</td>
            <td data-label="Type"><span className={`dashboard-activity-badge dashboard-activity-${item.type.toLowerCase()}`}>{item.type}</span></td>
            <td data-label="Reference" className="dashboard-reference">{item.reference || '—'}</td>
            <td data-label="Description">{item.description || '—'}</td>
            <td data-label="Amount" className="dashboard-amount-column"><strong>{currency(item.amount, item.currency)}</strong><span className="dashboard-row-currency">{item.currency || currencyCode}</span></td>
          </tr>)}</tbody>
        </table></div><TablePagination {...activityPagination}/></> : <div className="dashboard-empty"><span className="dashboard-empty-icon"><Activity size={25} aria-hidden="true" /></span><h3>No activity yet</h3><p>Your invoices, bills, bank transactions and stock movements will appear here as you add them.</p></div>}
      </section>
    </>}
    <div className="dashboard-setup"><SetupChecklist/></div>
  </div>;
}

export default DashboardPage;
