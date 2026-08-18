// Load the current organisation's ledger accounts for forms and report filters.

import { api } from "./api";
export const coreAccountService = {
  list: () => api.get("accounts/"), get: (id) => api.get(`accounts/${id}/`),
  create: (data) => api.post("accounts/", data),
  update: (id, data) => api.patch(`accounts/${id}/`, data),
};
