// Calendar-date helpers. Date-only values never pass through local time or UTC
// timestamp conversion; API values are always strict YYYY-MM-DD strings.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const daysInMonth = (year, month) => month === 2
  ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
  : [4, 6, 9, 11].includes(month) ? 30 : 31;

export function isValidIsoDate(value) {
  const match = String(value ?? "").match(ISO_DATE);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function toApiDate(value, fieldName = "date") {
  const date = String(value ?? "").trim();
  if (!isValidIsoDate(date)) throw new RangeError(`Enter a valid ${fieldName}. Use the date picker to select a date.`);
  return date;
}

export function compareDateOnly(left, right) {
  return toApiDate(left).localeCompare(toApiDate(right));
}

// Howard Hinnant's civil-date algorithms: calendar arithmetic without Date.
const daysFromCivil = (year, month, day) => {
  const adjustedYear = year - (month <= 2 ? 1 : 0); const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400; const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
};
const civilFromDays = (serial) => {
  const era = Math.floor(serial / 146097); const dayOfEra = serial - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  let year = yearOfEra + era * 400; const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153); const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9); year += month <= 2 ? 1 : 0;
  return { year, month, day };
};
const pad = (value) => String(value).padStart(2, "0");

export function addCalendarDays(value, numberOfDays) {
  const date = toApiDate(value); const match = date.match(ISO_DATE); const days = Number(numberOfDays);
  if (!Number.isInteger(days)) throw new TypeError("Calendar days must be a whole number.");
  const result = civilFromDays(daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3])) + days);
  return `${String(result.year).padStart(4, "0")}-${pad(result.month)}-${pad(result.day)}`;
}

export function getOrganisationToday(timeZone = "UTC", now = new Date()) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDisplayDate(value, locale = "en-GB") {
  const date = toApiDate(value); const match = date.match(ISO_DATE);
  return new Intl.DateTimeFormat(locale || "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function formatTimestamp(value, { locale = "en-GB", timeZone = "UTC" } = {}) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(timestamp);
}
