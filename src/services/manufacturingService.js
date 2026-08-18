// Call production services that coordinate inventory, WIP, and manufacturing journals.

import { api } from "./api";

const query = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  return search.toString() ? `?${search}` : "";
};

export const manufacturingService = {
  boms: (params) => api.get(`boms/${query(params)}`),
  bom: (id) => api.get(`boms/${id}/`),
  createBom: (data) => api.post("boms/", data),
  updateBom: (id, data) => api.patch(`boms/${id}/`, data),
  deleteBom: (id) => api.delete(`boms/${id}/`),
  versions: (params) => api.get(`bom-versions/${query(params)}`),
  version: (id) => api.get(`bom-versions/${id}/`),
  createVersion: (data) => api.post("bom-versions/", data),
  updateVersion: (id, data) => api.patch(`bom-versions/${id}/`, data),
  deleteVersion: (id) => api.delete(`bom-versions/${id}/`),
  activateVersion: (id) => api.post(`bom-versions/${id}/activate/`, {}),
  components: (params) => api.get(`bom-components/${query(params)}`),
  createComponent: (data) => api.post("bom-components/", data),
  updateComponent: (id, data) => api.patch(`bom-components/${id}/`, data),
  deleteComponent: (id) => api.delete(`bom-components/${id}/`),
  explode: (id, data) => api.post(`boms/${id}/explode/`, data),
  costRollup: (id, params) => api.get(`bom-versions/${id}/cost/${query(params)}`),
  orders: (params) => api.get(`production-orders/${query(params)}`),
  order: (id) => api.get(`production-orders/${id}/`),
  createOrder: (data) => api.post("production-orders/", data),
  updateOrder: (id, data) => api.patch(`production-orders/${id}/`, data),
  release: (id) => api.post(`production-orders/${id}/release/`, {}),
  requirements: (id) => api.get(`production-orders/${id}/requirements/`),
  shortages: (id) => api.get(`production-orders/${id}/shortages/`),
  costSummary: (id) => api.get(`production-orders/${id}/cost-summary/`),
  issue: (id, data) => api.post(`production-orders/${id}/issue-materials/`, data),
  returnMaterial: (id, data) => api.post(`production-orders/${id}/return-material/`, data),
  complete: (id, data) => api.post(`production-orders/${id}/complete/`, data),
  addLabour: (id, data) => api.post(`production-orders/${id}/add-labour/`, data),
  addOverhead: (id, data) => api.post(`production-orders/${id}/add-overhead/`, data),
  addSubcontract: (id, data) => api.post(`production-orders/${id}/add-subcontract/`, data),
  close: (id, data) => api.post(`production-orders/${id}/close/`, data),
  dashboard: () => api.get("manufacturing/reports/dashboard/"),
  report: (name, params) => api.get(`manufacturing/reports/${name}/${query(params)}`),
};
