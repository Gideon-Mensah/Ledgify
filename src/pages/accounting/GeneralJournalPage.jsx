import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, FilterX, Plus, Printer, Search, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { useAuth } from "../../store/AuthContext";
import { formatDisplayDate, formatTimestamp } from "../../utils/dateUtils";
import { generalJournalExportRows, isLedgerEffectiveJournal, journalTotals, orderedJournalLines } from "../../utils/generalJournal";
import { journalSourceLabel } from "../../utils/journalSourceRoutes";
import "../../styles/journals.css";

const humanise = (value) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const sameMoney = (left, right) => Math.abs(left - right) < 0.005;

function JournalGroup({ journal, money }) {
  const lines = orderedJournalLines(journal.lines);
  const totals = journalTotals([journal]); const balanced = sameMoney(totals.debit, totals.credit);
  const reversal = journal.reversal_of || journal.reversal_entry;
  return <tbody className="general-journal-group">
    <tr className="general-journal-identity"><td colSpan="5"><div><Link to={`/accounting/journals/${journal.id}`}>{journal.entry_number}</Link><span className={`journal-status journal-status-${journal.status}`}>{humanise(journal.status)}</span>{journal.reversal_of && <span className="journal-reversal-label">Reversal journal</span>}{journal.reversal_entry && <span className="journal-reversal-label">Reversed</span>}</div><small>Reference: {journal.reference || "—"} · Source: {journalSourceLabel(journal.source_type)} · Created by: {journal.created_by?.name || "—"}{journal.posted_by?.name ? ` · Posted by: ${journal.posted_by.name}` : ""}{reversal ? ` · Linked journal: ${reversal.entry_number}` : ""}</small></td></tr>
    {lines.map((line, index) => { const debit = Number(line.debit || 0); const credit = Number(line.credit || 0); const malformed = debit !== 0 && credit !== 0; return <tr className={`${credit ? "general-journal-credit" : "general-journal-debit"}${malformed ? " is-malformed" : ""}`} key={line.id || index}><td>{index === 0 ? formatDisplayDate(journal.date) : ""}</td><td><Link to={`/accounting/general-ledger?account_id=${line.account?.id}`}>{line.account?.name || "Unknown account"}</Link>{line.description && line.description !== journal.description && <small>{line.description}</small>}{malformed && <em><TriangleAlert size={12}/>Both debit and credit are populated</em>}</td><td>{line.account?.code || "—"}</td><td className="general-journal-amount">{debit ? money(debit) : "—"}</td><td className="general-journal-amount">{credit ? money(credit) : "—"}</td></tr>; })}
    <tr className="general-journal-narration"><td/><td colSpan="4"><strong>Narration:</strong> {journal.description || "No narration provided."}</td></tr>
    <tr className={`general-journal-subtotal ${balanced ? "is-balanced" : "is-unbalanced"}`}><td/><td colSpan="2">{balanced ? "Journal balanced" : "Journal out of balance"}</td><td className="general-journal-amount">{money(totals.debit)}</td><td className="general-journal-amount">{money(totals.credit)}</td></tr>
  </tbody>;
}

function RegisterTable({ journals, money, className = "" }) {
  return <div className={`general-journal-table-wrap ${className}`}><table className="general-journal-table"><caption className="visually-hidden">General Journal register</caption><thead><tr><th>Date</th><th>Particulars</th><th>Post Ref</th><th>Debit</th><th>Credit</th></tr></thead>{journals.map((journal) => <JournalGroup journal={journal} money={money} key={journal.id}/>)}</table></div>;
}

