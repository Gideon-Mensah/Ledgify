// Restore the user session, selected organisation, and its explicit backend permissions.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { authService } from "../services/authService";
import { clearAuthStorage, loadAuthStorage, saveAuthStorage } from "../services/authStorage";
import { setAuthFailureHandler } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [auth, setAuth] = useState(loadAuthStorage);
  const [isLoading, setIsLoading] = useState(true);

  const commit = useCallback((next) => {
    setAuth((current) => {
      const value = typeof next === "function" ? next(current) : next;
      saveAuthStorage(value);
      return value;
    });
  }, []);

  const logout = useCallback(() => {
    clearAuthStorage();
    setAuth(loadAuthStorage());
    navigate("/login", { replace: true });
  }, [navigate]);

  const loadPermissions = useCallback(async (organisation) => {
    if (!organisation) return [];
    const result = await authService.getPermissions(organisation.id);
    return result.permissions || [];
  }, []);

  const resolveSession = useCallback(async (tokens = null) => {
    if (tokens) commit((current) => ({
      ...current, accessToken: tokens.access,
      refreshToken: tokens.refresh || current.refreshToken,
    }));
    const [user, organisations] = await Promise.all([
      authService.getCurrentUser(), authService.getUserOrganisations(),
    ]);
    const stored = loadAuthStorage();
    let selected = stored.selectedOrganisation
      ? organisations.find((item) => item.id === stored.selectedOrganisation.id)
      : null;
    if (!selected && organisations.length === 1) selected = organisations[0];
    commit({ ...stored, user, organisations, selectedOrganisation: selected });
    const permissions = selected ? await loadPermissions(selected) : [];
    commit((current) => ({ ...current, permissions }));
    return { organisations, selected };
  }, [commit, loadPermissions]);

  const login = useCallback(async (credentials) => {
    const tokens = await authService.login(credentials);
    const stored = loadAuthStorage();
    saveAuthStorage({
      ...stored, accessToken: tokens.access, refreshToken: tokens.refresh,
    });
    setAuth(loadAuthStorage());
    return resolveSession(tokens);
  }, [resolveSession]);

  const selectOrganisation = useCallback(async (organisation) => {
    commit((current) => ({ ...current, selectedOrganisation: organisation, permissions: [] }));
    const permissions = await loadPermissions(organisation);
    commit((current) => ({ ...current, permissions }));
  }, [commit, loadPermissions]);

  useEffect(() => {
    setAuthFailureHandler(logout);
    return () => setAuthFailureHandler(null);
  }, [logout]);

  useEffect(() => {
    let active = true;
    async function bootstrapAuth() {
      const stored = loadAuthStorage();
      if (!stored.accessToken && !stored.refreshToken) {
        if (active) setIsLoading(false);
        return;
      }
      try {
        await resolveSession();
      } catch {
        clearAuthStorage();
        if (active) setAuth(loadAuthStorage());
      } finally {
        if (active) setIsLoading(false);
      }
    }
    bootstrapAuth();
    return () => { active = false; };
  }, [resolveSession]);

  const value = useMemo(() => ({
    ...auth,
    isLoading,
    isAuthenticated: Boolean(auth.accessToken || auth.refreshToken),
    login,
    logout,
    selectOrganisation,
    bootstrapAuth: resolveSession,
    hasPermission: (permission) => auth.permissions.includes(permission),
  }), [auth, isLoading, login, logout, selectOrganisation, resolveSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Auth state and its hook intentionally live together as one store module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
