// Access bank transactions and reconciliation workflows without recreating accounting in React.

import { api, apiRequest } from "./api";

const query = (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined
      && value !== null
      && value !== ""
    ) {
      search.set(key, value);
    }
  });

  const value = search.toString();

  return value ? `?${value}` : "";
};

export const bankService = {
  accounts: (params = {}) =>
    api.get(`bank-accounts/${query(params)}`),

  unlinkedLedgerAccounts: () =>
    api.get("bank-accounts/unlinked-ledger-accounts/"),

  createAccount: (data) =>
    api.post("bank-accounts/", data),

  updateAccount: (id, data) =>
    api.patch(`bank-accounts/${id}/`, data),

  reconciliationSummary: (id, reconciliationDate) =>
    api.get(`bank-accounts/${id}/reconciliation-summary/${query({ reconciliation_date: reconciliationDate })}`),

  reconciliationHistory: (id) =>
    api.get(`bank-accounts/${id}/reconciliation-history/`),

  transactions: (params = {}) =>
    api.get(`bank-transactions/${query(params)}`),

  createTransaction: (data) =>
    api.post("bank-transactions/", data),

  suggestions: (id, params = {}) =>
    api.get(`bank-transactions/${id}/suggestions/${query(params)}`),

  reconcileToAccount: (id, targetAccountId) =>
    api.post(
      `bank-transactions/${id}/reconcile/`,
      { target_account_id: targetAccountId },
    ),

  acceptSuggestion: (id, data) =>
    api.post(`bank-transactions/${id}/accept-suggestion/`, data),

  unreconcile: (id, data = {}) =>
    api.post(`bank-transactions/${id}/unreconcile/`, data),
  imports: () => api.get("bank-imports/"),
  previewImport: (formData) => apiRequest("bank-imports/preview/", { method: "POST", body: formData }),
  commitImport: (id) => api.post(`bank-imports/${id}/commit/`, {}),
  rules: () => api.get("bank-rules/"),
  createRule: (data) => api.post("bank-rules/", data),
  updateRule: (id, data) => api.patch(`bank-rules/${id}/`, data),
  applyRule: (id, ruleId) => api.post(`bank-transactions/${id}/apply-rule/`, { rule_id: ruleId }),
  bulkReconcile: (transactionIds, targetAccountId) => api.post("bank-transactions/bulk-reconcile/", { transaction_ids: transactionIds, target_account_id: targetAccountId }),
  queue: (params = {}) => api.get(`bank-transactions/queue/${query(params)}`),
};
