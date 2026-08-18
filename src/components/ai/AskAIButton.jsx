import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export default function AskAIButton({ prompt, label = "Ask AI" }) {
  return <Link className="invoice-secondary-button ask-ai-button" to={`/ai?prompt=${encodeURIComponent(prompt)}`}><Sparkles size={15}/>{label}</Link>;
}
