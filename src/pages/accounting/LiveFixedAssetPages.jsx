// Manage asset registration, depreciation, activation, and journal-linked asset history.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Calculator, CircleDollarSign, PackageCheck, WalletCards, X } from "lucide-react";
import AskAIButton from "../../components/ai/AskAIButton";
import PageHeader from "../../components/layout/PageHeader";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { accountingApiService } from "../../services/accountingApiService";
import { normaliseApiError } from "../../services/apiError";
import { fixedAssetApiService } from "../../services/fixedAssetApiService";
import { useAuth } from "../../store/AuthContext";
import "../../styles/fixedAssets.css";

const today = () => new Date().toISOString().slice(0, 10);
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const show = (value) => value == null || value === "" ? "—" : typeof value === "object" ? value.name || value.code || value.id || "—" : String(value);
const accountName = (value) => typeof value === "object" ? `${value.code || ""} ${value.name || ""}`.trim() : show(value);

function Status({ value }) { return <span className={`fixed-assets-status is-${value}`}>{title(value)}</span>; }
function State({ loading, error, children }) {
  if (loading) return <section className="fixed-assets-panel fixed-assets-empty">Loading fixed assets…</section>;
  if (error) return <div className="invoice-form-alert" role="alert">{error}</div>;
  return children;
}
function AssetTable({ rows, currency, categories }) {
  const pagination = useTablePagination(rows);
  if (!rows.length) return <div className="fixed-assets-empty">No fixed assets have been added yet.</div>;
  const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value || 0));
  return <><div className="fixed-assets-table-wrapper"><table className="fixed-assets-table"><thead><tr><th>Asset number</th><th>Asset name</th><th>Category</th><th>Purchase date</th><th>In service</th><th className="is-numeric">Cost</th><th className="is-numeric">Accumulated depreciation</th><th className="is-numeric">Net book value</th><th>Status</th><th>Actions</th></tr></thead><tbody>{pagination.pageRows.map((row) => <tr key={row.id}><td><Link to={`/fixed-assets/${row.id}`}>{row.asset_number}</Link></td><td>{row.asset_name}</td><td>{categories.find((item) => item.id === row.asset_category)?.name || show(row.asset_category)}</td><td>{row.purchase_date}</td><td>{row.in_service_date}</td><td className="is-numeric">{money(row.cost)}</td><td className="is-numeric">{money(row.accumulated_depreciation)}</td><td className="is-numeric"><strong>{money(row.net_book_value)}</strong></td><td><Status value={row.status}/></td><td><Link className="invoice-secondary-button" to={`/fixed-assets/${row.id}`}>View</Link></td></tr>)}</tbody></table></div><TablePagination {...pagination}/></>;
}
function AccountSelect({ name, value, onChange, accounts }) { return <select required name={name} value={value} onChange={onChange}><option value="">Select account</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>; }

