import { api } from "./api";
export const coreBillService = {
  list: () => api.get("bills/"), get: (id) => api.get(`bills/${id}/`),
  create: (data) => api.post("bills/", data),
  approve: (id) => api.post(`bills/${id}/approve/`, {}),
};
