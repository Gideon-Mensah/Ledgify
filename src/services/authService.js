// Keep authentication and organisation-membership requests in one backend service boundary.

import { api } from "./api";

export const authService = {
  login: (credentials) => api.post("auth/token/", credentials, { skipAuth: true }),
  refreshAccessToken: (refresh) => api.post(
    "auth/token/refresh/", { refresh }, { skipAuth: true },
  ),
  requestPasswordReset: (email) => api.post(
    "auth/password-reset/request/", { email }, { skipAuth: true },
  ),
  confirmPasswordReset: (payload) => api.post(
    "auth/password-reset/confirm/", payload, { skipAuth: true },
  ),
  logout: () => Promise.resolve(),
  getCurrentUser: () => api.get("auth/me/"),
  getUserOrganisations: () => api.get("organisations/"),
  getPermissions: (organisationId) => api.get(
    `organisations/${organisationId}/my-permissions/`,
  ),
};
