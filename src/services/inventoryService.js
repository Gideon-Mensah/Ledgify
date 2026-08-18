// Use backend stock workflows so quantity and weighted-average cost stay authoritative.

import { api } from "./api";

const query = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const value = search.toString();
  return value ? `?${value}` : "";
};

export const inventoryService = {
  products: (params) => api.get(`products/${query(params)}`),
  product: (id) => api.get(`products/${id}/`),
  createProduct: (data) => api.post("products/", data),
  updateProduct: (id, data) => api.patch(`products/${id}/`, data),
  archiveProduct: (id) => api.delete(`products/${id}/`),
  productStock: (id) => api.get(`products/${id}/stock/`),
  warehouses: (params) => api.get(`warehouses/${query(params)}`),
  createWarehouse: (data) => api.post("warehouses/", data),
  updateWarehouse: (id, data) => api.patch(`warehouses/${id}/`, data),
  movements: (params) => api.get(`stock-movements/${query(params)}`),
  createAdjustment: (data) => api.post("stock-adjustments/", data),
  valuation: (params) => api.get(`inventory/valuation/${query(params)}`),
  transactions: (params) => api.get(`inventory-transactions/${query(params)}`),
  receivePurchase: (data) => api.post("inventory-transactions/purchase-receipts/", data),
  issueSale: (data) => api.post("inventory-transactions/sales-issues/", data),
  transfer: (data) => api.post("inventory-transactions/transfer/", data),
  customerReturn: (data) => api.post("inventory-transactions/customer-returns/", data),
  supplierReturn: (data) => api.post("inventory-transactions/supplier-returns/", data),
  stockCounts: () => api.get("stock-counts/"),
  createStockCount: (data) => api.post("stock-counts/", data),
  startStockCount: (id) => api.post(`stock-counts/${id}/start/`, {}),
  postStockCount: (id, counts) => api.post(`stock-counts/${id}/post/`, { counts }),
  report: (name, params) => api.get(`inventory/reports/${name}/${query(params)}`),
  receiveInventory: (data) => api.post("inventory-transactions/purchase-receipts/", data),
  issueInventory: (data) => api.post("inventory-transactions/sales-issues/", data),
  transferInventory: (data) => api.post("inventory-transactions/transfer/", data),
  getInventoryTransactions: (params) => api.get(`inventory-transactions/${query(params)}`),
  getStockCounts: () => api.get("stock-counts/"),
  getStockOnHand: (params) => api.get(`inventory/reports/stock-on-hand/${query(params)}`),
  getInventoryValuation: (params) => api.get(`inventory/reports/valuation/${query(params)}`),
  getReorderReport: (params) => api.get(`inventory/reports/reorder/${query(params)}`),
};
