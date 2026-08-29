import { Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { AI_ENABLED } from "../../config/featureFlags";

export default function AskAIButton({ prompt, label = "Ask AI" }) {
  const location = useLocation();
  if (!AI_ENABLED) return null;
  const query = new URLSearchParams({ prompt, route: location.pathname });
  return <Link className="invoice-secondary-button ask-ai-button" to={`/ai?${query.toString()}`}><Sparkles size={15}/>{label}</Link>;
}
