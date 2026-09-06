// Monetary columns in generic API tables and exports; counts and rates stay numeric.
export function isMonetaryField(key) {
  return /(?:^|_)(?:amount|balance|price|cost|value|debit|credit|subtotal|total|paid|due|outstanding|overdue|income|expenses|profit|loss|cash|current|days_\d+)(?:$|_)/.test(key)
    && !/(?:quantity|count|rate|percent|currency|date|id|code|method|type|status|account|days_overdue)/.test(key);
}
