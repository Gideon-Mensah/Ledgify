// Summarise the selected organisation's live financial and operational activity.

import { useEffect, useMemo, useState } from "react";
import { CirclePoundSterling, Landmark, ReceiptText, TrendingUp } from "lucide-react";

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

import "../../styles/dashboard.css";

const isoDate = (date) => date.toISOString().slice(0, 10);
const currency = (value, code) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: code || "GBP",
}).format(Number(value) || 0);
const displayDate = (value) => value ? new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
}).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : "—";

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
    { title: "Outstanding receivables", value: currency(data.receivables.total_outstanding, auth.selectedOrganisation?.base_currency), change: `${overdueInvoices} overdue invoice${overdueInvoices === 1 ? "" : "s"}`, changeType: overdueInvoices ? "negative" : "positive", icon: CirclePoundSterling },
    { title: "Outstanding payables", value: currency(data.payables.total_outstanding, auth.selectedOrganisation?.base_currency), change: `${overdueBills} overdue bill${overdueBills === 1 ? "" : "s"}`, changeType: overdueBills ? "negative" : "positive", icon: ReceiptText },
    { title: "Net profit", value: currency(data.profitLoss.net_profit, auth.selectedOrganisation?.base_currency), change: `${displayDate(dates.start)} to ${displayDate(dates.end)} · Revenue ${currency(data.profitLoss.total_income, auth.selectedOrganisation?.base_currency)} · Expenses ${currency(data.profitLoss.total_expenses, auth.selectedOrganisation?.base_currency)}`, changeType: Number(data.profitLoss.net_profit) < 0 ? "negative" : "positive", icon: TrendingUp },
  ] : [];

  return <div className="dashboard-page"><PageHeader eyebrow="Overview" title="Dashboard" description={`Financial overview for ${auth.selectedOrganisation?.name || "your organisation"}.`} action={auth.hasPermission("use_ai_assistant") ? <AskAIButton prompt="Explain the key trends and risks on my dashboard." /> : null} />
    {state.loading && <div className="dashboard-panel dashboard-state">Loading your financial overview…</div>}
    {state.error && <div className="invoice-form-alert dashboard-state">{state.error}</div>}
    {data && <><div className="summary-card-grid">{cards.map((card) => <SummaryCard key={card.title} {...card} />)}</div>
      <section className="dashboard-panel dashboard-aging-panel"><div className="dashboard-panel-header"><div><h2>Receivables and payables aging</h2><p>Outstanding balances grouped by age as at {displayDate(dates.end)}.</p></div></div><div className="dashboard-aging-columns"><div><h3>Receivables</h3><div className="dashboard-aging-grid">{Object.entries(data.receivables.buckets || {}).map(([name, value]) => <article key={`ar-${name}`}><span>{name.replaceAll("_", " ")}</span><strong>{currency(value, auth.selectedOrganisation?.base_currency)}</strong></article>)}</div></div><div><h3>Payables</h3><div className="dashboard-aging-grid">{Object.entries(data.payables.buckets || {}).map(([name, value]) => <article key={`ap-${name}`}><span>{name.replaceAll("_", " ")}</span><strong>{currency(value, auth.selectedOrganisation?.base_currency)}</strong></article>)}</div></div></div></section>
      <section className="dashboard-panel dashboard-activity-panel"><div className="dashboard-panel-header"><div><h2>Recent activity</h2><p>Latest invoices, bills, bank transactions, and stock movements.</p></div></div>{activity.length ? <><div className="dashboard-table-wrapper"><table className="dashboard-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th className="dashboard-amount-column">Amount</th></tr></thead><tbody>{activityPagination.pageRows.map((item, index) => <tr key={`${item.type}-${item.reference}-${index}`}><td>{displayDate(item.date)}</td><td><span className={`dashboard-activity-badge dashboard-activity-${item.type.toLowerCase()}`}>{item.type}</span></td><td>{item.reference || "—"}</td><td>{item.description || "—"}</td><td className="dashboard-amount-column">{currency(item.amount, item.currency)}</td></tr>)}</tbody></table></div><TablePagination {...activityPagination}/></> : <p className="dashboard-empty-text">No recent financial activity yet.</p>}</section></>}
  </div>;
}

export default DashboardPage;
