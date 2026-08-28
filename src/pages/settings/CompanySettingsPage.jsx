// Expose settings sections according to the selected organisation's permissions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Bot, Building2, Calculator, CircleDollarSign, Factory, FileClock, Landmark, Package, Plug, Search, Shield, Users, WalletCards } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { normaliseApiError } from "../../services/apiError";
import { fixedAssetApiService } from "../../services/fixedAssetApiService";
import { inventoryService } from "../../services/inventoryService";
import { settingsService } from "../../services/settingsService";
import { useAuth } from "../../store/AuthContext";
import "../../styles/settings.css";

const items = [
  { id: "organisation", group: "General", title: "Organisation profile", description: "Legal entity, address and contact information.", icon: Building2, permission: "manage_organisation_users" },
  { id: "financial", group: "Accounting", title: "Financial settings", description: "Base currency, reporting currency, year start and timezone.", icon: CircleDollarSign, permission: "view_accounting" },
  { id: "financial-years", group: "Accounting", title: "Financial years", description: "Create, close and reopen financial years.", icon: FileClock, path: "/accounting/financial-year", permission: "manage_financial_years" },
  { id: "opening-balances", group: "Accounting", title: "Opening balances", description: "Bring verified account balances forward from a previous system.", icon: CircleDollarSign, path: "/accounting/opening-balances", permission: "view_accounting" },
  { id: "periods", group: "Accounting", title: "Accounting periods", description: "Review period locks and controlled reopening.", icon: Calculator, path: "/accounting/period-locks", permission: "view_accounting" },
  { id: "chart-of-accounts", group: "Accounting", title: "Chart of Accounts", description: "Manage ledger accounts and reporting classifications.", icon: Calculator, path: "/accounting/chart-of-accounts", permission: "view_accounting" },
  { id: "banking", group: "Operations", title: "Banking", description: "Bank accounts, imports and deterministic reconciliation rules.", icon: Landmark, path: "/banking/accounts", permission: "view_accounting" },
  { id: "inventory", group: "Operations", title: "Inventory settings", description: "Warehouses, WAC costing and negative-stock policy.", icon: Package, permission: "view_inventory" },
  { id: "fixed-assets", group: "Operations", title: "Fixed Asset settings", description: "Categories, depreciation defaults and account mappings.", icon: WalletCards, permission: "view_fixed_assets" },
  { id: "tax", group: "Compliance", title: "Tax settings", description: "Tax registration, rates, periods and reporting.", icon: Calculator, path: "/tax/settings", permission: "view_tax" },
  { id: "payroll", group: "People", title: "Payroll", description: "Employees, components, pay runs and payroll accounts.", icon: Users, path: "/payroll", permission: "view_payroll" },
  { id: "currencies", group: "Advanced", title: "Currency & FX", description: "Dated exchange rates, exposure and revaluation.", icon: CircleDollarSign, path: "/accounting/fx", permission: "view_accounting" },
  { id: "manufacturing", group: "Advanced", title: "Manufacturing", description: "BOMs, production orders and configured WIP accounts.", icon: Factory, path: "/manufacturing", permission: "view_manufacturing" },
  { id: "consolidation", group: "Advanced", title: "Consolidation", description: "Groups, mappings, eliminations and group reports.", icon: Building2, path: "/accounting/consolidation", permission: "view_consolidation" },
  { id: "ai", group: "Advanced", title: "AI settings", description: "Analysis, draft actions, anomalies and data sharing.", icon: Bot, permission: "manage_ai_settings" },
  { id: "users", group: "Security & Access", title: "Users", description: "Organisation membership, roles and active access.", icon: Users, permission: "manage_organisation_users" },
  { id: "roles", group: "Security & Access", title: "Roles & permissions", description: "Understand access provided by each Ledgify role.", icon: Shield, permission: "manage_organisation_users" },
  { id: "security", group: "Security & Access", title: "Security", description: "Current account and available security controls.", icon: Shield },
  { id: "integrations", group: "System", title: "Integrations", description: "Implemented provider and infrastructure status.", icon: Plug },
  { id: "system", group: "System", title: "System information", description: "Safe application and environment information.", icon: FileClock },
];
const roles = [
  ["owner", "Owner", "Full organisation and configuration access."], ["admin", "Administrator", "Full administration and operational access."],
  ["accountant", "Accountant", "Accounting, reporting and operational workflows."], ["bookkeeper", "Bookkeeper", "Day-to-day entry and selected configuration."],
  ["approver", "Approver", "Approval-focused access with reporting visibility."], ["employee", "Employee", "Limited operational access."], ["viewer", "Read only", "Reports and view-only modules."],
];
const normalise = (value) => Array.isArray(value) ? value : value?.results || [];
const fieldLabel = (value) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function Notice({ children, error = false }) { return <div className={error ? "settings-notice is-error" : "settings-notice"}>{children}</div>; }
function SettingLink({ to, children, primary = false }) { return <Link className={primary ? "page-primary-button" : "invoice-secondary-button"} to={to}>{children}</Link>; }

