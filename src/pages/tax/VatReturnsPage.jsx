// Present tax summaries and return previews calculated from posted backend transactions.

import { useEffect, useState } from "react";
import PageHeader from "../../components/layout/PageHeader";
import ReportExportMenu from "../../components/reports/ReportExportMenu";
import { taxApiService } from "../../services/taxApiService";

const money = (value) => new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0));

// Renders the vat returns page component.
function VatReturnsPage() {
  const [summary, setSummary] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([taxApiService.summary(), taxApiService.periods(), taxApiService.transactions()])
      .then(([taxSummary, taxPeriods, taxTransactions]) => {
        setSummary(taxSummary);
        setPeriods(Array.isArray(taxPeriods) ? taxPeriods : taxPeriods.results || []);
        setTransactions(Array.isArray(taxTransactions) ? taxTransactions : taxTransactions.results || []);
      })
      .catch((requestError) => setError(requestError.data?.detail || requestError.message));
  }, []);
  return (
    <div>
      <PageHeader
        eyebrow="Tax"
        title="Indirect tax"
        description="Review configured VAT, GST or sales-tax activity and reporting periods."
        action={<ReportExportMenu title="Indirect Tax Transactions" rows={transactions} />}
      />

      <div className="placeholder-card" id="preview">
        <h2>Tax return preview</h2>
        {error && <p role="alert">{error}</p>}
        {!summary && !error && <p>Loading tax totals…</p>}
        {summary && (
          <dl className="summary-list">
            <div><dt>Sales net</dt><dd>{money(summary.sales_net)}</dd></div>
            <div><dt>Output tax</dt><dd>{money(summary.output_tax)}</dd></div>
            <div><dt>Purchases net</dt><dd>{money(summary.purchase_net)}</dd></div>
            <div><dt>Input tax</dt><dd>{money(summary.input_tax)}</dd></div>
            <div><dt>Net due / (refundable)</dt><dd>{money(summary.net_tax_due_or_refundable)}</dd></div>
          </dl>
        )}
      </div>
      <div className="placeholder-card" id="periods">
        <h2>Tax periods</h2>
        {periods.length === 0 ? <p>No tax periods have been configured.</p> : (
          <div className="table-scroll"><table><thead><tr><th>Start</th><th>End</th><th>Status</th><th>Payment due</th></tr></thead>
            <tbody>{periods.map((period) => <tr key={period.id}><td>{period.start_date}</td><td>{period.end_date}</td><td>{period.status}</td><td>{period.payment_due_date || "—"}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
      <div className="placeholder-card" id="transactions"><h2>Tax transactions</h2>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Document</th><th>Rate</th><th>Direction</th><th>Net</th><th>Tax</th><th>Gross</th></tr></thead>
          <tbody>{transactions.map((row) => <tr key={row.id}><td>{row.transaction_date}</td><td>{row.document_number}</td><td>{row.tax_rate_code} ({row.tax_rate_percent}%)</td><td>{row.direction}</td><td>{money(row.net_amount)}</td><td>{money(row.tax_amount)}</td><td>{money(row.gross_amount)}</td></tr>)}</tbody>
        </table></div>
      </div>
    </div>
  );
}

export default VatReturnsPage;
