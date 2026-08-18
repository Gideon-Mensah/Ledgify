import { api } from "./api";
export const coreInvoiceService = {
  list: () => api.get("invoices/"), get: (id) => api.get(`invoices/${id}/`),
  create: (data) => api.post("invoices/", data),
  approve: (id) => api.post(`invoices/${id}/approve/`, {}),
};
