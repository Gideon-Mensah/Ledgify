// Keep authentication and organisation-membership requests in one backend service boundary.

import { api, getPendingRefresh } from "./api.js";

import { clearAuthStorage, loadAuthStorage } from "./authStorage.js";
import { beginLogout, endLogout } from "./sessionLifecycle.js";

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
  logout: async () => {
    let tokens = loadAuthStorage();
    const pendingRefresh = getPendingRefresh();
    beginLogout();
    const revoke = (credentials) => api.post("auth/logout/", { refresh: credentials.refreshToken }, {
      skipAuth: true, retry: false, signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    try {
      // A rotation already in progress may have consumed the stored refresh token.
      // Use its result only to revoke the session; never persist it during logout.
      if (pendingRefresh) tokens = await pendingRefresh.catch(() => null) || tokens;
      if (tokens.refreshToken) {
        try {
          await revoke(tokens);
        } catch (error) {
          if (error.status !== 401) throw error;
          const refreshed = await api.post("auth/token/refresh/", { refresh: tokens.refreshToken }, {
            skipAuth: true, retry: false, signal: AbortSignal.timeout(10000),
          });
          await revoke({ accessToken: refreshed.access, refreshToken: refreshed.refresh || tokens.refreshToken });
        }
      }
    } finally {
      endLogout();
      clearAuthStorage();
    }
  },
  getCurrentUser: () => api.get("auth/me/"),
  getUserOrganisations: () => api.get("organisations/"),
  getPermissions: (organisationId) => api.get(
    `organisations/${organisationId}/my-permissions/`,
  ),
};
