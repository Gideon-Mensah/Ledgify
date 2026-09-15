import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, CircleHelp, FileText, RefreshCw, Search, Settings2, SlidersHorizontal } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import Modal from "../../components/common/Modal";
import TablePagination from "../../components/common/TablePagination";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import { useTablePagination } from "../../hooks/useTablePagination";
import { useAuth } from "../../store/AuthContext";
import { taxApiService } from "../../services/taxApiService";
import { normaliseApiError } from "../../services/apiError";
import { formatCurrency } from "../../utils/currency.js";
import { formatDisplayDate, formatTimestamp, getOrganisationToday, isValidIsoDate } from "../../utils/dateUtils.js";
import { taxExportRows, taxFilters, taxLabel, validateTaxPeriod } from "../../utils/taxReport.js";
import "../../styles/taxWorkspace.css";

const tabs = [["overview", "Overview"], ["output", "Sales / output tax"], ["input", "Purchases / input tax"], ["adjustments", "Adjustments"], ["periods", "Filing periods"]];

export default function VatReturnsPage() {
  const { selectedOrganisation: organisation, hasPermission } = useAuth();
  const savedFilters = useMemo(() => {
    try { return sessionStorage.getItem(`ledgify.tax.filters.${organisation?.id}`) || ""; } catch { return ""; }
  }, [organisation?.id]);
  const [params, setParams] = useSearchParams(savedFilters);
  useEffect(() => { try { sessionStorage.setItem(`ledgify.tax.filters.${organisation?.id}`, params.toString()); } catch { /* Storage may be disabled. */ } }, [params, organisation?.id]);
  const today = getOrganisationToday(organisation?.timezone);
  const filters = useMemo(() => taxFilters(params, today), [params, today]);
  const tab = params.get("tab") || "overview";
  const invalid = validateTaxPeriod(filters);
  const [data, setData] = useState(null), [rates, setRates] = useState([]), [periods, setPeriods] = useState([]);
  const [state, setState] = useState({ loading: true, error: "" }), [reload, setReload] = useState(0), [selected, setSelected] = useState(null);
  const canView = hasPermission("view_tax");
  const queryKey = JSON.stringify(filters);
  useEffect(() => {
    if (!canView || invalid) return;
    const controller = new AbortController();
    async function load() {
      setState({ loading: true, error: "" });
      try {
        const [report, configuredRates, filingPeriods] = await Promise.all([taxApiService.register(JSON.parse(queryKey), { signal: controller.signal }), taxApiService.rates(), taxApiService.periods()]);
        if (!controller.signal.aborted) { setData({ ...report, queryKey, generatedAt: new Date().toISOString() }); setRates(configuredRates); setPeriods(filingPeriods); setState({ loading: false, error: "" }); }
      } catch (error) { if (!controller.signal.aborted) setState({ loading: false, error: normaliseApiError(error) }); }
    }
    void load();
    return () => controller.abort();
  }, [queryKey, reload, canView, invalid, organisation?.id]);
  const update = useCallback((changes) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true }), [setParams]);
  const rows = data?.results || [], summary = data?.summary;
  const pagination = useTablePagination(rows);
  const money = value => formatCurrency(value, organisation?.base_currency, { locale: organisation?.locale });
  const date = value => isValidIsoDate(value) ? formatDisplayDate(value, organisation?.locale) : "—";
  const generated = formatTimestamp(data?.generatedAt || new Date(), { locale: organisation?.locale, timeZone: organisation?.timezone });
  const ready = !invalid && !state.loading && !state.error && data?.queryKey === queryKey && data;
  const settingsLink = `/tax/settings?${params}`;
  const obligations = periods.filter(period => period.payment_due_date && ["OPEN", "PREPARED"].includes(period.status));
  const overdue = obligations.filter(period => period.payment_due_date < today).length;
  const net = Number(summary?.net_tax_due_or_refundable);
  const metadata = { organisation: organisation?.name, currency: organisation?.base_currency, start_date: filters.start_date, end_date: filters.end_date,
    generated, tax_position: summary ? `Output: ${money(summary.output_tax)}; Input: ${money(summary.input_tax)}; Adjustments (included): ${money(summary.adjustments)}; Net payable / (refundable): ${money(summary.net_tax_due_or_refundable)}` : "", filters: [tabs.find(([key]) => key === tab)?.[1], rates.find(rate => rate.id === filters.tax_rate)?.code, filters.source_type, filters.status, filters.inclusion, filters.search].filter(Boolean).join(" · ") };
  const sort = key => update({ ordering: filters.ordering === key ? `-${key}` : key });
  const headers = [["transaction_date", "Date"], ["document_number", "Reference"], ["contact_name", "Customer / supplier"], [null, "Type"], ["net_amount", "Net amount"], [null, "Tax rate"], ["tax_amount", "Tax amount"], ["gross_amount", "Gross amount"], [null, "Treatment"]];
  const table = (items, printable = false) => <table className="tax-table"><thead><tr>{headers.map(([key, label]) => <th key={label} aria-sort={key && filters.ordering.replace("-", "") === key ? filters.ordering.startsWith("-") ? "descending" : "ascending" : undefined}>{key && !printable ? <button onClick={() => sort(key)}>{label}<span aria-hidden="true">↕</span></button> : label}</th>)}</tr></thead><tbody>{items.map(row => <tr key={row.id}><td>{date(row.transaction_date)}</td><td>{printable ? row.document_number : <button className="tax-reference" onClick={() => setSelected(row)}>{row.document_number}</button>}</td><td>{row.contact_name}</td><td>{taxLabel(row.source_type)}{row.is_reversal && <small>Reversal</small>}</td><td className="tax-money">{money(row.net_amount)}</td><td>{row.tax_rate_code}<small>{row.tax_rate_percent}%</small></td><td className="tax-money">{money(row.tax_amount)}</td><td className="tax-money">{money(row.gross_amount)}</td><td><span className={`tax-badge is-${row.inclusion}`}>{taxLabel(row.inclusion)}</span><small>{row.is_reversal ? "Reversal adjustment" : row.journal_status === "reversed" ? "Reversed original" : row.journal_status === "void" ? "Voided journal" : taxLabel(row.status)}</small></td></tr>)}</tbody><tfoot><tr><th colSpan="4">Included totals · all {rows.length} filtered rows</th><td className="tax-money">{money(summary?.net_amount)}</td><td/><td className="tax-money">{money(summary?.tax_amount)}</td><td className="tax-money">{money(summary?.gross_amount)}</td><td/></tr></tfoot></table>;
  if (!canView) return <div className="tax-state" role="status">You do not have permission to view tax reports.</div>;
  return <div className="tax-workspace">
    <PageHeader eyebrow="Tax workspace" title="Indirect tax" description="Understand your tax position, review activity and prepare for each reporting period." action={<><Link className="invoice-secondary-button" to={settingsLink}><Settings2 size={16}/>Tax settings</Link><ReportExportMenu printOnly title="Indirect Tax Report" rows={ready ? taxExportRows(rows, summary, rates) : []} metadata={metadata} disabled={!ready}/>{hasPermission("export_reports") && <ReportExportMenu title="Indirect Tax Report" rows={ready ? taxExportRows(rows, summary, rates) : []} metadata={metadata} disabled={!ready}/>}</>}/>
    <section className="tax-period-bar" aria-label="Reporting period"><div><CalendarDays size={20}/><strong>Reporting period</strong></div><label>Configured period<select value={params.get("period") || ""} onChange={event => { const period = periods.find(item => item.id === event.target.value); update({ period: period?.id || "", ...(period ? { start_date: period.start_date, end_date: period.end_date } : {}) }); }}><option value="">Custom dates</option>{periods.map(period => <option key={period.id} value={period.id}>{date(period.start_date)} – {date(period.end_date)}</option>)}</select></label><label>From<input type="date" value={filters.start_date} onChange={event => update({ start_date: event.target.value, period: "" })}/></label><label>To<input type="date" value={filters.end_date} onChange={event => update({ end_date: event.target.value, period: "" })}/></label><button className="invoice-secondary-button" onClick={() => setReload(value => value + 1)} disabled={state.loading}><RefreshCw size={15}/>Refresh</button></section>
    <nav className="tax-tabs" aria-label="Tax views">{tabs.map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => update({ tab: key })}>{label}</button>)}</nav>
    {tab !== "periods" && <div className="tax-filters"><label className="tax-search"><span>Search records</span><div><Search size={16}/><input type="search" placeholder="Reference, contact or tax code" value={filters.search} onChange={event => update({ search: event.target.value })}/></div></label><label>Tax rate<select value={filters.tax_rate} onChange={event => update({ tax_rate: event.target.value })}><option value="">All rates</option>{rates.map(rate => <option key={rate.id} value={rate.id}>{rate.code} · {rate.rate}%</option>)}</select></label><label>Transaction type<select value={filters.source_type} onChange={event => update({ source_type: event.target.value })}><option value="">All types</option>{["invoice", "bill", "customer_credit", "supplier_credit", "manual_adjustment"].map(type => <option key={type} value={type}>{taxLabel(type)}</option>)}</select></label><label>Record status<select value={filters.status} onChange={event => update({ status: event.target.value })}><option value="">All statuses</option><option value="POSTED">Posted</option><option value="ADJUSTMENT">Adjustment</option></select></label><label>Inclusion<select value={filters.inclusion} onChange={event => update({ inclusion: event.target.value })}><option value="">All treatments</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="awaiting">Awaiting inclusion</option></select></label><button className="invoice-secondary-button" onClick={() => update({ search: "", tax_rate: "", source_type: "", status: "", inclusion: "" })}>Clear filters</button></div>}
    {(invalid || state.error) ? <div className="tax-state is-error" role="alert"><strong>Tax report could not be loaded</strong><p>{invalid || state.error}</p>{!invalid && <button className="invoice-secondary-button" onClick={() => setReload(value => value + 1)}>Try again</button>}</div> : state.loading ? <div className="tax-state" role="status"><span className="header-spinner"/>Loading your tax position…</div> : ready && <>
      <section className="tax-summary-grid" aria-label="Tax summary"><article><span className="tax-card-icon"><ArrowUpRight/></span><span>Tax collected on sales</span><strong>{money(summary.output_tax)}</strong><small>Output tax, after credits and reversals</small></article><article><span className="tax-card-icon"><ArrowDownLeft/></span><span>Recoverable purchase tax</span><strong>{money(summary.input_tax)}</strong><small>Input tax, after credits and reversals</small></article><article><span className="tax-card-icon"><SlidersHorizontal/></span><span>Adjustments to net tax</span><strong>{money(summary.adjustments)}</strong><small>Already included in output and input tax</small></article><article className={`tax-net-card ${net < 0 ? "is-refundable" : "is-payable"}`}><span className="tax-card-icon">{net < 0 ? <ArrowDownLeft/> : <ArrowUpRight/>}</span><span>{net < 0 ? "Net tax refundable" : net > 0 ? "Net tax payable" : "No net tax due"}</span><strong>{money(summary.net_tax_due_or_refundable)}</strong><small>For the selected period and filters</small></article></section>
      <div className="tax-explanation"><CircleHelp size={18}/><p><strong>How this is calculated:</strong> output tax minus recoverable input tax equals your net tax position. Credits, reversal entries and recorded adjustments are already included. A negative result is refundable.</p></div>
      {obligations.length > 0 && <div className="tax-obligations"><CalendarDays size={18}/><span><strong>{overdue ? `${overdue} open period${overdue === 1 ? "" : "s"} past the due date` : `${obligations.length} upcoming period deadline${obligations.length === 1 ? "" : "s"}`}</strong> · Due dates are configured reminders; payment and submission are not tracked here.</span><button onClick={() => update({ tab: "periods" })}>View periods</button></div>}
      {tab === "periods" ? <section className="tax-panel"><header><h2>Tax returns and filing periods</h2><p>Configured reporting windows. Electronic filing and finalisation are not available.</p></header>{periods.length ? <div className="tax-table-wrap"><table className="tax-table"><thead><tr><th>Period</th><th>Status</th><th>Payment due</th><th>Review</th></tr></thead><tbody>{periods.map(period => <tr key={period.id}><td>{date(period.start_date)} – {date(period.end_date)}</td><td><span className="tax-badge">{taxLabel(period.status)}</span></td><td>{date(period.payment_due_date)}</td><td><button className="tax-reference" onClick={() => update({ period: period.id, start_date: period.start_date, end_date: period.end_date, tab: "overview" })}>Review activity</button></td></tr>)}</tbody></table></div> : <div className="tax-state"><CalendarDays/><h3>No filing periods configured</h3><p>Use custom reporting dates to review your posted tax activity.</p></div>}</section> : <section className="tax-panel"><header><div><h2>Tax activity</h2><p>{rows.length} records · {metadata.currency} · Select a reference to inspect its recorded calculation.</p></div><span className="tax-badge">Posted tax ledger</span></header>

        {rows.length ? <><div className="tax-table-wrap">{table(pagination.pageRows)}</div><TablePagination {...pagination}/></> : <div className="tax-state"><FileText size={32}/><h3>No tax activity for this selection</h3><p>Try another period or clear your filters. Tax records appear when eligible documents are posted.</p><div><Link to={settingsLink}>Configure tax rates</Link><Link to="/sales/invoices/new">Create an invoice</Link></div></div>}
        <footer className="tax-panel-note">This is an accrual tax ledger: draft and voided documents without tax postings are absent, payments do not create duplicate tax, and non-recoverable purchase tax remains an expense. Inclusion means eligible for this preview, not submitted to an authority.</footer>
      </section>}
      <section className="tax-print-report"><header><strong>{organisation?.name}</strong><h1>Indirect Tax Report</h1><p>{date(filters.start_date)} – {date(filters.end_date)}</p><p>Currency: {metadata.currency} · Generated: {generated}</p><p>Filters: {metadata.filters}</p></header>{table(rows, true)}<p>Output tax: {money(summary.output_tax)} · Recoverable input tax: {money(summary.input_tax)} · Net {net < 0 ? "refundable" : "payable"}: {money(summary.net_tax_due_or_refundable)}</p><p>Adjustments are already included. Excluded and awaiting entries are omitted from totals. This report is a preview, not a filed return.</p></section>
    </>}
    <Modal isOpen={Boolean(selected)} title="Tax transaction detail" description={selected?.document_number} onClose={() => setSelected(null)}>{selected && <div className="tax-detail"><dl>{[["Contact", selected.contact_name], ["Date", date(selected.transaction_date)], ["Recorded net", money(selected.net_amount)], ["Tax rate snapshot", `${selected.tax_rate_code} · ${selected.tax_rate_percent}%`], ["Recorded tax", money(selected.tax_amount)], ["Recorded gross", money(selected.gross_amount)], ["Direction", taxLabel(selected.direction)], ["Treatment", `${taxLabel(selected.inclusion)}${selected.is_reversal ? " · Reversal" : ""}`], ["Journal status", taxLabel(selected.journal_status)], ["Original currency", selected.source_currency], ["Posted exchange rate", selected.exchange_rate]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>Tax is calculated on document lines after discounts, with inclusive or exclusive pricing and posting rounding. These are the saved amounts, translated using the stored posting exchange rate. Credits reduce their original tax direction; reversals offset it on the reversal date.</p><Link to={`/accounting/journals/${selected.journal_id}`}>View journal {selected.journal_number}</Link></div>}</Modal>
  </div>;
}
