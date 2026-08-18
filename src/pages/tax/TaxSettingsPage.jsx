// Manage country-neutral tax configuration used by document and ledger services.

import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../store/AuthContext";
import { api } from "../../services/api";
import { accountingApiService } from "../../services/accountingApiService";
import { taxApiService } from "../../services/taxApiService";

const emptyRate = { code: "", name: "", rate: "0", tax_type: "VAT", scope: "BOTH",
  status: "ACTIVE", effective_from: "", effective_to: "", input_tax_account: "",
  output_tax_account: "", recoverable: true };

export default function TaxSettingsPage() {
  const { selectedOrganisation, hasPermission, bootstrapAuth } = useAuth();
  const [organisation, setOrganisation] = useState(null);
  const [rates, setRates] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [rate, setRate] = useState(emptyRate);
  const [message, setMessage] = useState("");
  const canManage = hasPermission("manage_tax_rates");

  const load = async () => {
    const [organisations, taxRates, chart] = await Promise.all([
      api.get("organisations/"), taxApiService.rates(), accountingApiService.accounts({ status: "active" }),
    ]);
    setOrganisation(organisations.find((item) => item.id === selectedOrganisation?.id));
    setRates(Array.isArray(taxRates) ? taxRates : taxRates.results || []);
    setAccounts(Array.isArray(chart) ? chart : chart.results || []);
  };
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => setMessage(error.data?.detail || error.message));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const accountOptions = useMemo(() => accounts.map((account) => (
    <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
  )), [accounts]);

  const saveSettings = async (event) => {
    event.preventDefault(); setMessage("");
    const fields = ["tax_registered", "tax_registration_number", "tax_scheme", "tax_reporting_currency", "tax_period_frequency", "tax_effective_date"];
    await api.patch(`organisations/${organisation.id}/`, Object.fromEntries(fields.map((key) => [key, organisation[key]])));
    await bootstrapAuth(); setMessage("Tax settings saved.");
  };
  const saveRate = async (event) => {
    event.preventDefault(); setMessage("");
    const payload = { ...rate, effective_to: rate.effective_to || null,
      input_tax_account: rate.input_tax_account || null, output_tax_account: rate.output_tax_account || null };
    if (editing) await taxApiService.updateRate(editing, payload); else await taxApiService.createRate(payload);
    setEditing(null); setRate(emptyRate); await load(); setMessage("Tax rate saved.");
  };
  const editRate = (item) => { setEditing(item.id); setRate({ ...item,
    input_tax_account: item.input_tax_account || "", output_tax_account: item.output_tax_account || "" }); };

  return <div>
    <PageHeader eyebrow="Settings" title="Tax settings" description="Configure country-neutral indirect-tax registration and rates." />
    {message && <div className="placeholder-card" role="status">{message}</div>}
    {organisation && <form className="placeholder-card" onSubmit={saveSettings}>
      <h2>Organisation tax registration</h2>
      <div className="form-grid">
        <label><input type="checkbox" checked={organisation.tax_registered} onChange={(e) => setOrganisation({ ...organisation, tax_registered: e.target.checked })} /> Tax registered</label>
        <label>Registration number<input value={organisation.tax_registration_number || ""} onChange={(e) => setOrganisation({ ...organisation, tax_registration_number: e.target.value })} /></label>
        <label>Tax system<input value={organisation.tax_scheme || ""} onChange={(e) => setOrganisation({ ...organisation, tax_scheme: e.target.value })} placeholder="VAT, GST, sales tax…" /></label>
        <label>Reporting currency<input maxLength="3" value={organisation.tax_reporting_currency || ""} onChange={(e) => setOrganisation({ ...organisation, tax_reporting_currency: e.target.value.toUpperCase() })} /></label>
        <label>Period frequency<select value={organisation.tax_period_frequency || ""} onChange={(e) => setOrganisation({ ...organisation, tax_period_frequency: e.target.value })}><option value="">Not set</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
        <label>Effective date<input type="date" value={organisation.tax_effective_date || ""} onChange={(e) => setOrganisation({ ...organisation, tax_effective_date: e.target.value || null })} /></label>
      </div><button className="button button-primary" type="submit">Save settings</button>
    </form>}
    <section className="placeholder-card"><h2>Tax rates</h2>
      {canManage && <form onSubmit={saveRate} className="form-grid">
        <label>Code<input required value={rate.code} onChange={(e) => setRate({ ...rate, code: e.target.value })} /></label>
        <label>Name<input required value={rate.name} onChange={(e) => setRate({ ...rate, name: e.target.value })} /></label>
        <label>Rate %<input required min="0" step="0.0001" type="number" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} /></label>
        <label>Type<select value={rate.tax_type} onChange={(e) => setRate({ ...rate, tax_type: e.target.value })}><option>VAT</option><option>GST</option><option value="SALES_TAX">Sales tax</option><option>OTHER</option></select></label>
        <label>Scope<select value={rate.scope} onChange={(e) => setRate({ ...rate, scope: e.target.value })}><option>SALES</option><option>PURCHASES</option><option>BOTH</option></select></label>
        <label>Status<select value={rate.status} onChange={(e) => setRate({ ...rate, status: e.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></label>
        <label>Effective from<input required type="date" value={rate.effective_from} onChange={(e) => setRate({ ...rate, effective_from: e.target.value })} /></label>
        <label>Effective to<input type="date" value={rate.effective_to || ""} onChange={(e) => setRate({ ...rate, effective_to: e.target.value })} /></label>
        <label>Input tax account<select value={rate.input_tax_account || ""} onChange={(e) => setRate({ ...rate, input_tax_account: e.target.value })}><option value="">None</option>{accountOptions}</select></label>
        <label>Output tax account<select value={rate.output_tax_account || ""} onChange={(e) => setRate({ ...rate, output_tax_account: e.target.value })}><option value="">None</option>{accountOptions}</select></label>
        <label><input type="checkbox" checked={rate.recoverable} onChange={(e) => setRate({ ...rate, recoverable: e.target.checked })} /> Purchase tax recoverable</label>
        <div><button className="button button-primary" type="submit">{editing ? "Update rate" : "Add rate"}</button></div>
      </form>}
      <div className="table-scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Rate</th><th>Type</th><th>Scope</th><th>Status</th><th /></tr></thead><tbody>
        {rates.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.rate}%</td><td>{item.tax_type}</td><td>{item.scope}</td><td>{item.status}</td><td>{canManage && <button type="button" onClick={() => editRate(item)}>Edit</button>}</td></tr>)}
      </tbody></table></div>
    </section>
    <div className="placeholder-card"><strong>Electronic filing is not enabled.</strong> Prepare and review returns here; jurisdiction filing adapters require a separate production integration.</div>
  </div>;
}