function NewAssetForm({ accounts, categories, currency, form, setForm, onCancel, onSubmit, saving, error }) {
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const selectCategory = (event) => {
    const selected = categories.find((item) => item.id === event.target.value);
    setForm((current) => ({
      ...current,
      asset_category: event.target.value,
      useful_life_months: selected?.default_useful_life_months || current.useful_life_months,
      depreciation_method: selected?.default_depreciation_method || current.depreciation_method,
      asset_account: selected?.default_asset_account || current.asset_account,
      accumulated_depreciation_account: selected?.default_accumulated_depreciation_account || current.accumulated_depreciation_account,
      depreciation_expense_account: selected?.default_depreciation_expense_account || current.depreciation_expense_account,
    }));
  };
  return <form onSubmit={onSubmit}>
    <div className="fixed-assets-modal-body">
      {error && <div className="invoice-form-alert" role="alert">{error}</div>}
      <section className="fixed-assets-form-section">
        <div className="fixed-assets-form-section-heading"><h3>Asset information</h3><p>Identify the asset and assign it to a configured category.</p></div>
        <div className="fixed-assets-form-grid">
          <label className="fixed-assets-form-field"><span>Asset number <strong>*</strong></span><input required autoFocus name="asset_number" value={form.asset_number} onChange={update} placeholder="FA-0001" /></label>
          <label className="fixed-assets-form-field"><span>Asset name <strong>*</strong></span><input required name="asset_name" value={form.asset_name} onChange={update} placeholder="e.g. Delivery van" /></label>
          <label className="fixed-assets-form-field"><span>Category <strong>*</strong></span><select required name="asset_category" value={form.asset_category} onChange={selectCategory}><option value="">Select category</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="fixed-assets-form-field"><span>Depreciation method <strong>*</strong></span><select required name="depreciation_method" value={form.depreciation_method} onChange={update}><option value="straight_line">Straight line</option><option value="reducing_balance">Reducing balance</option></select></label>
          <label className="fixed-assets-form-field is-full-width"><span>Description</span><textarea name="description" rows="3" value={form.description} onChange={update} placeholder="Optional asset description, location or identifying details" /></label>
        </div>
      </section>
      <section className="fixed-assets-form-section">
        <div className="fixed-assets-form-section-heading"><h3>Acquisition and depreciation</h3><p>Enter the accounting cost, expected residual value and service dates.</p></div>
        <div className="fixed-assets-form-grid">
          <label className="fixed-assets-form-field"><span>Purchase date <strong>*</strong></span><input required name="purchase_date" type="date" value={form.purchase_date} onChange={update} /></label>
          <label className="fixed-assets-form-field"><span>In-service date <strong>*</strong></span><input required min={form.purchase_date} name="in_service_date" type="date" value={form.in_service_date} onChange={update} /></label>
          <label className="fixed-assets-form-field"><span>Cost <strong>*</strong></span><div className="fixed-assets-money-input"><span>{currency}</span><input required min="0.01" step="0.01" name="cost" type="number" value={form.cost} onChange={update} placeholder="0.00" /></div></label>
          <label className="fixed-assets-form-field"><span>Residual value <strong>*</strong></span><div className="fixed-assets-money-input"><span>{currency}</span><input required min="0" max={form.cost || undefined} step="0.01" name="residual_value" type="number" value={form.residual_value} onChange={update} /></div></label>
          <label className="fixed-assets-form-field"><span>Useful life <strong>*</strong></span><div className="fixed-assets-years-input"><input required min="1" step="1" name="useful_life_months" type="number" value={form.useful_life_months} onChange={update} /><span>months</span></div></label>
        </div>
      </section>
      <section className="fixed-assets-form-section">
        <div className="fixed-assets-form-section-heading"><h3>Accounting accounts</h3><p>Category defaults are applied automatically and can be adjusted for this asset.</p></div>
        <div className="fixed-assets-form-grid">
          {[['asset_account','Asset account'],['accumulated_depreciation_account','Accumulated depreciation'],['depreciation_expense_account','Depreciation expense']].map(([name,label]) => <label className={`fixed-assets-form-field${name === 'depreciation_expense_account' ? ' is-full-width' : ''}`} key={name}><span>{label} <strong>*</strong></span><AccountSelect name={name} accounts={accounts} value={form[name]} onChange={update}/></label>)}
        </div>
      </section>
    </div>
    <footer className="fixed-assets-modal-footer"><button type="button" className="invoice-secondary-button" disabled={saving} onClick={onCancel}>Cancel</button><button disabled={saving} className="page-primary-button" type="submit">{saving ? "Creating…" : "Create draft asset"}</button></footer>
  </form>;
}