function OrganisationSettings({ financial = false }) {
  const auth = useAuth(); const organisation = auth.selectedOrganisation;
  const canEdit = auth.hasPermission("manage_organisation_users");
  const fields = financial ? ["base_currency", "reporting_currency", "timezone", "financial_year_start_month"] : ["name", "legal_name", "registration_number", "tax_number", "country_code", "address_line_1", "address_line_2", "city", "region", "postal_code", "phone", "email", "website"];
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((key) => [key, organisation?.[key] ?? ""]))); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const changed = fields.some((key) => String(form[key] ?? "") !== String(organisation?.[key] ?? ""));
  const save = async (event) => { event.preventDefault(); setSaving(true); setMessage(""); try { await settingsService.updateOrganisation(organisation.id, form); await auth.bootstrapAuth(); setMessage("Settings saved successfully."); } catch (error) { setMessage(normaliseApiError(error)); } finally { setSaving(false); } };
  return <section className="settings-content-card"><div className="settings-section-heading"><div><h2>{financial ? "Financial settings" : "Organisation profile"}</h2><p>{financial ? "Core reporting identity and financial calendar." : "Information used to identify and contact this organisation."}</p></div>{canEdit && changed && <span className="settings-unsaved">Unsaved changes</span>}</div>{message && <Notice>{message}</Notice>}{!canEdit && <Notice>You have view access. Organisation administrators control changes to these fields.</Notice>}<form className="settings-form" onSubmit={save}>{fields.map((key) => <label key={key}>{fieldLabel(key)}<input name={key} type={key === "financial_year_start_month" ? "number" : key === "email" ? "email" : key === "website" ? "url" : "text"} min={key === "financial_year_start_month" ? 1 : undefined} max={key === "financial_year_start_month" ? 12 : undefined} value={form[key] ?? ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} disabled={!canEdit} />{financial && key === "base_currency" && <small>Cannot be changed after accounting transactions have been posted.</small>}</label>)}{financial && <Notice>FX gain and loss accounts are configured through Currency &amp; FX using organisation-scoped chart accounts.</Notice>}{canEdit && <div className="settings-form-actions"><button type="button" className="invoice-secondary-button" disabled={!changed || saving} onClick={() => setForm(Object.fromEntries(fields.map((key) => [key, organisation?.[key] ?? ""])))}>Cancel</button><button className="page-primary-button" disabled={!changed || saving}>{saving ? "Saving…" : "Save changes"}</button></div>}</form></section>;
}

function InventorySettings() {
  const [warehouses, setWarehouses] = useState([]); const [error, setError] = useState("");
  useEffect(() => { inventoryService.warehouses().then((data) => setWarehouses(normalise(data))).catch((requestError) => setError(normaliseApiError(requestError))); }, []);
  return <><section className="settings-content-card"><h2>Inventory policy</h2><dl className="settings-definition"><div><dt>Costing method</dt><dd>Perpetual Weighted Average Cost</dd></div><div><dt>Negative stock</dt><dd>Rejected</dd></div><div><dt>Historical costing</dt><dd>Immutable cost layers</dd></div></dl><Notice>Costing method and negative-stock protection are accounting-engine policies and are intentionally read-only.</Notice></section><section className="settings-content-card"><div className="settings-section-heading"><div><h2>Warehouses</h2><p>Operational warehouse configuration.</p></div><SettingLink to="/inventory/products">Open inventory</SettingLink></div>{error ? <Notice error>{error}</Notice> : warehouses.length ? <div className="settings-mini-grid">{warehouses.map((item) => <article key={item.id}><strong>{item.name}</strong><span>{item.code} · {item.is_default ? "Default" : item.status}</span></article>)}</div> : <p className="settings-empty">No warehouses configured.</p>}</section></>;
}

