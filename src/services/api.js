// Send authenticated API requests for the selected organisation and refresh expired access tokens once.

import { clearAuthStorage, loadAuthStorage, saveAuthStorage } from "./authStorage";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL
  || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");

let refreshPromise = null;
let authFailureHandler = null;

export function setAuthFailureHandler(handler) {
  authFailureHandler = handler;
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  const stored = loadAuthStorage();
  if (!stored.refreshToken) throw new Error("Your session has expired.");
  refreshPromise = fetch(`${API_BASE_URL}/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: stored.refreshToken }),
  }).then(async (response) => {
    const data = await parseResponse(response);
    if (!response.ok) throw Object.assign(new Error("Your session has expired."), {
      status: response.status, data,
    });
    const next = {
      ...stored,
      accessToken: data.access,
      refreshToken: data.refresh || stored.refreshToken,
    };
    saveAuthStorage(next);
    return next.accessToken;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const { skipAuth = false, retry = true, headers = {}, responseType, ...requestOptions } = options;
  const stored = loadAuthStorage();
  const requestHeaders = { Accept: "application/json", ...headers };
  if (requestOptions.body && !(requestOptions.body instanceof FormData)) {
    requestHeaders["Content-Type"] ||= "application/json";
  }
  if (!skipAuth && stored.accessToken) {
    requestHeaders.Authorization = `Bearer ${stored.accessToken}`;
  }
  if (!skipAuth && stored.selectedOrganisation?.id) {
    requestHeaders["X-Organisation-ID"] = stored.selectedOrganisation.id;
  }
  const response = await fetch(`${API_BASE_URL}/${path.replace(/^\//, "")}`, {
    ...requestOptions, headers: requestHeaders,
  });
  if (response.status === 401 && retry && !skipAuth && stored.refreshToken) {
    try {
      await refreshAccessToken();
      return apiRequest(path, { ...options, retry: false });
    } catch (error) {
      clearAuthStorage();
      authFailureHandler?.();
      throw error;
    }
  }
  const data = responseType === "blob" ? await response.blob() : await parseResponse(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Request failed with status ${response.status}`), {
      status: response.status, data,
    });
  }
  return data;
}

export const api = {
  get: (path, options) => apiRequest(path, { ...options, method: "GET" }),
  post: (path, body, options) => apiRequest(path, {
    ...options, method: "POST", body: JSON.stringify(body),
  }),
  postForm: (path, body, options) => apiRequest(path, { ...options, method: "POST", body }),
  download: (path, options) => apiRequest(path, { ...options, method: "GET", responseType: "blob" }),
  patch: (path, body, options) => apiRequest(path, {
    ...options, method: "PATCH", body: JSON.stringify(body),
  }),
  delete: (path, options) => apiRequest(path, { ...options, method: "DELETE" }),
};
