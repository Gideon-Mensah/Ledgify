export function normaliseApiError(error, fallback = "Something went wrong.") {
  const data = error?.data;
  if (typeof data?.detail === "string") return data.detail;
  if (data && typeof data === "object") {
    const messages = Object.entries(data).flatMap(([field, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return values.map((message) => field === "non_field_errors"
        ? String(message)
        : `${field.replaceAll("_", " ")}: ${message}`);
    });
    if (messages.length) return messages.join(" ");
  }
  if (error?.status === 403) return "You do not have permission to perform this action.";
  if (error?.status === 404) return "The requested record was not found.";
  if (error?.status >= 500) return "The server could not complete the request.";
  return error?.message || fallback;
}
