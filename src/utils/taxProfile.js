/** Dates are organisation-local ISO dates; selecting a profile never uses UTC conversion. */
export function taxProfileOn(profiles, point) {
  return profiles.filter(profile => profile.status === 'ACTIVE' && profile.effective_from <= point)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version - a.version)[0] || null;
}
