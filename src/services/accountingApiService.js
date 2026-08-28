// Call the real accounting endpoints; posting and reversal rules remain on the backend.

import { api } from "./api";

const query = (params = {}) => {
  const value = new URLSearchParams();
  Object.entries(params).forEach(([key, item]) => { if (item) value.set(key, item); });
  const text = value.toString();
  return text ? `?${text}` : "";
};

export const accountingApiService = {
  accounts: (params) => api.get(`accounts/${query(params)}`),
  account: (id) => api.get(`accounts/${id}/`),
  createAccount: (data) => api.post("accounts/", data),
  updateAccount: (id, data) => api.patch(`accounts/${id}/`, data),
  downloadAccountImportTemplate: () => api.download("accounts/import/template/"),
  previewAccountImport: (file) => { const body = new FormData(); body.append("file", file); body.append("import_mode", "stop_on_existing"); return api.postForm("accounts/import/preview/", body); },
  confirmAccountImport: (id) => api.post(`accounts/import/${id}/confirm/`, {}),
  accountImportErrors: (id) => api.download(`accounts/import/${id}/errors/`),
  journals: (params) => api.get(`journals/${query(params)}`),
  journalRegister: (params, options) => api.get(`journals/register/${query(params)}`, options),
  journal: (id) => api.get(`journals/${id}/`),
  createManualJournal: (data) => api.post("journals/manual/", data),
  postJournal: (id) => api.post(`journals/${id}/post/`, {}),
  reverseJournal: (id, data) => api.post(`journals/${id}/reverse/`, data),
  openingBalances: () => api.get("opening-balances/"),
  openingBalance: (id) => api.get(`opening-balances/${id}/`),
  createOpeningBalance: (data) => api.post("opening-balances/", data),
  updateOpeningBalance: (id, data) => api.patch(`opening-balances/${id}/`, data),
  submitOpeningBalance: (id) => api.post(`opening-balances/${id}/submit/`, {}),
  postOpeningBalance: (id) => api.post(`opening-balances/${id}/post/`, {}),
  reverseOpeningBalance: (id, data) => api.post(`opening-balances/${id}/reverse/`, data),
  financialYears: () => api.get("financial-years/"),
  createFinancialYear: (data) => api.post("financial-years/", data),
  closeFinancialYear: (id) => api.post(`financial-years/${id}/close/`, {}),
  reopenFinancialYear: (id, data) => api.post(`financial-years/${id}/reopen/`, data),
  periods: () => api.get("accounting-periods/"),
  createPeriod: (data) => api.post("accounting-periods/", data),
  closePeriod: (id) => api.post(`accounting-periods/${id}/close/`, {}),
  reopenPeriod: (id, data) => api.post(`accounting-periods/${id}/reopen/`, data),
};
