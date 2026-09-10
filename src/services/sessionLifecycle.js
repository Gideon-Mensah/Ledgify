// Fence asynchronous authentication work when a login or logout changes the session.
let generation = 0;
let loggingOut = false;
export const isLoggingOut = () => loggingOut;
export function beginLogout() { loggingOut = true; invalidateSession(); }
export function endLogout() { invalidateSession(); loggingOut = false; }
export const getSessionGeneration = () => generation;
export const invalidateSession = () => { generation += 1; return generation; };
export function assertCurrentSession(expected) {
  if (expected !== generation) throw new DOMException("Session changed.", "AbortError");
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "ledgify.auth" && event.newValue === null) invalidateSession();
  });
}
