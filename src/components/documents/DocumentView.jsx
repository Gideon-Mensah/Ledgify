import { formatCurrency } from "../../utils/currency.js";
import "../../styles/documents.css";
import InvoiceDocument from "./InvoiceDocument";

export function OrganisationIdentity({ identity }) {
  if (!identity?.name) return <p role="alert">Complete the organisation profile in Settings before preparing documents.</p>;
  return <header className="document-identity">
    {identity.logo_data && <img src={identity.logo_data} alt={`${identity.name} logo`} />}
    <h2>{identity.name}</h2>{identity.trading_name && <p>{identity.trading_name}</p>}
    {(identity.address || []).map((line,index) => <div key={index}>{line}</div>)}
    {["phone","email","website","registration_number","tax_number","vat_registration_number"].filter(key => identity[key]).map(key => <div key={key}>{key.replaceAll("_", " ")}: {identity[key]}</div>)}
  </header>;
}
export default function DocumentView({ document: doc }) {
  if (!doc?.rows?.length || !doc.organisation?.name) return <p role="alert">Document data is unavailable. Reload before printing.</p>;
  if (doc.kind === "invoice") return <InvoiceDocument document={doc}/>;
  return <article className="trusted-document" data-document-version={doc.version}>
    <OrganisationIdentity identity={doc.organisation}/>
    <h1>{doc.title} {doc.number}</h1><p>Status: {doc.status.replaceAll("_"," ")}</p>
    <p>Date: {doc.date}{doc.due_date && <> · Due: {doc.due_date}</>}</p>
    <p>Currency: {doc.currency} ({doc.currency_basis})</p>
    {doc.party && <section><h3>{doc.party.name}</h3>{doc.party.address.map((line,i)=><div key={i}>{line}</div>)}{["tax_number","registration_number"].filter(key=>doc.party[key]).map(key=><p key={key}>{key.replaceAll("_"," ")}: {doc.party[key]}</p>)}</section>}
    {doc.reference && <p>Reference: {doc.reference}</p>}
    <div className="document-table-scroll"><table><thead><tr>{doc.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{doc.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{value}</td>)}</tr>)}</tbody></table></div>
    <dl className="document-totals">{doc.totals.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatCurrency(value,doc.currency)}</dd></div>)}</dl>
    {doc.notes && <section><h3>Notes</h3><p className="document-prewrap">{doc.notes}</p></section>}
    {doc.organisation.payment_instructions && ["invoice","quote","customer-payment"].includes(doc.kind) && <section><h3>Payment instructions</h3><p className="document-prewrap">{doc.organisation.payment_instructions}</p></section>}
    {doc.correction && <section><h3>Reversal {doc.correction.reference}</h3><p>{doc.correction.date} · {doc.correction.actor}</p><p>{doc.correction.reason}</p><p>{doc.correction.at}</p></section>}
  </article>;
}
