// Display dated exchange rates, exposures, and controlled backend revaluations.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, CircleDollarSign, Landmark, RefreshCw, Scale, TrendingUp } from "lucide-react";

import TablePagination from "../../components/common/TablePagination";
import PageHeader from "../../components/layout/PageHeader";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { fxApiService } from "../../services/fxApiService";
import "../../styles/fx.css";

const list = (value) => Array.isArray(value) ? value : value?.results || [];
const today = () => new Date().toISOString().slice(0, 10);
const humanise = (value) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—";
const formatNumber = (value, maximumFractionDigits = 10) => new Intl.NumberFormat("en-GB", { maximumFractionDigits }).format(Number(value || 0));
const formatMoney = (value, currency) => new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(Number(value || 0));

export default function FXPage() {
  const [currencies, setCurrencies] = useState([]);
  const [rates, setRates] = useState([]);
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [exposure, setExposure] = useState({});
  const [state, setState] = useState({ loading: true, error: "", success: "" });
  const [rate, setRate] = useState({ base_currency: "", target_currency: "", rate: "", effective_date: today(), source: "Manual" });
  const [revalue, setRevalue] = useState({ revaluation_type: "receivables", as_of_date: today(), foreign_currency: "", foreign_amount: "", old_base_amount: "", control_account_id: "", gain_account_id: "", loss_account_id: "" });

  const load = useCallback(async () => {
    const [currencyRows, rateRows, revaluations, accountRows, exposureRows] = await Promise.all([
      fxApiService.currencies(),
      fxApiService.rates(),
      fxApiService.revaluations(),
      accountingApiService.accounts({ status: "active" }),
      fxApiService.exposure(),
    ]);
    setCurrencies(list(currencyRows));
    setRates(list(rateRows));
    setRows(list(revaluations));
    setAccounts(list(accountRows));
    setExposure(exposureRows);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load().then(() => setState((current) => ({ ...current, loading: false }))).catch((error) => setState({ loading: false, error: normaliseApiError(error), success: "" }));
    });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const saveRate = async (event) => {
    event.preventDefault();
    setState((current) => ({ ...current, error: "", success: "" }));
    try {
      await fxApiService.createRate(rate);
      await load();
      setRate((current) => ({ ...current, rate: "" }));
      setState({ loading: false, error: "", success: "Exchange rate added successfully." });
    } catch (error) {
      setState({ loading: false, error: normaliseApiError(error), success: "" });
    }
  };

  const run = async (event) => {
    event.preventDefault();
    setState((current) => ({ ...current, error: "", success: "" }));
    try {
      await fxApiService.revalue(revalue);
      await load();
      setState({ loading: false, error: "", success: "FX revaluation posted successfully." });
    } catch (error) {
      setState({ loading: false, error: normaliseApiError(error), success: "" });
    }
  };

  const receivables = list(exposure.receivables);
  const payables = list(exposure.payables);
  const exposureCurrencies = useMemo(() => new Set([...receivables, ...payables].map((item) => item.currency)).size, [payables, receivables]);
  const ratePagination = useTablePagination(rates);
  const revaluationPagination = useTablePagination(rows);

  return <div className="fx-page">
    <PageHeader eyebrow="Accounting" title="Currencies & foreign exchange" description="Maintain dated exchange rates, review foreign-currency exposure, and post controlled revaluations." />

    {state.error && <div className="invoice-form-alert" role="alert">{state.error}</div>}
    {state.success && <div className="fx-success" role="status">{state.success}</div>}

    <section className="fx-summary-grid" aria-label="Foreign exchange summary">
      <article><span className="fx-summary-icon"><CircleDollarSign size={21} /></span><div><span>Functional currency</span><strong>{exposure.base_currency || "—"}</strong><small>Organisation base currency</small></div></article>
      <article><span className="fx-summary-icon"><TrendingUp size={21} /></span><div><span>Active exchange rates</span><strong>{rates.length}</strong><small>Dated, immutable rates</small></div></article>
      <article><span className="fx-summary-icon"><Scale size={21} /></span><div><span>Exposure currencies</span><strong>{exposureCurrencies}</strong><small>Across receivables and payables</small></div></article>
    </section>

    {state.loading ? <section className="fx-loading"><span className="header-spinner" /><h2>Loading currency data</h2><p>Retrieving rates, exposure and revaluation history.</p></section> : <>
      <section className="fx-panel">
        <header className="fx-panel-header"><div><span className="fx-panel-icon"><RefreshCw size={20} /></span><div><h2>Exchange rates</h2><p>Add a new effective-dated rate. Historical rates remain unchanged.</p></div></div><span className="fx-count">{rates.length} rates</span></header>
        <form className="fx-form-grid" onSubmit={saveRate}>
          <label>Transaction currency<select required value={rate.base_currency} onChange={(event) => setRate({ ...rate, base_currency: event.target.value })}><option value="">Select currency</option>{currencies.map((currency) => <option key={currency.code}>{currency.code} — {currency.name}</option>)}</select></label>
          <span className="fx-pair-arrow" aria-hidden="true"><ArrowRight size={18} /></span>
          <label>Base currency<select required value={rate.target_currency} onChange={(event) => setRate({ ...rate, target_currency: event.target.value })}><option value="">Select currency</option>{currencies.map((currency) => <option key={currency.code}>{currency.code} — {currency.name}</option>)}</select></label>
          <label>Exchange rate<input required min="0.0000000001" step="0.0000000001" type="number" value={rate.rate} onChange={(event) => setRate({ ...rate, rate: event.target.value })} placeholder="0.0000000000" /></label>
          <label>Effective date<input required type="date" value={rate.effective_date} onChange={(event) => setRate({ ...rate, effective_date: event.target.value })} /></label>
          <label>Source<input value={rate.source} onChange={(event) => setRate({ ...rate, source: event.target.value })} placeholder="e.g. Manual, central bank" /></label>
          <button className="page-primary-button" type="submit">Add dated rate</button>
        </form>
        {rates.length ? <><div className="fx-table-wrapper"><table className="fx-table"><thead><tr><th>Effective date</th><th>Currency pair</th><th className="fx-number">Rate</th><th>Source</th></tr></thead><tbody>{ratePagination.pageRows.map((item) => <tr key={item.id}><td><span className="fx-date"><CalendarDays size={14} />{formatDate(item.effective_date)}</span></td><td><span className="fx-pair"><strong>{item.base_currency}</strong><ArrowRight size={13} /><strong>{item.target_currency}</strong></span></td><td className="fx-number fx-rate-value">{formatNumber(item.rate)}</td><td>{item.source || "—"}</td></tr>)}</tbody></table></div><TablePagination {...ratePagination} /></> : <div className="fx-empty">No exchange rates have been added yet.</div>}
      </section>

      <section className="fx-panel">
        <header className="fx-panel-header"><div><span className="fx-panel-icon"><Landmark size={20} /></span><div><h2>Foreign-currency exposure</h2><p>Outstanding document values grouped by currency.</p></div></div><span className="fx-base-badge">Base: {exposure.base_currency || "—"}</span></header>
        <div className="fx-exposure-grid">
          <ExposureGroup title="Receivables" rows={receivables} baseCurrency={exposure.base_currency} />
          <ExposureGroup title="Payables" rows={payables} baseCurrency={exposure.base_currency} />
        </div>
      </section>

      <section className="fx-panel">
        <header className="fx-panel-header"><div><span className="fx-panel-icon"><Scale size={20} /></span><div><h2>FX revaluation</h2><p>Calculate the base-currency change and post it through configured ledger accounts.</p></div></div></header>
        <form className="fx-revaluation-form" onSubmit={run}>
          <div className="fx-form-section"><h3>Exposure details</h3><div className="fx-revaluation-grid"><label>Exposure type<select value={revalue.revaluation_type} onChange={(event) => setRevalue({ ...revalue, revaluation_type: event.target.value })}><option value="receivables">Receivables</option><option value="payables">Payables</option><option value="bank">Bank accounts</option></select></label><label>As-of date<input required type="date" value={revalue.as_of_date} onChange={(event) => setRevalue({ ...revalue, as_of_date: event.target.value })} /></label><label>Foreign currency<select required value={revalue.foreign_currency} onChange={(event) => setRevalue({ ...revalue, foreign_currency: event.target.value })}><option value="">Select currency</option>{currencies.map((currency) => <option key={currency.code}>{currency.code}</option>)}</select></label><label>Foreign amount<input required type="number" step="0.01" value={revalue.foreign_amount} onChange={(event) => setRevalue({ ...revalue, foreign_amount: event.target.value })} placeholder="0.00" /></label><label>Current base amount<input required type="number" step="0.01" value={revalue.old_base_amount} onChange={(event) => setRevalue({ ...revalue, old_base_amount: event.target.value })} placeholder="0.00" /></label></div></div>
          <div className="fx-form-section"><h3>Posting accounts</h3><div className="fx-revaluation-grid">{[["control_account_id", "Control account"], ["gain_account_id", "FX gain account"], ["loss_account_id", "FX loss account"]].map(([key, label]) => <label key={key}>{label}<select required value={revalue[key]} onChange={(event) => setRevalue({ ...revalue, [key]: event.target.value })}><option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>)}</div></div>
          <div className="fx-form-actions"><p>A balanced journal will be created using the selected accounts.</p><button className="page-primary-button" type="submit">Post revaluation</button></div>
        </form>
        <div className="fx-history-heading"><div><h3>Revaluation history</h3><p>Previously posted foreign-exchange adjustments.</p></div><span>{rows.length} records</span></div>
        {rows.length ? <><div className="fx-table-wrapper"><table className="fx-table"><thead><tr><th>Date</th><th>Type</th><th>Currency</th><th className="fx-number">Old base value</th><th className="fx-number">New base value</th><th className="fx-number">Gain / loss</th></tr></thead><tbody>{revaluationPagination.pageRows.map((item) => <tr key={item.id}><td>{formatDate(item.as_of_date)}</td><td><span className="fx-type-badge">{humanise(item.revaluation_type)}</span></td><td><strong>{item.foreign_currency}</strong></td><td className="fx-number">{formatMoney(item.old_base_amount, exposure.base_currency)}</td><td className="fx-number">{formatMoney(item.new_base_amount, exposure.base_currency)}</td><td className={`fx-number fx-gain-loss ${Number(item.gain_loss) >= 0 ? "is-gain" : "is-loss"}`}>{formatMoney(item.gain_loss, exposure.base_currency)}</td></tr>)}</tbody></table></div><TablePagination {...revaluationPagination} /></> : <div className="fx-empty">No FX revaluations have been posted.</div>}
      </section>
    </>}
  </div>;
}

function ExposureGroup({ title, rows, baseCurrency }) {
  return <article className="fx-exposure-card"><header><div><span>{title}</span><strong>{rows.length} {rows.length === 1 ? "currency" : "currencies"}</strong></div></header>{rows.length ? <div>{rows.map((item) => <div className="fx-exposure-row" key={`${title}-${item.currency}`}><span className="fx-currency-code">{item.currency}</span><div><span>Outstanding value</span><strong>{formatNumber(item.amount, 2)} {item.currency}</strong></div></div>)}</div> : <div className="fx-exposure-empty">No foreign-currency {title.toLowerCase()}.</div>}<footer>Reported against {baseCurrency || "the functional currency"}</footer></article>;
}
