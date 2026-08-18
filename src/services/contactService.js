import { api } from "./api";
export const contactService = {
  list: (params = "") => api.get(`contacts/${params ? `?${params}` : ""}`),
  get: (id) => api.get(`contacts/${id}/`),
  create: (data) => api.post("contacts/", data),
  update: (id, data) => api.patch(`contacts/${id}/`, data),
  remove: (id) => api.delete(`contacts/${id}/`),
};
