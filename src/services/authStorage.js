// Store only the session details needed to restore authentication and organisation context.
import { normaliseCurrencyCode } from "../utils/currency";

const STORAGE_KEY = "ledgify.auth";

const emptyState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  organisations: [],
  selectedOrganisation: null,
  permissions: [],
};

export function loadAuthStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) return { ...emptyState };
    const safeOrganisation = (organisation) => organisation ? { ...organisation, base_currency: normaliseCurrencyCode(organisation.base_currency) } : null;
    return { ...emptyState, ...stored, organisations: (stored.organisations || []).map(safeOrganisation), selectedOrganisation: safeOrganisation(stored.selectedOrganisation) };
  } catch {
    return { ...emptyState };
  }
}

export function saveAuthStorage(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    user: state.user,
    organisations: state.organisations,
    selectedOrganisation: state.selectedOrganisation,
    permissions: state.permissions,
  }));
}

export function clearAuthStorage() {
  localStorage.removeItem(STORAGE_KEY);
}
