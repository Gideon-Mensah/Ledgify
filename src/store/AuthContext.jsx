// Restore the user session, selected organisation, and its explicit backend permissions.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { authService } from "../services/authService";
import { clearAuthStorage, loadAuthStorage, saveAuthStorage } from "../services/authStorage";
import { setAuthFailureHandler } from "../services/api";

import { getSessionGeneration, assertCurrentSession, invalidateSession } from "../services/sessionLifecycle.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [auth, setAuth] = useState(loadAuthStorage);
  const [isLoading, setIsLoading] = useState(true);

  const commit = useCallback((next) => {
    const generation = getSessionGeneration();
    setAuth((current) => {
      if (generation !== getSessionGeneration()) return current;
      const value = typeof next === "function" ? next(current) : next;
      saveAuthStorage(value);
      return value;
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Local sign-out still succeeds when the server is unavailable.
    } finally {
      setAuth(loadAuthStorage());
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const loadPermissions = useCallback(async (organisation) => {
    if (!organisation) return [];
    const result = await authService.getPermissions(organisation.id);
    return result.permissions || [];
  }, []);

  const resolveSession = useCallback(async (tokens = null) => {
    const generation = getSessionGeneration();
    if (tokens) commit((current) => ({
      ...current, accessToken: tokens.access,
      refreshToken: tokens.refresh || current.refreshToken,
    }));
    const [user, organisations] = await Promise.all([
      authService.getCurrentUser(), authService.getUserOrganisations(),
    ]);
    assertCurrentSession(generation);
    const stored = loadAuthStorage();
    let selected = stored.selectedOrganisation
      ? organisations.find((item) => item.id === stored.selectedOrganisation.id)
      : null;
    if (!selected && organisations.length === 1) selected = organisations[0];
    const resolved = { ...stored, user, organisations, selectedOrganisation: selected };
    // Permission requests must start with the same scope they will finish with;
    // React may defer commit's state updater until after this request starts.
    saveAuthStorage(resolved);
    commit(resolved);
    const permissions = selected ? await loadPermissions(selected) : [];
    assertCurrentSession(generation);
    commit((current) => ({ ...current, permissions }));
    return { organisations, selected };
  }, [commit, loadPermissions]);

  const login = useCallback(async (credentials) => {
    const generation = invalidateSession();
    const tokens = await authService.login(credentials);
    assertCurrentSession(generation);
    const stored = loadAuthStorage();
    saveAuthStorage({
      ...stored, accessToken: tokens.access, refreshToken: tokens.refresh,
    });
    setAuth(loadAuthStorage());
    return resolveSession(tokens);
  }, [resolveSession]);

  const selectOrganisation = useCallback(async (organisation) => {
    const generation = getSessionGeneration();
    // Persist before mounting the new organisation so effects use its request scope.
    saveAuthStorage({ ...loadAuthStorage(), selectedOrganisation: organisation, permissions: [] });
    commit((current) => ({ ...current, selectedOrganisation: organisation, permissions: [] }));
    const permissions = await loadPermissions(organisation);
    assertCurrentSession(generation);
    commit((current) => current.selectedOrganisation?.id === organisation.id ? { ...current, permissions } : current);
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
      const generation = getSessionGeneration();
      try {
        await resolveSession();
      } catch {
        if (generation !== getSessionGeneration()) return;
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
