import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AI_ENABLED, parseBooleanFlag } from "../src/config/featureFlags.js";

const navigation = readFileSync(new URL("../src/routes/routeConfig.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8");
const guard = readFileSync(new URL("../src/routes/FeatureRoute.jsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/dashboard/DashboardPage.jsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/pages/settings/CompanySettingsPage.jsx", import.meta.url), "utf8");
const button = readFileSync(new URL("../src/components/ai/AskAIButton.jsx", import.meta.url), "utf8");
const aiPage = readFileSync(new URL("../src/pages/ai/AIAssistantPage.jsx", import.meta.url), "utf8");

test("AI flag defaults off and parses common boolean strings safely", () => {
  assert.equal(AI_ENABLED, false);
  for (const value of [true, "true", "TRUE", "1", "yes"]) assert.equal(parseBooleanFlag(value), true);
  for (const value of [false, "false", "FALSE", "0", "no", ""]) assert.equal(parseBooleanFlag(value, true), false);
  assert.equal(parseBooleanFlag("unexpected", false), false);
});

test("disabled AI is absent from navigation, dashboard actions, and settings", () => {
  assert.match(navigation, /AI_ENABLED \? \[\{ label: "AI Assistant"/);
  assert.match(dashboard, /AI_ENABLED && auth\.hasPermission/);
  assert.match(button, /if \(!AI_ENABLED\) return null/);
  assert.match(settings, /AI_ENABLED \? \[\{ id: "ai"/);
  assert.match(settings, /section === "ai" && !AI_ENABLED/);
  assert.match(settings, /AI_ENABLED && <article><strong>AI provider/);
});

test("direct AI routes are centrally guarded before the page can load requests", () => {
  assert.match(routes, /<AIFeatureRoute><AIAssistantPage \/><\/AIFeatureRoute>/);
  assert.match(guard, /if \(!AI_ENABLED\) return <Navigate to="\/" replace/);
  assert.match(aiPage, /aiService\.conversations\(\)/);
  assert.ok(routes.indexOf("<AIFeatureRoute>") < routes.indexOf("<AIAssistantPage"));
});
