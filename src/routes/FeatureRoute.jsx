import { Navigate } from "react-router-dom";
import { AI_ENABLED, CONSOLIDATION_ENABLED } from "../config/featureFlags";

export function AIFeatureRoute({ children }) {
  if (!AI_ENABLED) return <Navigate to="/" replace state={{ notice: "The AI Assistant is currently unavailable." }} />;
  return children;
}

export function ConsolidationFeatureRoute({ children }) {
  if (!CONSOLIDATION_ENABLED) return <Navigate to="/" replace />;
  return children;
}
