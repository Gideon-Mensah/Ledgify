// Provide one discoverable entry point for organisation financial reports.

import PageHeader from "../../components/layout/PageHeader";
import { Link } from "react-router-dom";

import "../../styles/reportsCentre.css";

const reports = [
  ["General Ledger", "/accounting/general-ledger"],
  ["Trial Balance", "/accounting/trial-balance"],
  ["Profit & Loss", "/accounting/profit-and-loss"],
  ["Balance Sheet", "/accounting/balance-sheet"],
  ["Cash Flow", "/accounting/cash-flow"],
  ["Aged Receivables", "/accounting/aged-receivables"],
  ["Aged Payables", "/accounting/aged-payables"],
  ["Financial Analysis", "/reports/financial-analysis"],
];

// Renders the reports page component.
function ReportsPage() {
  return (
    <div className="reports-centre-page">
      <PageHeader
        eyebrow="Reporting"
        title="Reports"
        description="Review your company’s financial position and performance."
      />

      <div className="summary-card-grid">{reports.map(([title, path]) => <Link className="invoice-form-card" to={path} key={path}><h2>{title}</h2><p>Open report</p></Link>)}</div>
    </div>
  );
}

export default ReportsPage;
