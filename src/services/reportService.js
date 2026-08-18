// Fetch organisation-scoped reports and preserve their date filters for drill-down requests.

import { api } from "./api";

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) query.set(key, value);
  });
  return query.toString();
}

function get(path, params) {
  const query = queryString(params);
  return api.get(`${path}${query ? `?${query}` : ""}`);
}

export const reportService = {
  generalLedger: (params) => get("reports/general-ledger/", params),
  trialBalance: (params) => get("reports/trial-balance/", params),
  profitLoss: (params) => get("reports/profit-loss/", params),
  balanceSheet: (params) => get("reports/balance-sheet/", params),
  cashFlow: (params) => get("reports/cash-flow/", params),
  cashFlowDrilldown: (params) => get("reports/cash-flow/drilldown/", params),
  agedReceivables: (params) => get("finance/aged-receivables/", params),
  agedPayables: (params) => get("finance/aged-payables/", params),
  customerBalances: (params) => get("finance/customer-balances/", params),
  supplierBalances: (params) => get("finance/supplier-balances/", params),
  customerStatement: (params) => get("finance/customer-statement/", params),
  supplierStatement: (params) => get("finance/supplier-statement/", params),
  financialAnalysis: (params) => get("reports/financial-analysis/", params),
  ratioTrend: (params) => get("reports/financial-analysis/trend/", params),
};
