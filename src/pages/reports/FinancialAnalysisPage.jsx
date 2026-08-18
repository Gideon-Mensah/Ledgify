// Present backend-calculated ratios, comparisons, trends, sources, and limitations.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import AskAIButton from "../../components/ai/AskAIButton";
import PageHeader from "../../components/layout/PageHeader";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import { normaliseApiError } from "../../services/apiError";
import { reportService } from "../../services/reportService";
import { useAuth } from "../../store/AuthContext";
import "../../styles/financialAnalysis.css";

const iso = (date) => date.toISOString().slice(0, 10);
const initialDates = () => { const end = new Date(); const start = new Date(end.getFullYear(), 0, 1); const days = Math.round((end - start) / 86400000) + 1; const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1); const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - days + 1); return { start_date: iso(start), end_date: iso(end), comparison_start_date: iso(previousStart), comparison_end_date: iso(previousEnd) }; };
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const value = (item, currency) => item?.value == null ? "Not available" : item.unit === "percent" ? `${item.value}%` : item.unit === "currency" ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(item.value)) : item.unit === "days" ? `${item.value} days` : `${item.value}${item.unit === "times" ? "×" : ""}`;

function RatioCard({ item, currency }) {
  const change = item.change == null ? null : Number(item.change);
  return <article className={`ratio-card${item.status !== "available" ? " is-unavailable" : ""}`}>
    <header><h3>{item.name}</h3>{change !== null && <span className={change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat"}>{change > 0 ? <ArrowUpRight size={15}/> : change < 0 ? <ArrowDownRight size={15}/> : null}{change > 0 ? "+" : ""}{item.change}</span>}</header>
    <strong>{value(item, currency)}</strong>
    {item.comparison_value != null && <small>Previous: {item.unit === "percent" ? `${item.comparison_value}%` : item.comparison_value}</small>}
    <p>{item.interpretation_data?.commentary || item.interpretation_data?.summary || item.reason}</p>
    <details><summary>How this is calculated <ChevronDown size={14}/></summary><div><b>{item.formula}</b><span>Numerator: {item.numerator ?? "—"}</span><span>Denominator: {item.denominator ?? "—"}</span>{item.sources?.map((source) => <Link key={source.path} to={source.path}>{source.name}</Link>)}{item.limitations?.map((note) => <em key={note}>{note}</em>)}</div></details>
  </article>;
}

export default function FinancialAnalysisPage() {
  const auth = useAuth(); const currency = auth.selectedOrganisation?.base_currency || "GBP";
  const [filters, setFilters] = useState(initialDates); const [report, setReport] = useState(null); const [state, setState] = useState({ loading: true, error: "" });
  const [trendKey, setTrendKey] = useState("current_ratio"); const [trend, setTrend] = useState([]);
  const load = useCallback(async () => { setState({ loading: true, error: "" }); try { setReport(await reportService.financialAnalysis(filters)); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, [filters]);
  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => { let active = true; reportService.ratioTrend({ ratio_key: trendKey, start_date: filters.comparison_start_date, end_date: filters.end_date, interval: "month" }).then((data) => active && setTrend(data.points.map((point) => ({ period: point.end_date, value: point.value == null ? null : Number(point.value) })))).catch(() => active && setTrend([])); return () => { active = false; }; }, [filters.comparison_start_date, filters.end_date, trendKey]);
  const allRatios = useMemo(() => report ? ["liquidity", "profitability", "efficiency", "leverage"].flatMap((group) => report[group]) : [], [report]);
  const exportRows = useMemo(() => allRatios.map((item) => ({ ratio: item.name, current_period: item.value, previous_period: item.comparison_value, change: item.change, formula: item.formula, commentary: item.interpretation_data?.commentary || item.interpretation_data?.summary, status: item.status })), [allRatios]);
  const prompt = `Explain the Financial Analysis for ${filters.start_date} to ${filters.end_date}. Use the structured Ledgify ratio report and distinguish facts from interpretation.`;
  return <div className="financial-analysis-page"><PageHeader eyebrow="Reports · Financial Analysis" title="Financial Analysis" description="Analyse liquidity, profitability, efficiency and financial position using key business ratios." action={<div className="financial-analysis-actions">{auth.hasPermission("use_ai_assistant") && <AskAIButton prompt={prompt} label="Ask AI about results"/>}{auth.hasPermission("export_reports") && <ReportExportMenu title="Financial Analysis" rows={exportRows} metadata={{ organisation: auth.selectedOrganisation?.name, ...filters, currency }}/>}</div>}/>
    <section className="financial-analysis-filters"><label>Period start<input type="date" value={filters.start_date} onChange={(event) => setFilters({ ...filters, start_date: event.target.value })}/></label><label>Period end<input type="date" min={filters.start_date} value={filters.end_date} onChange={(event) => setFilters({ ...filters, end_date: event.target.value })}/></label><label>Comparison start<input type="date" value={filters.comparison_start_date} onChange={(event) => setFilters({ ...filters, comparison_start_date: event.target.value })}/></label><label>Comparison end<input type="date" min={filters.comparison_start_date} value={filters.comparison_end_date} onChange={(event) => setFilters({ ...filters, comparison_end_date: event.target.value })}/></label></section>
    {state.error && <div className="invoice-form-alert" role="alert">{state.error}<button className="invoice-secondary-button" onClick={() => void load()}>Try again</button></div>}
    {state.loading && <section className="invoice-form-card">Calculating financial ratios from posted ledger reports…</section>}
    {report && !state.loading && <>
      <section className="financial-analysis-overview">{["current_ratio", "net_profit_margin", "return_on_assets", "receivable_days", "debt_to_equity", "working_capital"].map((key) => { const item = allRatios.find((ratio) => ratio.key === key); return item && <RatioCard key={key} item={item} currency={currency}/>; })}</section>
      {["liquidity", "profitability", "efficiency", "leverage"].map((group) => <section className="financial-analysis-section" key={group}><header><div><h2>{title(group)}</h2><p>{group === "liquidity" ? "Short-term resources and obligations." : group === "profitability" ? "Returns generated from revenue and capital employed." : group === "efficiency" ? "Working-capital and asset utilisation." : "Long-term funding and financial position."}</p></div></header><div className="financial-analysis-grid">{report[group].map((item) => <RatioCard key={item.key} item={item} currency={currency}/>)}</div></section>)}
      <section className="financial-analysis-section"><header><div><h2>Ratio trend</h2><p>Backend-calculated monthly history across the comparison and current periods.</p></div><select value={trendKey} onChange={(event) => setTrendKey(event.target.value)}>{allRatios.filter((item) => item.status === "available").map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}</select></header><div className="ratio-chart"><ResponsiveContainer width="100%" height={280}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period"/><YAxis/><Tooltip/><Line type="monotone" dataKey="value" stroke="#146c94" strokeWidth={2}/></LineChart></ResponsiveContainer></div></section>
      <section className="financial-analysis-section"><header><div><h2>Supporting metrics</h2><p>Operational balances from authoritative aging services.</p></div></header><div className="supporting-metric-grid">{report.supporting_metrics.map((item) => <article key={item.key}><span>{item.name}</span><strong>{value(item, currency)}</strong><Link to={item.sources[0].path}>View {item.sources[0].name}</Link></article>)}</div></section>
      <section className="financial-analysis-method"><BarChart3 size={22}/><div><h2>Methodology and limitations</h2><p>{report.methodology} Average-balance ratios use opening and closing statement positions. All monetary inputs use the organisation’s reporting currency. Unavailable ratios are identified explicitly rather than estimated without reliable classifications.</p></div></section>
    </>}
  </div>;
}
