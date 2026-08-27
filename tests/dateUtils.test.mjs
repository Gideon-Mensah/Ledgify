import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  compareDateOnly,
  formatDisplayDate,
  getOrganisationToday,
  isValidIsoDate,
  toApiDate,
} from "../src/utils/dateUtils.js";

test("strict accounting dates accept real ISO calendar dates only", () => {
  assert.equal(isValidIsoDate("2024-02-29"), true);
  assert.equal(isValidIsoDate("2028-02-29"), true);
  assert.equal(isValidIsoDate("2027-02-29"), false);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-04-31"), false);
  assert.equal(isValidIsoDate("27/08/2026"), false);
  assert.equal(toApiDate(" 2026-08-27 "), "2026-08-27");
  assert.throws(() => toApiDate("08/27/2026", "invoice date"), /invoice date/);
});

test("calendar arithmetic crosses month, year, and leap boundaries without timestamps", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addCalendarDays("2026-03-29", 1), "2026-03-30");
  assert.equal(compareDateOnly("2026-08-26", "2026-08-27"), -1);
});

test("organisation today follows the organisation timezone at UTC boundaries", () => {
  const instant = new Date("2026-08-27T00:30:00.000Z");
  assert.equal(getOrganisationToday("America/New_York", instant), "2026-08-26");
  assert.equal(getOrganisationToday("Europe/London", instant), "2026-08-27");
  assert.equal(getOrganisationToday("Asia/Tokyo", instant), "2026-08-27");
  assert.equal(getOrganisationToday("Pacific/Auckland", instant), "2026-08-27");
  assert.equal(getOrganisationToday("Not/AZone", instant), "2026-08-27");
});

test("date-only display is locale-aware and remains on the selected day", () => {
  assert.equal(formatDisplayDate("2026-08-27", "en-GB"), "27/08/2026");
  assert.equal(formatDisplayDate("2026-08-27", "en-US"), "08/27/2026");
  assert.equal(formatDisplayDate("2026-08-27", "en-CA"), "2026-08-27");
  assert.equal(toApiDate("2026-08-27"), "2026-08-27");
  assert.throws(() => formatDisplayDate("2026-08-32"), RangeError);
});
