import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONSOLIDATION_ENABLED } from "../src/config/featureFlags.js";
import { api } from "../src/services/api.js";
import { authService } from "../src/services/authService.js";
import { saveAuthStorage, loadAuthStorage } from "../src/services/authStorage.js";

const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function storage() {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  saveAuthStorage({ accessToken: "access-for-test", refreshToken: "refresh-for-test", organisations: [], permissions: [] });
}
const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("consolidation defaults off, hides navigation and settings, and guards direct routes", () => {
  assert.equal(CONSOLIDATION_ENABLED, false);
  assert.match(source("routes/routeConfig.js"), /CONSOLIDATION_ENABLED \? \[\{ label: "Consolidation"/);
  assert.match(source("pages/settings/CompanySettingsPage.jsx"), /CONSOLIDATION_ENABLED \? \[\{ id: "consolidation"/);
  assert.match(source("pages/settings/CompanySettingsPage.jsx"), /section === "consolidation" && !CONSOLIDATION_ENABLED/);
  assert.match(source("routes/FeatureRoute.jsx"), /if \(!CONSOLIDATION_ENABLED\) return <Navigate to="\/" replace/);
  assert.match(source("routes/AppRoutes.jsx"), /<ConsolidationFeatureRoute><ConsolidationPage \/><\/ConsolidationFeatureRoute>/);
});

test("logout sends the refresh token before clearing local state", async () => {
  storage();
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith("/auth/logout/"));
    assert.equal(loadAuthStorage().refreshToken, "refresh-for-test");
    assert.equal(JSON.parse(options.body).refresh, "refresh-for-test");
    assert.equal(options.headers.Authorization, "Bearer access-for-test");
    return new Response(null, { status: 204 });
  };
  await authService.logout();
  assert.equal(loadAuthStorage().accessToken, null);
  assert.equal(loadAuthStorage().refreshToken, null);
});

test("local logout completes even when the API is unavailable", async () => {
  storage();
  globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
  await assert.rejects(authService.logout(), /Network unavailable/);
  assert.equal(loadAuthStorage().refreshToken, null);
});

test("an in-flight refresh cannot restore tokens or retry a request after logout", async () => {
  storage();
  let finishRefresh, markRefreshStarted;
  const started = new Promise((resolve) => { markRefreshStarted = resolve; });
  let requests = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/token/refresh/")) {
      markRefreshStarted();
      return new Promise((resolve) => { finishRefresh = resolve; });
    }
    if (url.endsWith("/auth/logout/")) return new Response(null, { status: 204 });
    requests += 1;
    return json({ detail: "Expired" }, 401);
  };
  const pending = api.get("auth/me/");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await started;
  const loggingOut = authService.logout();
  finishRefresh(json({ access: "late-access", refresh: "late-refresh" }));
  await loggingOut;
  await rejected;
  assert.equal(loadAuthStorage().accessToken, null);
  assert.equal(loadAuthStorage().refreshToken, null);
  assert.equal(requests, 1);
});

test("a late authenticated response is discarded after logout", async () => {
  storage();
  let finish;
  globalThis.fetch = async (url) => url.endsWith("/auth/logout/")
    ? new Response(null, { status: 204 })
    : new Promise((resolve) => { finish = resolve; });
  const pending = api.get("auth/me/");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await authService.logout();
  finish(json({ email: "old-session@example.invalid" }));
  await rejected;
});

test("no new refresh starts while logout is pending", async () => {
  storage();
  let finishLogout;
  let refreshes = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/logout/")) return new Promise((resolve) => { finishLogout = resolve; });
    if (url.endsWith("/auth/token/refresh/")) refreshes += 1;
    return json({}, 401);
  };
  const loggingOut = authService.logout();
  await assert.rejects(api.get("auth/me/"), { name: "AbortError" });
  assert.equal(loadAuthStorage().refreshToken, "refresh-for-test");
  finishLogout(new Response(null, { status: 204 }));
  await loggingOut;
  assert.equal(refreshes, 0);
  assert.equal(loadAuthStorage().refreshToken, null);
});

test("logout can revoke a session whose access token has expired", async () => {
  storage();
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/token/refresh/")) return json({ access: "temporary-access", refresh: "temporary-refresh" });
    attempts += 1;
    if (attempts === 1) return json({}, 401);
    assert.equal(options.headers.Authorization, "Bearer temporary-access");
    assert.equal(JSON.parse(options.body).refresh, "temporary-refresh");
    assert.equal(loadAuthStorage().refreshToken, "refresh-for-test");
    return new Response(null, { status: 204 });
  };
  await authService.logout();
  assert.equal(attempts, 2);
  assert.equal(loadAuthStorage().refreshToken, null);
});