function FixedAssetSettings() {
  const [categories, setCategories] = useState([]); const [error, setError] = useState("");
  useEffect(() => { fixedAssetApiService.categories().then((data) => setCategories(normalise(data))).catch((requestError) => setError(normaliseApiError(requestError))); }, []);
  return <section className="settings-content-card"><div className="settings-section-heading"><div><h2>Fixed Asset categories</h2><p>Category-driven useful lives, depreciation methods and ledger defaults.</p></div><SettingLink primary to="/fixed-assets">Open Asset Register</SettingLink></div>{error ? <Notice error>{error}</Notice> : categories.length ? <div className="settings-mini-grid">{categories.map((item) => <article key={item.id}><strong>{item.name}</strong><span>{item.default_useful_life_months} months · {fieldLabel(item.default_depreciation_method)}</span></article>)}</div> : <p className="settings-empty">No Fixed Asset categories configured. Add one from the Asset Register.</p>}</section>;
}

function AISettings() {
  const [form, setForm] = useState(null); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { settingsService.aiSettings().then(setForm).catch((error) => setMessage(normaliseApiError(error))); }, []);
  if (!form) return <section className="settings-content-card">{message ? <Notice error>{message}</Notice> : "Loading AI settings…"}</section>;
  const save = async () => { setSaving(true); try { setForm(await settingsService.updateAISettings(form)); setMessage("AI settings saved successfully."); } catch (error) { setMessage(normaliseApiError(error)); } finally { setSaving(false); } };
  return <><section className="settings-content-card"><h2>AI Assistant controls</h2>{message && <Notice>{message}</Notice>}<div className="settings-toggle-list">{[["ai_enabled","AI Assistant enabled"],["allow_financial_analysis","Financial analysis"],["allow_draft_actions","Draft work proposals"],["allow_anomaly_detection","Anomaly detection"]].map(([key,label]) => <label key={key}><span><strong>{label}</strong><small>Organisation-level safety configuration.</small></span><input type="checkbox" checked={Boolean(form[key])} onChange={(event) => setForm({ ...form, [key]: event.target.checked })}/></label>)}</div><label className="settings-select-field">Data sharing level<select value={form.data_sharing_level} onChange={(event) => setForm({ ...form, data_sharing_level: event.target.value })}><option value="minimal">Minimal</option><option value="standard">Standard</option></select></label><div className="settings-form-actions"><button className="page-primary-button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button></div></section><section className="settings-content-card"><h2>AI action policy</h2><div className="settings-policy-grid"><article><strong>AI can</strong><ul><li>Analyse financial information</li><li>Explain reports</li><li>Detect anomalies</li><li>Prepare draft work</li></ul></article><article><strong>AI cannot automatically</strong><ul><li>Send payments</li><li>File tax returns</li><li>Close periods</li><li>Run payroll payments</li><li>Post high-risk accounting actions</li></ul></article></div><Notice>Provider status is shown safely inside the AI Assistant response metadata. Secret credentials are never exposed here.</Notice></section></>;
}

