// Access the fixed-asset lifecycle while depreciation and posting remain backend responsibilities.

import { api } from "./api";

export const fixedAssetApiService = {
  assets: () => api.get("fixed-assets/"), asset: (id) => api.get(`fixed-assets/${id}/`),
  createAsset: (data) => api.post("fixed-assets/", data),
  updateAsset: (id, data) => api.patch(`fixed-assets/${id}/`, data),
  categories: () => api.get("fixed-asset-categories/"),
  createCategory: (data) => api.post("fixed-asset-categories/", data),
  activate: (id, offsetAccountId) => api.post(`fixed-assets/${id}/activate/`, { offset_account_id: offsetAccountId }),
  dispose: (id, data) => api.post(`fixed-assets/${id}/dispose/`, data),
  schedules: () => api.get("fixed-asset-depreciation/"),
  runDepreciation: (data) => api.post("fixed-asset-depreciation/run/", data),
  register: () => api.get("fixed-asset-reports/register/"),
  movements: () => api.get("fixed-asset-reports/movements/"),
  disposals: () => api.get("fixed-asset-reports/disposals/"),
};
