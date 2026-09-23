import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, FileSpreadsheet, Landmark, UploadCloud } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../store/AuthContext";
import { bankService } from "../../services/bankService";
import { normaliseApiError } from "../../services/apiError";
import { formatCurrency } from "../../utils/currency.js";
import { statementStatus, statementAmount, importSummary } from "../../utils/bankImportPresentation.js";
import "../../styles/bankStatementImport.css";

const steps = ["Upload", "Map columns", "Review", "Import", "Reconcile"];
const money = (value, currency) => value == null ? "—" : formatCurrency(value, currency, { format: { currencyDisplay: "code" } });

export default function BankStatementImportPage() {
  const auth = useAuth();
  const [schema, setSchema] = useState(null), [accounts, setAccounts] = useState([]), [history, setHistory] = useState([]);
  const [accountId, setAccountId] = useState(""), [file, setFile] = useState(null), [detected, setDetected] = useState(null);
  const [mapping, setMapping] = useState({}), [dateFormat, setDateFormat] = useState("auto"), [amountSign, setAmountSign] = useState("");
  const [preview, setPreview] = useState(null), [rows, setRows] = useState([]), [filter, setFilter] = useState(""), [page, setPage] = useState(1), [count, setCount] = useState(0);
  const [step, setStep] = useState(0), [busy, setBusy] = useState("Loading bank accounts…"), [error, setError] = useState(""), [confirmed, setConfirmed] = useState(false), [dragging, setDragging] = useState(false);
  const request = useRef(0), fileInput = useRef(null), heading = useRef(null);
  const bank = accounts.find(item => item.id === accountId);
  const currency = bank?.currency;
  const canImport = auth.hasPermission("import_bank_statements");

  useEffect(() => {
    let active = true;
    Promise.all([bankService.importSchema(), bankService.accounts(), bankService.imports()]).then(([definition, banks, imports]) => {
      if (active) { setSchema(definition); setAccounts(banks.filter(item => item.status === "active")); setHistory(imports); setBusy(""); }
    }).catch(reason => { if (active) { setError(normaliseApiError(reason)); setBusy(""); } });
    return () => { active = false; request.current += 1; };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);

  const clearReview = () => { setPreview(null); setRows([]); setConfirmed(false); setFilter(""); setPage(1); };
  const chooseFile = chosen => {
    if (busy) return;
    request.current += 1; clearReview(); setDetected(null); setMapping({}); setStep(0); setError(""); setFile(null);
    setDateFormat("auto"); setAmountSign("");
    if (!chosen) return;
    if (!/\.(csv|xlsx)$/i.test(chosen.name)) { setError("Upload a CSV or XLSX statement. PDF, XLS, OFX, QFX and QIF imports are not currently supported."); return; }
    if (chosen.size > schema.max_bytes) { setError(`Choose a statement smaller than ${schema.max_bytes / 1024 / 1024} MB.`); return; }
    setFile(chosen);
  };
  const changeBank = value => { request.current += 1; setAccountId(value); clearReview(); setDetected(null); setMapping({}); setStep(0); setError(""); };
  const formData = () => { const data = new FormData(); data.append("bank_account_id", accountId); data.append("file", file); return data; };
  const perform = async (label, action, accept) => {
    const ticket = ++request.current; setBusy(label); setError("");
    try { const result = await action(); if (ticket === request.current) accept(result); }
    catch (reason) { if (ticket === request.current) setError(normaliseApiError(reason)); }
    finally { if (ticket === request.current) setBusy(""); }
  };
  const detect = event => {
    event.preventDefault();
    return perform("Reading statement columns…", () => bankService.detectImport(formData()), result => {
      setDetected(result); setMapping(result.mapping); setStep(1); clearReview();
    });
  };
  const review = event => {
    event.preventDefault(); const data = formData(); data.append("mapping", JSON.stringify(mapping)); data.append("date_format", dateFormat); data.append("amount_sign", amountSign);
    return perform("Checking every statement row…", () => bankService.previewImport(data), result => {
      setPreview(result); setRows(result.rows); setCount(result.total_rows); setFilter(""); setPage(1); setConfirmed(false); setStep(2);
    });
  };
  const changePage = (nextFilter, nextPage) => perform("Loading preview rows…", () => bankService.importRows(preview.id, { status: nextFilter, page: nextPage }), result => {
    setRows(result.results); setCount(result.count); setPage(result.page); setFilter(nextFilter);
  });
  const commit = () => perform("Importing reviewed transactions…", () => bankService.commitImport(preview.id), result => {
    setPreview(result); setStep(4);
    setHistory(previous => [result, ...previous.filter(item => item.id !== result.id)].slice(0, 50));
  });
  const download = () => perform("Preparing template…", () => bankService.importTemplate(), blob => {
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "ledgify-bank-statement.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const restart = () => { request.current += 1; clearReview(); setFile(null); setDetected(null); setMapping({}); setDateFormat("auto"); setAmountSign(""); setStep(0); setError(""); if (fileInput.current) fileInput.current.value = ""; };
  const summary = preview ? importSummary(preview) : null;
  return <div className="products-page statement-import-page">
    <PageHeader eyebrow="Banking" title="Bank Statement Import" description="Import transactions from your bank statement. Ledgify will check the file, help map your columns, detect duplicates and let you review everything before anything is imported." />
    <ol className="statement-steps" aria-label="Import progress">{steps.map((label, index) => <li key={label} className={step === index ? "is-current" : step > index ? "is-complete" : ""} aria-current={step === index ? "step" : undefined}><span>{step > index ? <CheckCircle2 size={16} /> : index + 1}</span>{label}</li>)}</ol>
    {error && <div className="statement-error" role="alert" id="statement-error">{error}</div>}
    <div className="statement-live" role="status" aria-live="polite">{busy}</div>
    {!canImport ? <section className="statement-panel"><h2>Import permission required</h2><p>Ask an organisation administrator for permission to import bank statements.</p></section> : <>
      <section className="statement-panel statement-account">
        <Landmark size={24} aria-hidden="true" /><div><label htmlFor="statement-bank">Bank account *</label><select id="statement-bank" value={accountId} onChange={event => changeBank(event.target.value)} disabled={Boolean(busy) || step === 4}><option value="">Select a bank account</option>{accounts.map(item => <option value={item.id} key={item.id}>{item.name} · {item.currency}</option>)}</select>
        {bank ? <div className="statement-account-details"><span>{bank.bank_name || "Bank"} · {bank.ledger_account?.code || bank.account_number || ""}</span><span>Statement currency: <strong>{currency}</strong></span><span>Book balance: <strong>{money(bank.book_balance, auth.selectedOrganisation?.base_currency)}</strong> <small>(ledger currency · all posted entries)</small></span></div> : !busy && schema && !accounts.length ? <p>No active bank accounts. Set up an account in Banking before importing.</p> : <p>Select the account this statement belongs to.</p>}</div>
      </section>
      {step === 0 && schema && <section className="statement-panel">
        <h2 ref={heading} tabIndex={-1}>Upload your statement</h2>
        <form onSubmit={detect} aria-describedby={error ? "statement-error" : undefined}>
          <label className={`statement-drop ${dragging ? "is-dragging" : ""}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length !== 1) { setError("Choose one statement at a time."); return; } chooseFile(event.dataTransfer.files[0]); }}>
            <UploadCloud size={34} aria-hidden="true" /><strong>{file ? file.name : "Drop your bank statement here"}</strong><span>or choose a file</span><input ref={fileInput} aria-label="Choose bank statement file" aria-describedby={error ? "statement-error" : undefined} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={event => chooseFile(event.target.files[0])} /><small>{schema.formats.join(" and ")} · up to {schema.max_bytes / 1024 / 1024} MB · {schema.max_rows.toLocaleString()} rows</small>
          </label>
          <p className="statement-help">PDF bank statements aren’t currently supported for automatic import. Download CSV or XLSX from your bank. Legacy XLS, OFX, QFX and QIF are not currently supported.</p>
          <div className="statement-actions"><button className="page-primary-button" disabled={!accountId || !file || Boolean(busy)}>Detect columns <FileSpreadsheet size={16} /></button><button type="button" className="invoice-secondary-button" disabled={Boolean(busy)} onClick={download}><Download size={16} />Download Ledgify CSV Template</button></div>
        </form>
        <details className="statement-guide"><summary>View example</summary><p>Illustration only. The downloaded template contains headings only; enter your actual transactions. Blank currency uses the selected bank account’s currency.</p><div className="statement-table-scroll" tabIndex={0} role="region" aria-label="Example statement"><table><thead><tr>{schema.template_headers.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody><tr>{schema.example.map((value, index) => <td key={index}>{value || "—"}</td>)}</tr></tbody></table></div></details>
      </section>}
      {step === 1 && detected && <form className="statement-panel" onSubmit={review} aria-describedby={error ? "statement-error" : undefined}>
        <h2 ref={heading} tabIndex={-1}>Check your columns</h2><p>{detected.total_rows.toLocaleString()} rows found in <strong>{file.name}</strong>. Check the detected mapping before continuing. Unmapped file columns are ignored.</p>
        {detected.ambiguous_fields.length > 0 && <p className="statement-warning">Multiple columns could match: {detected.ambiguous_fields.join(", ")}. Choose each one below.</p>}
        <div className="statement-mapping">{schema.fields.map(field => <label key={field.key} htmlFor={`map-${field.key}`}><span>{field.label} <small>{field.required ? "Required" : "Optional"}</small></span><select id={`map-${field.key}`} required={field.required} disabled={Boolean(busy)} value={mapping[field.key] || ""} onChange={event => setMapping(previous => ({ ...previous, [field.key]: event.target.value }))}><option value="">Unmapped — ignore this column</option>{detected.headers.map(column => <option key={column} value={column}>{column}</option>)}</select><small>{mapping[field.key] ? `Example: ${detected.sample_rows[0]?.[mapping[field.key]] || "empty"}` : "Not mapped"}</small></label>)}</div>
        <p className="statement-help">Map either Amount (with a transaction type or sign convention) or Money In / Money Out. Do not map both formats. Use decimal points; thousands commas are optional.</p>
        <div className="statement-mapping statement-options"><label htmlFor="statement-date">Date format<select id="statement-date" value={dateFormat} disabled={Boolean(busy)} onChange={event => setDateFormat(event.target.value)}>{Object.entries(schema.date_formats).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>Ambiguous dates such as 09/10/2026 require your choice.</small></label>
        {mapping.amount && !mapping.transaction_type && <label htmlFor="statement-sign">Amount sign convention<select id="statement-sign" required value={amountSign} disabled={Boolean(busy)} onChange={event => setAmountSign(event.target.value)}><option value="">Choose how positive amounts are used</option><option value="positive_in">Positive = Money In; negative = Money Out</option><option value="positive_out">Positive = Money Out; negative = Money In</option></select><small>We don’t assume whether positive amounts mean money in or out.</small></label>}</div>
        <div className="statement-actions"><button type="button" className="invoice-secondary-button" disabled={Boolean(busy)} onClick={() => setStep(0)}>Back to upload</button><button className="page-primary-button" disabled={Boolean(busy)}>Validate and preview</button></div>
      </form>}
      {(step === 2 || step === 3) && preview && <section className="statement-panel">
        <h2 ref={heading} tabIndex={-1}>{step === 3 ? "Confirm import" : "Review your statement"}</h2>
        <div className="statement-summary">{[[preview.total_rows, "Rows detected"], [summary.ready, "Ready"], [summary.duplicates, "Duplicates skipped"], [summary.rejected, "Needs attention"], [summary.information, "Balance information"]].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
        {summary.information > 0 && <p className="statement-note">Opening and closing balance rows are reconciliation information only. They will not change your bank account opening balance or create a receipt or journal. Check these values against your existing reconciliation setup.</p>}
        {step === 2 && <><div className="statement-review-tools"><label htmlFor="statement-filter">Show rows<select id="statement-filter" value={filter} disabled={Boolean(busy)} onChange={event => changePage(event.target.value, 1)}>{[["", "All"], ["ready", "Ready"], ["duplicate", "Duplicates"], ["rejected", "Needs attention"], ["information", "Balance information"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="invoice-secondary-button" disabled={Boolean(busy)} onClick={() => { setStep(1); setConfirmed(false); }}>Fix mapping</button></div>
        <div className="statement-table-scroll" tabIndex={0} role="region" aria-label="Statement transaction preview"><table><thead><tr>{["Date", "Description", "Reference", "Money In", "Money Out", "Balance", "Status"].map(label => <th key={label} scope="col" className={["Money In", "Money Out", "Balance"].includes(label) ? "statement-number" : ""}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} aria-describedby={row.error_message ? `row-error-${row.id}` : undefined}><td>{row.transaction_date || "—"}<small>Row {row.row_number}</small></td><td className="statement-description">{row.description || "Missing description"}{row.error_message && <p className="statement-row-message" id={`row-error-${row.id}`}>{row.error_message}</p>}{row.status === "rejected" && <details><summary>Original values</summary><dl>{Object.entries(row.source_data || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || "(empty)"}</dd></div>)}</dl></details>}</td><td>{row.reference || "—"}</td><td className="statement-number">{statementAmount(row, "money_in") === null ? "—" : money(row.amount, currency)}</td><td className="statement-number">{statementAmount(row, "money_out") === null ? "—" : money(row.amount, currency)}</td><td className="statement-number">{money(row.statement_balance, currency)}</td><td><span className={`statement-badge is-${row.status}`}>{statementStatus(row)}</span></td></tr>)}{!rows.length && <tr><td colSpan={7}>No rows match this filter.</td></tr>}</tbody></table></div>
        <div className="statement-pagination"><span>{count ? `${(page - 1) * 100 + 1}–${Math.min(page * 100, count)} of ${count} rows` : "0 rows"} · dates YYYY-MM-DD</span><div><button disabled={Boolean(busy) || page === 1} onClick={() => changePage(filter, page - 1)}>Previous</button><button disabled={Boolean(busy) || page * 100 >= count} onClick={() => changePage(filter, page + 1)}>Next</button></div></div>
        <div className="statement-actions"><button className="page-primary-button" disabled={Boolean(busy) || !summary.ready} onClick={() => setStep(3)}>Continue to import {summary.ready} {summary.ready === 1 ? "transaction" : "transactions"}</button></div></>}
        {step === 3 && <><p><strong>{summary.ready} {summary.ready === 1 ? "transaction" : "transactions"}</strong> will be imported into <strong>{bank?.name}</strong>. {summary.duplicates + summary.rejected} duplicate or invalid rows will not be imported. {summary.information} balance rows will remain information only.</p><p>Duplicate checks run again at import. This adds bank-side statement lines for reconciliation; it does not record your sales or payments again.</p><label className="statement-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} />I have reviewed the account, mapping and rows to be imported.</label><div className="statement-actions"><button className="invoice-secondary-button" disabled={Boolean(busy)} onClick={() => setStep(2)}>Back to review</button><button className="page-primary-button" disabled={!confirmed || !summary.ready || Boolean(busy)} onClick={commit}>Import {summary.ready} {summary.ready === 1 ? "transaction" : "transactions"}</button></div></>}
      </section>}
      {step === 4 && preview && <section className="statement-panel statement-success"><CheckCircle2 size={36} aria-hidden="true" /><h2 ref={heading} tabIndex={-1}>Bank statement imported</h2><p>{file?.name} → {bank?.name}</p><div className="statement-summary"><div><strong>{preview.imported_rows}</strong><span>Imported</span></div><div><strong>{preview.duplicate_rows}</strong><span>Duplicates skipped</span></div><div><strong>{preview.rejected_rows}</strong><span>Rejected</span></div></div><p>Match statement lines to existing Ledgify transactions. Opening balances and posted journals have not been changed.</p><div className="statement-actions">{auth.hasPermission("reconcile_bank") && <Link className="page-primary-button" to={`/banking/reconciliation?bank_account=${accountId}`}>Start reconciliation</Link>}<Link className="invoice-secondary-button" to={`/banking/transactions?bank_account=${accountId}`}>View bank transactions</Link><button className="invoice-secondary-button" onClick={restart}>Import another statement</button></div></section>}
    </>}
    <details className="statement-panel statement-guide"><summary>How to import a bank statement</summary><ol><li>Download a CSV or XLSX statement from online banking.</li><li>Choose the Ledgify bank account.</li><li>Upload the file.</li><li>Check the columns Ledgify identified and choose any ambiguous date or amount formats.</li><li>Check the preview and fix mapping or source data if needed.</li><li>Confirm the valid transactions to import.</li><li>Match imported transactions during reconciliation.</li></ol><p>Importing a bank statement does not mean recording the same sale or payment again. Existing Ledgify transactions can be matched to statement lines during reconciliation.</p></details>
    <section className="statement-panel"><h2>Recent imports</h2><p className="statement-help">Latest 50 previews and imports for this organisation.</p>{history.length ? <ul className="statement-history">{history.map(item => <li key={item.id}><FileSpreadsheet size={19} aria-hidden="true" /><div><strong>{item.file_name}</strong><span>{accounts.find(account => account.id === item.bank_account)?.name || "Bank account"} · {item.created_at?.slice(0, 10)}</span></div><span>{item.status === "completed" ? `${item.imported_rows} imported` : "Preview only"}</span></li>)}</ul> : <p>No imports yet. Your reviewed statements will appear here.</p>}</section>
  </div>;
}
