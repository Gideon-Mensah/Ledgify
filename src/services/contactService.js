import { api } from "./api";
export const contactService = {
  list: (params = "") => api.get(`contacts/${params ? `?${params}` : ""}`),
  get: (id) => api.get(`contacts/${id}/`),
  create: (data) => api.post("contacts/", data),
  update: (id, data) => api.patch(`contacts/${id}/`, data),
  remove: (id) => api.delete(`contacts/${id}/`),
  importTemplate: (type) => api.download(`contacts/${type}s/import/template/`),
  importPreview: (type, file, mode="stop_on_existing") => { const body=new FormData();body.append("file",file);body.append("import_mode",mode);return api.postForm(`contacts/${type}s/import/preview/`,body); },
  importConfirm: (type, id) => api.post(`contacts/${type}s/import/${id}/confirm/`,{}),
  importErrors: (type, id) => api.download(`contacts/${type}s/import/${id}/errors/`),
};
