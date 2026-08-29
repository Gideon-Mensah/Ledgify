const TRUE_VALUES = new Set(["true", "1", "yes"]);
const FALSE_VALUES = new Set(["false", "0", "no", ""]);

export function parseBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalised = String(value ?? "").trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  return fallback;
}

// AI is temporarily disabled through a reversible feature flag.
export const AI_ENABLED = parseBooleanFlag(import.meta.env?.VITE_AI_ENABLED, false);
