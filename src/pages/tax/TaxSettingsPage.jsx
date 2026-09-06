import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Plus, Search, Settings2, ShieldCheck } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import Modal from "../../components/common/Modal";
import CurrencyOptions from "../../components/common/CurrencyOptions";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { useAuth } from "../../store/AuthContext";
import { api } from "../../services/api";
import { accountingApiService } from "../../services/accountingApiService";
import { taxApiService } from "../../services/taxApiService";
import { normaliseApiError } from "../../services/apiError";
import { formatDisplayDate, getOrganisationToday, isValidIsoDate } from "../../utils/dateUtils.js";
import { taxLabel, validateTaxRate } from "../../utils/taxReport.js";
import "../../styles/taxWorkspace.css";

const blankRate = today => ({ code: "", name: "", rate: "", tax_type: "VAT", scope: "BOTH", status: "ACTIVE", effective_from: today, effective_to: "", input_tax_account: "", output_tax_account: "", recoverable: true });
export default function TaxSettingsPage() {
  const auth = useAuth(), location = useLocation(), selected = auth.selectedOrganisation;
  const organisationId = selected?.id;
  const canManage = auth.hasPermission("manage_tax_rates"), canView = auth.hasPermission("view_tax");
  const [organisation, setOrganisation] = useState(null), [rates, setRates] = useState([]), [accounts, setAccounts] = useState([]);
  const [state, setState] = useState({ loading: true, error: "" }), [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null), [rate, setRate] = useState(null), [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(""), [search, setSearch] = useState("");
  const submitting = useRef(false), generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ loading: true, error: "" });
    try {
      const [org, taxRates, chart] = await Promise.all([api.get(`organisations/${organisationId}/`), taxApiService.rates(), canManage ? accountingApiService.accounts({ status: "active" }) : Promise.resolve([])]);
      if (generation.current === request) { setOrganisation(org); setRates(taxRates); setAccounts(chart); setState({ loading: false, error: "" }); }
    } catch (error) { if (generation.current === request) setState({ loading: false, error: normaliseApiError(error) }); }
  }, [organisationId, canManage]);
  useEffect(() => { const frame = requestAnimationFrame(() => { if (canView) void load(); }); return () => { cancelAnimationFrame(frame); generation.current += 1; }; }, [load, canView]);
  const run = async action => {
    if (submitting.current || !canManage) return;
    submitting.current = true; setSaving(true); setSaveError(""); setNotice("");
    try { await action(); await load(); setNotice("Tax configuration saved."); }
    catch (error) { setSaveError(normaliseApiError(error)); }
    finally { submitting.current = false; setSaving(false); }
  };
  const saveRegistration = event => {
    event.preventDefault();
    void run(async () => {
      const fields = ["tax_registered", "tax_registration_number", "tax_scheme", "tax_reporting_currency", "tax_period_frequency", "tax_effective_date"];
      await api.patch(`organisations/${organisationId}/`, Object.fromEntries(fields.map(key => [key, organisation[key]])));
      await auth.bootstrapAuth();
    });
  };
  const saveRate = event => {
    event.preventDefault(); const error = validateTaxRate(rate); if (error) { setSaveError(error); return; }
    void run(async () => {
      const payload = { ...rate, effective_to: rate.effective_to || null, input_tax_account: rate.input_tax_account || null, output_tax_account: rate.output_tax_account || null };
      if (editing) await taxApiService.updateRate(editing, payload); else await taxApiService.createRate(payload);
      setRate(null); setEditing(null);
    });
  };
  const edit = item => {
    setSaveError(""); setEditing(item?.id || null);
    setRate(item ? Object.fromEntries(Object.keys(blankRate("")).map(key => [key, item[key] ?? ""])) : blankRate(getOrganisationToday(selected?.timezone)));
  };
  const visible = rates.filter(item => `${item.code} ${item.name} ${item.tax_type} ${item.status}`.toLowerCase().includes(search.toLowerCase()));
  const pagination = useTablePagination(visible);
  const date = value => isValidIsoDate(value) ? formatDisplayDate(value, selected?.locale) : "No end date";
  const options = accounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>);
  const change = (key, value) => setRate(current => ({ ...current, [key]: value }));
  if (!canView) return <div className="tax-state">You do not have permission to view tax settings.</div>;
  return <div className="tax-workspace tax-settings"><Link className="tax-back-link" to={`/tax/vat-returns${location.search}`}><ArrowLeft size={16}/>Back to indirect tax</Link><PageHeader eyebrow="Tax configuration" title="Tax settings" description="Keep your registration and tax rates accurate while preserving posted history." action={canManage && <button className="page-primary-button" onClick={() => edit(null)}><Plus size={17}/>Add tax rate</button>}/>
    {notice && <div className="tax-notice" role="status"><ShieldCheck size={18}/>{notice}</div>}{saveError && !rate && !confirm && <div className="tax-state is-error" role="alert">{saveError}</div>}
    {state.loading ? <div className="tax-state" role="status">Loading tax configuration…</div> : state.error ? <div className="tax-state is-error" role="alert"><p>{state.error}</p><button className="invoice-secondary-button" onClick={() => void load()}>Try again</button></div> : <>
      <section className="tax-panel"><header><div><h2>Tax rates</h2><p>{rates.filter(item => item.status === "ACTIVE").length} active · Defaults are assigned on products, not globally.</p></div><label className="tax-search"><span className="tax-visually-hidden">Search tax rates</span><div><Search size={16}/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tax rates"/></div></label></header>{visible.length ? <><div className="tax-table-wrap"><table className="tax-table"><thead><tr><th>Tax name</th><th>Rate</th><th>Type / scope</th><th>Effective dates</th><th>Status</th><th>Default use</th><th>Actions</th></tr></thead><tbody>{pagination.pageRows.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.code}{item.in_use ? " · In use" : ""}</small></td><td>{item.rate}%</td><td>{taxLabel(item.tax_type)}<small>{taxLabel(item.scope)}</small></td><td>{date(item.effective_from)}<small>To {date(item.effective_to)}</small></td><td><span className={`tax-badge ${item.status === "ACTIVE" ? "is-included" : "is-excluded"}`}>{taxLabel(item.status)}</span><small>{item.recoverable ? "Purchase tax recoverable" : "Purchase tax expensed"}</small></td><td>{item.default_usage?.sales_products || item.default_usage?.purchase_products ? <>{item.default_usage.sales_products} sales products<small>{item.default_usage.purchase_products} purchase products</small></> : "Not a product default"}</td><td>{canManage ? <div className="tax-row-actions"><button onClick={() => edit(item)}>Edit</button>{item.status === "ACTIVE" && <button onClick={() => { setSaveError(""); setConfirm(item); }}>Deactivate</button>}</div> : "View only"}</td></tr>)}</tbody></table></div><TablePagination {...pagination}/></> : <div className="tax-state"><Settings2 size={30}/><h3>{search ? "No matching rates" : "Set up your first tax rate"}</h3><p>{search ? "Try a different name, code or status." : "Add the tax rates and control accounts your organisation uses."}</p>{canManage && !search && <button className="page-primary-button" onClick={() => edit(null)}>Add tax rate</button>}</div>}<footer className="tax-panel-note">Used rates are retained for audit history. Deactivate a rate to stop new use; its posted amounts and saved rate snapshots remain unchanged.</footer></section>
      {organisation && <details className="tax-panel tax-registration"><summary><Settings2 size={18}/><strong>Organisation tax registration</strong><span>{organisation.tax_registered ? organisation.tax_registration_number || "Registered" : "Not registered"}</span></summary><form onSubmit={saveRegistration}><fieldset disabled={!canManage || saving}><div className="tax-form-grid"><label className="tax-checkbox"><input type="checkbox" checked={organisation.tax_registered} onChange={event => setOrganisation({ ...organisation, tax_registered: event.target.checked })}/>Tax registered</label><label>Registration number<input value={organisation.tax_registration_number || ""} onChange={event => setOrganisation({ ...organisation, tax_registration_number: event.target.value })}/></label><label>Tax system<input value={organisation.tax_scheme || ""} onChange={event => setOrganisation({ ...organisation, tax_scheme: event.target.value })} placeholder="VAT, GST or sales tax"/></label><label>Configured reporting currency<select value={organisation.tax_reporting_currency || ""} onChange={event => setOrganisation({ ...organisation, tax_reporting_currency: event.target.value })}><CurrencyOptions value={organisation.tax_reporting_currency} blankLabel="Use organisation currency"/></select><small>The indirect tax report uses the organisation base currency.</small></label><label>Period frequency<select value={organisation.tax_period_frequency || ""} onChange={event => setOrganisation({ ...organisation, tax_period_frequency: event.target.value })}><option value="">Not configured</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label><label>Effective date<input type="date" value={organisation.tax_effective_date || ""} onChange={event => setOrganisation({ ...organisation, tax_effective_date: event.target.value || null })}/></label></div>{canManage && <button className="page-primary-button" disabled={saving}>{saving ? "Saving…" : "Save registration"}</button>}</fieldset></form></details>}
    </>}
    <Modal isOpen={Boolean(rate)} title={editing ? "Edit tax rate" : "Add tax rate"} description="Changes apply to future use; posted tax amounts are never recalculated." onClose={() => { if (!saving) setRate(null); }}>{rate && <form onSubmit={saveRate}>{saveError && <p className="tax-inline-error" role="alert">{saveError}</p>}<fieldset disabled={saving}><div className="tax-form-grid"><label>Code<input required maxLength="30" value={rate.code} onChange={event => change("code", event.target.value)}/></label><label>Tax name<input required maxLength="100" value={rate.name} onChange={event => change("name", event.target.value)}/></label><label>Rate (%)<input required type="number" min="0" max="100" step="0.0001" value={rate.rate} onChange={event => change("rate", event.target.value)}/></label><label>Tax type<select value={rate.tax_type} onChange={event => change("tax_type", event.target.value)}>{["VAT", "GST", "SALES_TAX", "OTHER"].map(value => <option key={value} value={value}>{taxLabel(value)}</option>)}</select></label><label>Applies to<select value={rate.scope} onChange={event => change("scope", event.target.value)}>{["BOTH", "SALES", "PURCHASES"].map(value => <option key={value} value={value}>{taxLabel(value)}</option>)}</select></label><label>Status<select value={rate.status} onChange={event => change("status", event.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><label>Effective from<input required type="date" value={rate.effective_from} onChange={event => change("effective_from", event.target.value)}/></label><label>Effective to<input type="date" min={rate.effective_from} value={rate.effective_to || ""} onChange={event => change("effective_to", event.target.value)}/></label><label>Input tax control account<select value={rate.input_tax_account || ""} onChange={event => change("input_tax_account", event.target.value)}><option value="">Select account</option>{options}</select><small>Tracks recoverable tax on purchases.</small></label><label>Output tax control account<select value={rate.output_tax_account || ""} onChange={event => change("output_tax_account", event.target.value)}><option value="">Select account</option>{options}</select><small>Tracks tax collected on sales.</small></label><label className="tax-checkbox"><input type="checkbox" checked={rate.recoverable} onChange={event => change("recoverable", event.target.checked)}/>Purchase tax is recoverable</label></div><div className="tax-form-actions"><button type="button" className="invoice-secondary-button" onClick={() => setRate(null)}>Cancel</button><button className="page-primary-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create tax rate"}</button></div></fieldset></form>}</Modal>
    <Modal isOpen={Boolean(confirm)} title="Deactivate tax rate?" description={confirm?.name} onClose={() => { if (!saving) setConfirm(null); }}><p>This stops new transactions from using the rate. Existing transactions and their posted tax amounts remain unchanged.</p>{saveError && <p role="alert">{saveError}</p>}<div className="tax-form-actions"><button className="invoice-secondary-button" disabled={saving} onClick={() => setConfirm(null)}>Cancel</button><button className="page-primary-button" disabled={saving} onClick={() => void run(async () => { await taxApiService.updateRate(confirm.id, { status: "INACTIVE" }); setConfirm(null); })}>{saving ? "Deactivating…" : "Deactivate rate"}</button></div></Modal>
  </div>;
}
