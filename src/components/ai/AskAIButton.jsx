import { Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

export default function AskAIButton({ prompt, label = "Ask AI" }) {
  const location = useLocation();
  const query = new URLSearchParams({ prompt, route: location.pathname });
  return <Link className="invoice-secondary-button ask-ai-button" to={`/ai?${query.toString()}`}><Sparkles size={15}/>{label}</Link>;
}