function UsersSettings() {
  const [members, setMembers] = useState([]); const [error, setError] = useState("");
  const load = useCallback(() => settingsService.members().then((data) => setMembers(normalise(data))).catch((requestError) => setError(normaliseApiError(requestError))), []);
  useEffect(() => { void load(); }, [load]);
  const update = async (item, changes) => { try { await settingsService.updateMember(item.id, changes); await load(); } catch (requestError) { setError(normaliseApiError(requestError)); } };
  return <section className="settings-content-card"><h2>Organisation access</h2><p>Membership is organisation-scoped. The current backend does not expose user profile details through this endpoint.</p>{error && <Notice error>{error}</Notice>}<div className="settings-member-list">{members.map((item, index) => <article key={item.id}><div><strong>Organisation member {index + 1}</strong><span>{item.is_active ? "Active" : "Inactive"} · joined {String(item.joined_at).slice(0,10)}</span></div><select value={item.role} onChange={(event) => void update(item, { role: event.target.value })}>{roles.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><button className="invoice-secondary-button" onClick={() => void update(item, { is_active: !item.is_active })}>{item.is_active ? "Deactivate" : "Reactivate"}</button></article>)}</div><Notice>User invitation is not exposed because the membership API currently accepts an existing user identifier and does not provide a safe email invitation workflow.</Notice></section>;
}

function RolesSettings() { return <section className="settings-content-card"><h2>Roles &amp; permissions</h2><p>Backend role definitions remain authoritative.</p><div className="settings-role-grid">{roles.map(([value,label,description]) => <article key={value}><Shield size={18}/><div><strong>{label}</strong><p>{description}</p><span>{value}</span></div></article>)}</div></section>; }
function SecuritySettings() { const auth = useAuth(); return <section className="settings-content-card"><h2>Security</h2><dl className="settings-definition"><div><dt>Signed-in user</dt><dd>{auth.user?.email || auth.user?.username || "Current user"}</dd></div><div><dt>Organisation role</dt><dd>{fieldLabel(auth.selectedOrganisation?.role || "member")}</dd></div><div><dt>Organisation isolation</dt><dd>Active</dd></div></dl><Notice>Password change and two-factor authentication workflows are not implemented in the current frontend/backend API. No unsupported controls are displayed.</Notice></section>; }
function IntegrationsSettings() { return <section className="settings-content-card"><h2>Implemented integrations</h2><div className="settings-mini-grid"><article><strong>Bank statement import</strong><span>CSV import · Available</span></article><article><strong>AI provider</strong><span>Safe provider status is available in assistant metadata</span></article><article><strong>Email</strong><span>Server-managed; credentials are not exposed</span></article><article><strong>Object storage</strong><span>Server-managed configuration</span></article></div><Notice>Open Banking, marketplace connections and test-email actions are not implemented.</Notice></section>; }
function SystemSettings() { return <section className="settings-content-card"><h2>System information</h2><dl className="settings-definition"><div><dt>Application</dt><dd>Ledgify</dd></div><div><dt>Frontend</dt><dd>React / Vite</dd></div><div><dt>API environment</dt><dd>{import.meta.env.MODE}</dd></div><div><dt>API status</dt><dd>Connected through authenticated organisation-scoped requests</dd></div></dl><Notice>Database, storage, email and provider credentials are intentionally not exposed to the browser.</Notice></section>; }

function SettingsOverview({ available }) {
  const [query, setQuery] = useState(""); const visible = available.filter((item) => `${item.title} ${item.description} ${item.group}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="settings-search"><Search size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings, for example currency or fixed assets"/></div><div className="settings-card-grid">{visible.map((item) => { const Icon = item.icon; return <Link key={item.id} to={item.path || `/settings/${item.id}`}><div className="settings-card-icon"><Icon size={20}/></div><div><span>{item.group}</span><h2>{item.title}</h2><p>{item.description}</p><strong>Open settings →</strong></div></Link>; })}</div>{!visible.length && <p className="settings-empty">No settings match “{query}”.</p>}</>;
}

export default function CompanySettingsPage() {
  const auth = useAuth(); const { section = "overview" } = useParams();
  const available = useMemo(() => items.filter((item) => !item.permission || auth.hasPermission(item.permission)), [auth]); const selected = items.find((item) => item.id === section);
  if (selected?.path) return <Navigate to={selected.path} replace/>;
  const content = { organisation: <OrganisationSettings/>, financial: <OrganisationSettings financial/>, inventory: <InventorySettings/>, "fixed-assets": <FixedAssetSettings/>, ai: <AISettings/>, users: <UsersSettings/>, roles: <RolesSettings/>, security: <SecuritySettings/>, integrations: <IntegrationsSettings/>, system: <SystemSettings/> }[section];
  if (section !== "overview" && (!selected || (selected.permission && !auth.hasPermission(selected.permission)))) return <Navigate to="/settings" replace/>;
  return <div className="settings-page"><PageHeader eyebrow="Administration" title={section === "overview" ? "Settings" : selected.title} description={section === "overview" ? "Manage your organisation, accounting controls, people and connected Ledgify modules." : selected.description}/><div className="settings-breadcrumbs"><Link to="/settings">Settings</Link>{section !== "overview" && <><span>/</span><strong>{selected.group}</strong><span>/</span><span>{selected.title}</span></>}</div><div className="settings-shell"><aside className="settings-nav"><Link className={section === "overview" ? "active" : ""} to="/settings">Control centre</Link>{[...new Set(available.map((item) => item.group))].map((group) => <div key={group}><span>{group}</span>{available.filter((item) => item.group === group).map((item) => <Link className={section === item.id ? "active" : ""} key={item.id} to={item.path || `/settings/${item.id}`}>{item.title}</Link>)}</div>)}</aside><main className="settings-main">{section === "overview" ? <SettingsOverview available={available}/> : content}</main></div></div>;
}