export default function GeneralJournalPage() {
  const auth = useAuth(); const organisation = auth.selectedOrganisation;
  const [journals, setJournals] = useState([]); const [state, setState] = useState({ loading: true, error: "" });
  const [filters, setFilters] = useState({ start: "", end: "", status: "", source: "", account: "", search: "" });
  const load = useCallback(async () => { setState({ loading: true, error: "" }); try { setJournals(await accountingApiService.journals()); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  const sources = useMemo(() => [...new Set(journals.map((row) => row.source_type).filter(Boolean))].sort(), [journals]);
  const accounts = useMemo(() => { const values = new Map(); journals.flatMap((row) => row.lines || []).forEach((line) => line.account?.id && values.set(line.account.id, line.account)); return [...values.values()].sort((a,b) => a.code.localeCompare(b.code)); }, [journals]);
  const filtered = useMemo(() => journals.filter((journal) => {
    const search = filters.search.toLowerCase(); const text = `${journal.entry_number} ${journal.reference || ""} ${journal.description || ""} ${(journal.lines || []).map((line) => `${line.account?.code} ${line.account?.name} ${line.description}`).join(" ")}`.toLowerCase();
    return (!filters.start || journal.date >= filters.start) && (!filters.end || journal.date <= filters.end) && (!filters.status || journal.status === filters.status) && (!filters.source || journal.source_type === filters.source) && (!filters.account || journal.lines?.some((line) => line.account?.id === filters.account)) && (!search || text.includes(search));
  }).sort((a,b) => a.date.localeCompare(b.date) || a.entry_number.localeCompare(b.entry_number)), [filters, journals]);
  const pagination = useTablePagination(filtered); const displayed = journalTotals(filtered); const ledger = journalTotals(filtered.filter(isLedgerEffectiveJournal));
  const difference = displayed.debit - displayed.credit; const currency = organisation?.base_currency || "GBP"; const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value || 0));
  const period = filters.start || filters.end ? `${filters.start ? formatDisplayDate(filters.start) : "Beginning"} – ${filters.end ? formatDisplayDate(filters.end) : "Current date"}` : "All dates";
  const exportRows = useMemo(() => generalJournalExportRows(filtered), [filtered]); const activeFilters = Object.values(filters).some(Boolean);
  const clear = () => setFilters({ start: "", end: "", status: "", source: "", account: "", search: "" });
  const print = () => { if (filtered.length && !state.loading) requestAnimationFrame(() => window.print()); };
  return <div className="journals-page general-journal-page">
    <PageHeader eyebrow="Accounting · Journal register" title="General Journal" description="A chronological register of journal debits, credits, narration and audit identity." action={<div className="general-journal-actions"><button className="invoice-secondary-button" disabled={state.loading || !filtered.length} onClick={print}><Printer size={16}/>Print</button>{auth.hasPermission("export_reports") && <ReportExportMenu title="General Journal" rows={exportRows} metadata={{ organisation: organisation?.name, start_date: filters.start, end_date: filters.end, currency, filters: [filters.status, filters.source, filters.account].filter(Boolean).join(", ") || "All" }} disabled={state.loading || !filtered.length}/>} {auth.hasPermission("create_journal") && <Link className="page-primary-button" to="/accounting/journals/new"><Plus size={16}/>New Journal</Link>}</div>}/>
    <header className="general-journal-report-header"><div><strong>{organisation?.name || "Ledgify"}</strong><h2>General Journal</h2><p>{period}</p></div><dl><div><dt>Currency</dt><dd>{currency}</dd></div><div><dt>Generated</dt><dd>{formatTimestamp(new Date().toISOString(), { timeZone: organisation?.timezone || "UTC" })}</dd></div><div><dt>Filters</dt><dd>{activeFilters ? "Selected filters applied" : "All journals"}</dd></div></dl><span className="general-journal-page-number">Page</span></header>
    <section className="general-journal-filters" aria-label="General Journal filters"><label><span>From</span><input type="date" value={filters.start} onChange={(event) => setFilters({...filters,start:event.target.value})}/></label><label><span>To</span><input type="date" min={filters.start} value={filters.end} onChange={(event) => setFilters({...filters,end:event.target.value})}/></label><label><span>Status</span><select value={filters.status} onChange={(event) => setFilters({...filters,status:event.target.value})}><option value="">All statuses</option>{["draft","awaiting_approval","approved","posted","reversed","rejected","void"].map((value) => <option value={value} key={value}>{humanise(value)}</option>)}</select></label><label><span>Source</span><select value={filters.source} onChange={(event) => setFilters({...filters,source:event.target.value})}><option value="">All sources</option>{sources.map((value) => <option value={value} key={value}>{journalSourceLabel(value)}</option>)}</select></label><label><span>Account</span><select value={filters.account} onChange={(event) => setFilters({...filters,account:event.target.value})}><option value="">All accounts</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label><label className="general-journal-search"><span className="visually-hidden">Search</span><Search size={16}/><input value={filters.search} onChange={(event) => setFilters({...filters,search:event.target.value})} placeholder="Number, reference, narration or account"/></label>{activeFilters && <button className="general-journal-clear" onClick={clear}><FilterX size={15}/>Clear</button>}</section>
    {state.error && <div className="invoice-form-alert" role="alert">{state.error}<button onClick={() => void load()}>Try again</button></div>}
    {state.loading ? <section className="invoice-form-card">Loading the General Journal…</section> : filtered.length ? <><RegisterTable journals={pagination.pageRows} money={money}/><RegisterTable journals={filtered} money={money} className="general-journal-print-register"/><TablePagination {...pagination}/><section className="general-journal-totals"><div><span>Displayed debit</span><strong>{money(displayed.debit)}</strong></div><div><span>Displayed credit</span><strong>{money(displayed.credit)}</strong></div><div className={sameMoney(displayed.debit,displayed.credit) ? "is-balanced" : "is-unbalanced"}><span>Difference</span><strong>{money(difference)}</strong><small>{sameMoney(displayed.debit,displayed.credit) ? "Balanced" : "Out of balance"}</small></div><div><span>Ledger-effective debit / credit</span><strong>{money(ledger.debit)} / {money(ledger.credit)}</strong><small>Posted and reversed journals</small></div></section></> : <section className="chart-accounts-empty"><Calculator size={30}/><h2>No journals match these filters</h2><p>Adjust or clear the filters to view journal entries.</p>{activeFilters && <button className="invoice-secondary-button" onClick={clear}>Clear filters</button>}</section>}
  </div>;
}
