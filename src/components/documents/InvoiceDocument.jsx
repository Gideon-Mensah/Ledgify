import { OrganisationIdentity } from './DocumentView';
import { invoiceDate, invoiceMoney, invoiceRow, invoiceStatus } from '../../utils/invoicePresentation.js';

export default function InvoiceDocument({ document: doc }) {
  return <article className="trusted-document customer-invoice" data-document-version={doc.version}>
    <div className="customer-invoice-header">
      <OrganisationIdentity identity={doc.organisation}/>
      <section className="customer-invoice-meta" aria-label="Invoice details">
        <h1>{doc.title}</h1><p className="customer-invoice-number">{doc.number}</p>
        <dl>{[['Invoice date', invoiceDate(doc.date)], ...(doc.due_date ? [['Due date', invoiceDate(doc.due_date)]] : []), ['Currency', `${doc.currency} · ${doc.currency_basis} currency`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          <div><dt>Status</dt><dd><span className="invoice-status" data-status={doc.status}>{invoiceStatus(doc.status)}</span></dd></div>
        </dl>
      </section>
    </div>
    {doc.party && <section className="invoice-bill-to"><h2>Bill to</h2><h3>{doc.party.name}</h3>{(doc.party.address || []).filter(Boolean).map((line, index) => <div key={index}>{line}</div>)}{['tax_number','registration_number'].filter(key => doc.party[key]).map(key => <p key={key}>{key === 'tax_number' ? 'Tax number' : 'Registration number'}: {doc.party[key]}</p>)}</section>}
    {doc.reference && <p className="invoice-reference"><strong>Reference</strong> {doc.reference}</p>}
    <div className="document-table-scroll" role="region" aria-label="Invoice items" tabIndex={0}><table className="invoice-items"><caption className="invoice-visually-hidden">Invoice items in {doc.currency}</caption><colgroup><col className="invoice-description-column"/>{Array.from({length: 5}, (_, i) => <col key={i}/>)}</colgroup><thead><tr>{['Description', 'Quantity', 'Unit price', 'Discount', 'Tax', 'Amount'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{doc.rows.map((row, i) => <tr key={i}>{invoiceRow(row, doc.currency).map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table></div>
    <dl className="document-totals invoice-totals">{doc.totals.map(([label, value]) => <div className={['Total', 'Amount due'].includes(label) ? 'invoice-total-emphasis' : ''} key={label}><dt>{label}</dt><dd>{invoiceMoney(value, doc.currency)}</dd></div>)}</dl>
    {doc.notes && <section className="customer-invoice-notes"><h2>Notes</h2><p className="document-prewrap">{doc.notes}</p></section>}
    {doc.organisation.payment_instructions && <section className="customer-invoice-notes"><h2>Payment information</h2><p className="document-prewrap">{doc.organisation.payment_instructions}</p></section>}
    {doc.correction && <section className="customer-invoice-notes"><h2>Reversal {doc.correction.reference}</h2><p>{invoiceDate(doc.correction.date)} · {doc.correction.actor}</p><p>{doc.correction.reason}</p><p>{doc.correction.at}</p></section>}
  </article>;
}
