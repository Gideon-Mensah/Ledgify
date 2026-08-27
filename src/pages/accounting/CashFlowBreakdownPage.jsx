import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, TriangleAlert } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import ReportExportMenu from "../../components/reports/ReportExportMenu";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { normaliseApiError } from "../../services/apiError";
import { reportService } from "../../services/reportService";
import { useAuth } from "../../store/AuthContext";
import { getJournalSourceRoute, journalSourceLabel } from "../../utils/journalSourceRoutes";
import "../../styles/cashFlow.css";

export default function CashFlowBreakdownPage() {
  const { rowKey } = useParams();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const startDate = searchParams.get("start_date") || "";
  const endDate = searchParams.get("end_date") || "";
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const load = useCallback(async () => {
    setState({ loading: true, error: "" });
    try {
      setData(await reportService.cashFlowDrilldown({ row_key: rowKey, start_date: startDate, end_date: endDate }));
      setState({ loading: false, error: "" });
    } catch (error) {
      setState({ loading: false, error: normaliseApiError(error) });
    }
  }, [endDate, rowKey, startDate]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);
  const currency = auth.selectedOrganisation?.base_currency || "GBP";
  const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value || 0));
  const rows = useMemo(() => data?.transactions || [], [data]);
  const cashAccounts = (row) => (row.cash_accounts || []).map((item) => `${item.code} · ${item.name}`).join(", ") || "—";
  const reversal = (row) => row.reversal_of?.entry_number ? `Reverses ${row.reversal_of.entry_number}` : row.reversal_entry?.entry_number ? `Reversed by ${row.reversal_entry.entry_number}` : "—";
  const pagination = useTablePagination(rows);
  const backQuery = new URLSearchParams({ ...(startDate ? { start_date: startDate } : {}), ...(endDate ? { end_date: endDate } : {}) });
  const exportRows = rows.map((row) => ({ report_line: data?.label, period_start: startDate, period_end: endDate, date: row.date, journal: row.journal, journal_status: row.journal_status, reversal: reversal(row), reference: row.reference, source: journalSourceLabel(row.source_type), cash_account: cashAccounts(row), counterpart_account: `${row.account.code} · ${row.account.name}`, cash_flow_category: row.cash_flow_category, description: row.description, cash_in: row.cash_in, cash_out: row.cash_out, net_amount: row.amount }));

  if (state.loading && !data) return <div className="cash-flow-page"><div className="invoice-form-card">Loading Cash Flow breakdown…</div></div>;
  if (!data) return <div className="cash-flow-page"><section className="account-details-state"><TriangleAlert size={32}/><h1>Cash Flow line unavailable</h1><p>{state.error}</p><Link to={`/accounting/cash-flow?${backQuery}`}>Back to Cash Flow</Link></section></div>;
  return <div className="cash-flow-page cash-flow-breakdown-page">
    <header className="account-details-header"><div><Link className="journal-details-back" to={`/accounting/cash-flow?${backQuery}`}><ArrowLeft size={16}/>Back to Cash Flow</Link><span className="journal-details-eyebrow">Cash Flow breakdown</span><h1>{data.label}</h1><p>{startDate || "Beginning"} – {endDate || "Current date"}</p></div><ReportExportMenu title={`${data.label} Cash Flow Breakdown`} rows={exportRows} metadata={{ start_date: startDate, end_date: endDate, report_amount: data.amount }}/></header>
    <section className="cash-flow-breakdown-summary"><span>Selected Cash Flow amount</span><strong>{money(data.amount)}</strong><small>Sum of the classified posted journal allocations below</small></section>
    <section className="invoice-form-card report-section"><h2>Underlying transactions</h2>{rows.length ? <><div className="report-table-wrapper"><table className="report-data-table cash-flow-audit-table"><thead><tr><th>Date</th><th>Journal</th><th>Status / reversal</th><th>Cash or bank account</th><th>Counterpart account</th><th>Category</th><th>Description</th><th className="report-number-column">Amount</th></tr></thead><tbody>{pagination.pageRows.map((row, index) => { const sourceRoute = getJournalSourceRoute(row.source_type, row.source_id); return <tr key={`${row.journal_id}-${index}`}><td>{row.date}</td><td><Link to={`/accounting/journals/${row.journal_id}`}>{row.journal}</Link><small>{sourceRoute ? <Link to={sourceRoute}>{journalSourceLabel(row.source_type)}</Link> : journalSourceLabel(row.source_type)}</small></td><td>{row.journal_status || "—"}<small>{reversal(row)}</small></td><td>{cashAccounts(row)}</td><td>{row.account.code} · {row.account.name}</td><td>{row.cash_flow_category || "—"}</td><td>{row.description || row.reference || "—"}</td><td className="report-number-column">{money(row.amount)}</td></tr>; })}</tbody><tfoot><tr><td colSpan="7">Breakdown total</td><td className="report-number-column">{money(data.amount)}</td></tr></tfoot></table></div><TablePagination {...pagination}/></> : <div className="chart-accounts-empty"><BookOpen size={30}/><h2>No activity</h2><p>No activity for this report line in the selected period.</p></div>}</section>
  </div>;
}
