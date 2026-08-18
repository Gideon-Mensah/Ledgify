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
  journals: (params) => api.get(`journals/${query(params)}`),
  journal: (id) => api.get(`journals/${id}/`),
  createManualJournal: (data) => api.post("journals/manual/", data),
  postJournal: (id) => api.post(`journals/${id}/post/`, {}),
  reverseJournal: (id, data) => api.post(`journals/${id}/reverse/`, data),
  financialYears: () => api.get("financial-years/"),
  createFinancialYear: (data) => api.post("financial-years/", data),
  closeFinancialYear: (id) => api.post(`financial-years/${id}/close/`, {}),
  reopenFinancialYear: (id, data) => api.post(`financial-years/${id}/reopen/`, data),
  periods: () => api.get("accounting-periods/"),
  createPeriod: (data) => api.post("accounting-periods/", data),
  closePeriod: (id) => api.post(`accounting-periods/${id}/close/`, {}),
  reopenPeriod: (id, data) => api.post(`accounting-periods/${id}/reopen/`, data),
};
