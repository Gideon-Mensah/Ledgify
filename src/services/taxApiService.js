// Access configured tax rates and posted tax reports without calculating tax in the UI.

import { api } from "./api";

const query = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const suffix = params.toString();
  return suffix ? `?${suffix}` : "";
};

export const taxApiService = {
  rates: () => api.get("tax-rates/"),
  createRate: (data) => api.post("tax-rates/", data),
  updateRate: (id, data) => api.patch(`tax-rates/${id}/`, data),
  transactions: (filters) => api.get(`tax-transactions/${query(filters)}`),
  periods: () => api.get("tax-periods/"),
  createPeriod: (data) => api.post("tax-periods/", data),
  summary: (filters) => api.get(`tax/reports/summary/${query(filters)}`),
  preview: (filters) => api.get(`tax/reports/returns/preview/${query(filters)}`),
  liability: (filters) => api.get(`tax/reports/liability/${query(filters)}`),
};
