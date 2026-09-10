import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentSubmission } from "../src/utils/paymentSubmission.js";

test("payment retry retains key; double click is suppressed; changed payload gets a new key", () => {
  const submission = createPaymentSubmission();
  const payload = { document: "invoice-1", amount: "20.00" };
  const key = submission.begin(payload);
  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal(submission.begin(payload), null);
  submission.finish();
  assert.equal(submission.begin(payload), key);
  submission.finish();
  assert.notEqual(submission.begin({ ...payload, amount: "21.00" }), key);
  submission.complete();
  assert.notEqual(submission.begin(payload), key);
});