export function LiveFixedAssetsPage() {
  const auth = useAuth(); const currency = auth.selectedOrganisation?.base_currency || "GBP";
  const [assets, setAssets] = useState([]); const [categories, setCategories] = useState([]); const [accounts, setAccounts] = useState([]);
  const [state, setState] = useState({ loading: true, error: "" }); const [message, setMessage] = useState(""); const [panel, setPanel] = useState(""); const [assetAction, setAssetAction] = useState({ saving: false, error: "" });
  const [category, setCategory] = useState({ name: "", description: "", default_useful_life_months: 60, default_depreciation_method: "straight_line", default_asset_account: "", default_accumulated_depreciation_account: "", default_depreciation_expense_account: "" });
  const [form, setForm] = useState({ asset_number: "", asset_name: "", description: "", asset_category: "", purchase_date: today(), in_service_date: today(), cost: "", residual_value: "0", useful_life_months: 60, depreciation_method: "straight_line", asset_account: "", accumulated_depreciation_account: "", depreciation_expense_account: "" });
  const load = useCallback(async () => { setState({ loading: true, error: "" }); try { const [items, groups, ledgers] = await Promise.all([fixedAssetApiService.assets(), fixedAssetApiService.categories(), accountingApiService.accounts({ status: "active" })]); setAssets(items); setCategories(groups); setAccounts(ledgers); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  const totals = useMemo(() => assets.reduce((result, item) => ({ cost: result.cost + Number(item.cost || 0), depreciation: result.depreciation + Number(item.accumulated_depreciation || 0), nbv: result.nbv + Number(item.net_book_value || 0) }), { cost: 0, depreciation: 0, nbv: 0 }), [assets]);
  const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  const saveCategory = async (event) => { event.preventDefault(); try { await fixedAssetApiService.createCategory(category); setMessage("Asset category created."); setPanel(""); await load(); } catch (error) { setMessage(normaliseApiError(error)); } };
  const saveAsset = async (event) => { event.preventDefault(); setAssetAction({ saving: true, error: "" }); try { await fixedAssetApiService.createAsset(form); setMessage("Draft fixed asset created."); setPanel(""); setAssetAction({ saving: false, error: "" }); setForm({ asset_number: "", asset_name: "", description: "", asset_category: "", purchase_date: today(), in_service_date: today(), cost: "", residual_value: "0", useful_life_months: 60, depreciation_method: "straight_line", asset_account: "", accumulated_depreciation_account: "", depreciation_expense_account: "" }); await load(); } catch (error) { setAssetAction({ saving: false, error: normaliseApiError(error) }); } };
  const change = (setter) => (event) => setter((value) => ({ ...value, [event.target.name]: event.target.value }));
  const canManage = auth.hasPermission("manage_fixed_assets");
  return <div className="fixed-assets-page"><PageHeader eyebrow="Fixed Assets" title="Asset register" description="Track acquisition cost, depreciation, net book value and accounting status." action={<div className="fixed-assets-header-actions">{auth.hasPermission("use_ai_assistant") && <AskAIButton prompt="Review my fixed asset register and identify fully depreciated assets or unusual valuation changes."/>}<Link className="invoice-secondary-button" to="/settings/fixed-assets">Asset settings</Link><Link className="invoice-secondary-button" to="/fixed-assets/depreciation">Depreciation</Link>{canManage && <button className="page-primary-button" onClick={() => setPanel("asset")}>New asset</button>}</div>}/>
    {message && <div className="fixed-assets-message is-success">{message}</div>}
    <div className="fixed-assets-summary-grid">{[[PackageCheck,"Assets",assets.length],[WalletCards,"Total cost",money(totals.cost)],[Calculator,"Accumulated depreciation",money(totals.depreciation)],[CircleDollarSign,"Net book value",money(totals.nbv)]].map(([Icon,label,value]) => <article className="fixed-assets-summary-card" key={label}><div className="fixed-assets-summary-icon"><Icon size={20}/></div><div><span>{label}</span><strong>{value}</strong></div></article>)}</div>
    <State {...state}><section className="fixed-assets-panel"><div className="fixed-assets-section-header"><div><h2>Asset register</h2><p>All assets in the selected organisation.</p></div><div className="table-actions">{canManage && <button className="invoice-secondary-button" onClick={() => setPanel("category")}>New category</button>}<ReportExportMenu title="Fixed Asset Register" rows={assets}/></div></div><AssetTable rows={assets} currency={currency} categories={categories}/></section>
      <section className="fixed-assets-panel"><div className="fixed-assets-section-header"><div><h2>Categories</h2><p>Configured lives, methods, and default ledger accounts.</p></div></div><div className="fixed-assets-category-grid">{categories.map((item) => <article key={item.id}><strong>{item.name}</strong><span>{item.default_useful_life_months} months · {title(item.default_depreciation_method)}</span></article>)}</div></section></State>
    {panel && <div className="fixed-assets-modal-overlay" role="presentation" onMouseDown={() => !assetAction.saving && setPanel("")}>
      <section className="fixed-assets-modal" role="dialog" aria-modal="true" aria-label={panel === "asset" ? "New fixed asset" : "New asset category"} onMouseDown={(event) => event.stopPropagation()}>
        <div className="fixed-assets-modal-header"><div><span>Fixed asset register</span><h2>{panel === "asset" ? "New fixed asset" : "New asset category"}</h2></div><button type="button" className="fixed-assets-modal-close" disabled={assetAction.saving} onClick={() => setPanel("")} aria-label="Close"><X size={19}/></button></div>
        {panel === "asset" ? <NewAssetForm accounts={accounts} categories={categories} currency={currency} form={form} setForm={setForm} onCancel={() => setPanel("")} onSubmit={saveAsset} saving={assetAction.saving} error={assetAction.error}/> : <form onSubmit={saveCategory}><div className="fixed-assets-modal-body"><section className="fixed-assets-form-section"><div className="fixed-assets-form-section-heading"><h3>Category defaults</h3><p>These values will prefill new assets assigned to this category.</p></div><div className="fixed-assets-form-grid"><label className="fixed-assets-form-field"><span>Name <strong>*</strong></span><input required name="name" value={category.name} onChange={change(setCategory)}/></label><label className="fixed-assets-form-field"><span>Useful life <strong>*</strong></span><div className="fixed-assets-years-input"><input required min="1" name="default_useful_life_months" type="number" value={category.default_useful_life_months} onChange={change(setCategory)}/><span>months</span></div></label>{[["default_asset_account","Asset account"],["default_accumulated_depreciation_account","Accumulated depreciation"],["default_depreciation_expense_account","Depreciation expense"]].map(([name,label]) => <label className="fixed-assets-form-field" key={name}><span>{label} <strong>*</strong></span><AccountSelect name={name} accounts={accounts} value={category[name]} onChange={change(setCategory)}/></label>)}</div></section></div><footer className="fixed-assets-modal-footer"><button type="button" className="invoice-secondary-button" onClick={() => setPanel("")}>Cancel</button><button className="page-primary-button">Create category</button></footer></form>}
      </section>
    </div>}
  </div>;
}

export function LiveDepreciationPage() {
  const auth = useAuth(); const [period, setPeriod] = useState(today()); const [rows, setRows] = useState([]); const [state, setState] = useState({ loading: true, error: "" }); const [message, setMessage] = useState("");
  const load = useCallback(async () => { try { setRows(await fixedAssetApiService.schedules()); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  const run = async () => { try { const posted = await fixedAssetApiService.runDepreciation({ period }); setMessage(`${posted.length} depreciation schedule(s) posted.`); await load(); } catch (error) { setMessage(normaliseApiError(error)); } };
  return <div className="fixed-assets-page"><PageHeader eyebrow="Fixed Assets" title="Depreciation" description="Review schedules and post accounting depreciation into an open period." action={<div className="fixed-assets-header-actions">{auth.hasPermission("use_ai_assistant") && <AskAIButton prompt="Explain recent fixed asset depreciation and net book value changes."/>}<Link className="invoice-secondary-button" to="/fixed-assets">Asset register</Link><ReportExportMenu title="Depreciation Schedule" rows={rows} metadata={{ posting_date: period }}/></div>}/>{message && <div className="fixed-assets-message is-success">{message}</div>}{auth.hasPermission("run_depreciation") && <section className="fixed-assets-panel"><div className="fixed-assets-section-header"><div><h2>Run depreciation</h2><p>Locked periods and duplicate schedules remain protected by the accounting service.</p></div><div className="fixed-assets-run-controls"><input type="date" value={period} onChange={(event) => setPeriod(event.target.value)}/><button className="page-primary-button" onClick={() => void run()}>Run depreciation</button></div></div></section>}<State {...state}><section className="fixed-assets-panel"><div className="fixed-assets-section-header"><div><h2>Posted depreciation</h2><p>Journal-linked depreciation schedule history.</p></div></div>{rows.length ? <div className="fixed-assets-table-wrapper"><table className="fixed-assets-table"><thead><tr><th>Period</th><th>Asset</th><th className="is-numeric">Depreciation</th><th className="is-numeric">Book value before</th><th className="is-numeric">Book value after</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.period}</td><td>{row.asset_name}</td><td className="is-numeric">{row.depreciation_amount}</td><td className="is-numeric">{row.book_value_before}</td><td className="is-numeric">{row.book_value_after}</td><td><Status value={row.status}/></td></tr>)}</tbody></table></div> : <div className="fixed-assets-empty">No depreciation has been posted yet.</div>}</section></State></div>;
}

export function LiveFixedAssetDetailPage() {
  const { assetId } = useParams(); const auth = useAuth(); const [asset, setAsset] = useState(null); const [accounts, setAccounts] = useState([]); const [offset, setOffset] = useState(""); const [state, setState] = useState({ loading: true, error: "" }); const [message, setMessage] = useState("");
  const load = useCallback(async () => { try { const [item, ledgers] = await Promise.all([fixedAssetApiService.asset(assetId), accountingApiService.accounts({ status: "active" })]); setAsset(item); setAccounts(ledgers); setState({ loading: false, error: "" }); } catch (error) { setState({ loading: false, error: normaliseApiError(error) }); } }, [assetId]);
  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  const activate = async () => { try { await fixedAssetApiService.activate(assetId, offset); setMessage("Asset activated and acquisition journal posted."); await load(); } catch (error) { setMessage(normaliseApiError(error)); } };
  const details = asset ? [["Cost & valuation",[["Cost",asset.cost],["Residual value",asset.residual_value],["Accumulated depreciation",asset.accumulated_depreciation],["Net book value",asset.net_book_value]]],["Depreciation",[["Method",title(asset.depreciation_method)],["Useful life",`${asset.useful_life_months} months`],["In service",asset.in_service_date]]],["Accounting accounts",[["Asset account",accountName(asset.asset_account)],["Accumulated depreciation",accountName(asset.accumulated_depreciation_account)],["Depreciation expense",accountName(asset.depreciation_expense_account)]]]] : [];
  return <div className="fixed-assets-page"><PageHeader eyebrow="Fixed Assets · Asset" title={asset?.asset_name || "Asset details"} description={asset ? `${asset.asset_number} · ${title(asset.status)}` : "Cost, depreciation, accounts and history."} action={<div className="fixed-assets-header-actions">{auth.hasPermission("use_ai_assistant") && asset && <AskAIButton prompt={`Explain the depreciation and net book value for fixed asset ${asset.asset_number}, ${asset.asset_name}.`}/>}<Link className="invoice-secondary-button" to="/fixed-assets">Back to register</Link></div>}/>{message && <div className="fixed-assets-message is-success">{message}</div>}<State {...state}>{asset && <><section className="fixed-assets-panel"><div className="fixed-assets-detail-grid"><div><span>Asset number</span><strong>{asset.asset_number}</strong></div><div><span>Category</span><strong>{show(asset.asset_category)}</strong></div><div><span>Purchase date</span><strong>{asset.purchase_date}</strong></div><div><span>Status</span><Status value={asset.status}/></div></div></section><div className="fixed-assets-detail-sections">{details.map(([heading, rows]) => <section className="fixed-assets-panel" key={heading}><h2>{heading}</h2><dl>{rows.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{show(value)}</dd></div>)}</dl></section>)}</div>{asset.status === "draft" && auth.hasPermission("manage_fixed_assets") && <section className="fixed-assets-panel"><h2>Activate asset</h2><p>Post the acquisition against a bank, payable, or clearing account.</p><div className="fixed-assets-run-controls"><AccountSelect accounts={accounts} value={offset} onChange={(event) => setOffset(event.target.value)}/><button disabled={!offset} className="page-primary-button" onClick={() => void activate()}>Activate and post acquisition</button></div></section>}<section className="fixed-assets-panel"><h2>Depreciation history</h2>{asset.depreciation_schedules?.length ? <ReportExportMenu title={`${asset.asset_number} Depreciation History`} rows={asset.depreciation_schedules}/> : <div className="fixed-assets-empty">No depreciation history for this asset.</div>}</section></>}</State></div>;
}
