// Store only the session details needed to restore authentication and organisation context.

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
    return stored ? { ...emptyState, ...stored } : { ...emptyState };
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
