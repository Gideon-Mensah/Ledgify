import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forgot = readFileSync(new URL("../src/pages/auth/ForgotPasswordPage.jsx", import.meta.url), "utf8");
const reset = readFileSync(new URL("../src/pages/auth/ResetPasswordPage.jsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/pages/auth/LoginPage.jsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/services/authService.js", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("forgot password is linked, validates email, submits publicly, and stays neutral", () => {
  assert.match(login, /to="\/forgot-password"/); assert.match(forgot, /Forgot your password\?/);
  assert.match(forgot, /Enter a valid email address/); assert.match(forgot, /If an account exists for that email address/);
  assert.match(forgot, /disabled=\{submitting\}/); assert.match(service, /requestPasswordReset/); assert.match(service, /skipAuth: true/);
});
test("reset route consumes URL parameters and provides validation and completion states", () => {
  assert.match(routes, /reset-password\/:uid\/:token/); assert.match(reset, /const \{ uid, token \} = useParams\(\)/);
  assert.match(reset, /The passwords do not match/); assert.match(reset, /invalid or has expired/);
  assert.match(reset, /has been reset successfully/); assert.match(reset, /to="\/login"/); assert.match(reset, /no-referrer/);
});
test("reset secrets are sent only in request bodies and never browser storage", () => {
  assert.doesNotMatch(forgot + reset + service, /localStorage|sessionStorage/); assert.match(service, /confirmPasswordReset/); assert.match(service, /password-reset\/confirm/);
});
test("Vercel rewrites direct reset navigation to the SPA", () => {
  assert.deepEqual(vercel.rewrites, [{ source: "/(.*)", destination: "/index.html" }]);
});
