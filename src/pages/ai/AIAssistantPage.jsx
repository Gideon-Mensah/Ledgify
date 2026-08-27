// Ask for organisation-scoped analysis while keeping accounting actions user-controlled.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Archive, Bot, ChevronRight, Clock3, History, MessageSquare, Plus, Send, ShieldCheck, Sparkles } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { aiService } from "../../services/aiService";
import { normaliseApiError } from "../../services/apiError";
import { useAuth } from "../../store/AuthContext";
import "../../styles/aiAssistant.css";

const categories = {
  "Financial Performance": ["How is my business performing this month?", "Explain my Profit & Loss.", "Explain my Balance Sheet."],
  "Cash Flow": ["How much cash do I have?", "Explain my cash flow this month."],
  Customers: ["Who owes us the most?", "Which customer balances are overdue?"],
  Suppliers: ["What bills are due soon?", "Which supplier balances need attention?"],
  Banking: ["What bank transactions remain unreconciled?"],
  Inventory: ["What stock needs reordering?", "Explain my current inventory value."],
  Manufacturing: ["Which production orders are at risk?", "Are there material shortages?"],
  Tax: ["Summarise my current indirect tax position."],
  Payroll: ["Summarise the latest payroll."],
  "Fixed Assets": ["What assets are fully depreciated?", "Explain recent depreciation and net book value changes."],
};
const sourceRoutes = {
  profit_loss: "/accounting/profit-and-loss", balance_sheet: "/accounting/balance-sheet", cash_flow: "/accounting/cash-flow",
  aged_receivables: "/accounting/aged-receivables", aged_payables: "/accounting/aged-payables", inventory_reports: "/inventory/reports",
  manufacturing_reports: "/manufacturing/reports", fixed_assets: "/fixed-assets",
};
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";

function SourceList({ metadata }) {
  if (!metadata?.sources?.length) return null;
  return <div className="ai-sources"><strong>Sources</strong><div>{metadata.sources.map((source, index) => {
    const period = Object.values(source.period || {}).filter(Boolean).join(" – ");
    const route = sourceRoutes[source.source_type] || (source.source_type === "ledgify_help" ? source.route : null);
    const content = <><span>{title(source.source_type)}</span>{period && <small>{period}</small>}</>;
    return route ? <a key={index} href={route}>{content}<ChevronRight size={14}/></a> : <div className="ai-source-chip" key={index}>{content}</div>;
  })}</div></div>;
}

function Message({ item }) {
  const assistant = item.role === "assistant";
  return <article className={`ai-message ai-message-${assistant ? "assistant" : "user"}`}>
    <div className="ai-message-avatar">{assistant ? <Bot size={17}/> : "You"}</div>
    <div className="ai-message-body"><div className="ai-message-label">{assistant ? "Ledgify AI" : "You"}</div><p>{item.content}</p>
      {assistant && <><SourceList metadata={item.metadata}/><div className="ai-message-meta">{item.metadata?.data_as_of && <span>Data as of {item.metadata.data_as_of}</span>}{item.metadata?.confidence && <span>{title(item.metadata.confidence)} confidence</span>}</div>{item.metadata?.limitations?.length > 0 && <details><summary>Limitations</summary>{item.metadata.limitations.map((value) => <p key={value}>{value}</p>)}</details>}</>}
    </div>
  </article>;
}

export default function AIAssistantPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const contextualPrompt = searchParams.get("prompt") || "";
  const sourceRoute = searchParams.get("route") || "";
  const [question, setQuestion] = useState(contextualPrompt);
  const [conversation, setConversation] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [category, setCategory] = useState("Financial Performance");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const canUseActions = auth.hasPermission("use_ai_actions");
  const canViewInsights = auth.hasPermission("view_ai_insights");

  const loadPanels = useCallback(async () => {
    try {
      const requests = [aiService.conversations()];
      if (canUseActions) requests.push(aiService.actions()); else requests.push(Promise.resolve([]));
      if (canViewInsights) requests.push(aiService.anomalies()); else requests.push(Promise.resolve([]));
      const [chatRows, actionRows, anomalyRows] = await Promise.all(requests);
      setConversations((Array.isArray(chatRows) ? chatRows : chatRows.results || []).filter((item) => item.status !== "archived"));
      setActions(Array.isArray(actionRows) ? actionRows : actionRows.results || []);
      setAnomalies(Array.isArray(anomalyRows) ? anomalyRows : anomalyRows.results || []);
    } catch (requestError) { setError(normaliseApiError(requestError)); }
  }, [canUseActions, canViewInsights, setActions, setAnomalies, setConversations, setError]);
  useEffect(() => { const frame = requestAnimationFrame(() => void loadPanels()); return () => cancelAnimationFrame(frame); }, [loadPanels]);

  const newChat = () => { setConversation(null); setMessages([]); setQuestion(""); setError(""); };
  const openConversation = async (item) => {
    try { const result = await aiService.conversation(item.id); setConversation(result); setMessages(result.messages || []); setHistoryOpen(false); }
    catch (requestError) { setError(normaliseApiError(requestError)); }
  };
  const archive = async (event, item) => {
    event.stopPropagation();
    try { await aiService.updateConversation(item.id, { status: "archived" }); if (conversation?.id === item.id) newChat(); await loadPanels(); }
    catch (requestError) { setError(normaliseApiError(requestError)); }
  };
  const send = async (value = question) => {
    if (!value.trim() || loading) return;
    setLoading(true); setError(""); setMessages((items) => [...items, { role: "user", content: value }]); setQuestion("");
    try {
      const result = await aiService.chat(value, conversation?.id, contextualPrompt ? { context: contextualPrompt } : {}, {
        route: sourceRoute,
        page_title: document.title.slice(0, 100),
      });
      setConversation(result.conversation); setMessages(result.conversation.messages || [...messages, { role: "user", content: value }, result.message]); await loadPanels();
    } catch (requestError) { setError(normaliseApiError(requestError, "The assistant could not answer that request. Please try again.")); }
    finally { setLoading(false); }
  };
  const latestMetadata = useMemo(() => [...messages].reverse().find((item) => item.metadata)?.metadata, [messages]);
  const provider = latestMetadata?.provider;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";

  return <div className="ai-page">
    <PageHeader eyebrow="Intelligent assistance" title="Ledgify AI" description="Ask questions about your finances, spot risks and prepare accounting work." action={<div className="ai-header-actions"><span className="ai-mode"><ShieldCheck size={15}/>{provider?.enabled ? "Assistant available" : "Deterministic mode"}</span><button className="invoice-secondary-button ai-panel-toggle" onClick={() => setHistoryOpen(true)}><History size={16}/>History</button><button className="page-primary-button" onClick={newChat}><Plus size={16}/>New conversation</button></div>}/>
    {error && <div className="invoice-form-alert" role="alert">{error}</div>}
    <div className="ai-shell">
      <aside className={`ai-history ${historyOpen ? "is-open" : ""}`}><div className="ai-panel-head"><div><span>Conversations</span><strong>Recent</strong></div><button className="ai-mobile-close" onClick={() => setHistoryOpen(false)}>Close</button></div><button className="ai-new-chat" onClick={newChat}><Plus size={16}/>New chat</button><div className="ai-conversation-list">{conversations.length ? conversations.map((item) => <button className={conversation?.id === item.id ? "active" : ""} key={item.id} onClick={() => void openConversation(item)}><MessageSquare size={16}/><span><strong>{item.title}</strong><small><Clock3 size={12}/>{dateTime(item.updated_at)}</small></span><i onClick={(event) => void archive(event, item)} title="Archive conversation"><Archive size={14}/></i></button>) : <div className="ai-panel-empty">Your conversations will appear here.</div>}</div></aside>
      <main className="ai-conversation"><div className="ai-conversation-scroll">{!messages.length ? <div className="ai-welcome"><div className="ai-welcome-icon"><Sparkles size={25}/></div><span>Ledgify accounting copilot</span><h2>{greeting}. What would you like to understand about your business?</h2><p>Ask for an explanation or analysis. Ledgify AI cannot post financial transactions automatically.</p><div className="ai-category-list">{Object.keys(categories).map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="ai-prompt-grid">{categories[category].map((item) => <button key={item} onClick={() => void send(item)}><span>{item}</span><ChevronRight size={17}/></button>)}</div></div> : <div className="ai-messages">{messages.filter((item) => ["user", "assistant"].includes(item.role)).map((item, index) => <Message item={item} key={item.id || index}/>)}{loading && <div className="ai-generating"><Sparkles size={17}/><span>Analysing your financial data…</span><i/><i/><i/></div>}</div>}</div>
        <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea rows="2" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about your finances…" aria-label="Message Ledgify AI"/><button disabled={!question.trim() || loading} aria-label="Send message"><Send size={18}/></button><small>Enter to send · Shift+Enter for a new line</small></form>
      </main>
      <aside className={`ai-context ${contextOpen ? "is-open" : ""}`}><div className="ai-panel-head"><div><span>Financial context</span><strong>Insights &amp; actions</strong></div><button className="ai-mobile-close" onClick={() => setContextOpen(false)}>Close</button></div><section><div className="ai-section-title"><h3>Anomalies</h3>{auth.hasPermission("view_ai_insights") && <button onClick={() => aiService.detect().then(setAnomalies).catch((requestError) => setError(normaliseApiError(requestError)))}>Refresh</button>}</div>{anomalies.length ? anomalies.slice(0, 5).map((item) => <article className={`ai-anomaly severity-${item.severity}`} key={item.id}><div><span>{title(item.severity)}</span><small>{title(item.status)}</small></div><strong>{item.summary}</strong><p>{title(item.source_type)} · {dateTime(item.detected_at)}</p>{item.status === "open" && <div><button onClick={() => aiService.review(item.id, "reviewed").then(loadPanels)}>Review</button><button onClick={() => aiService.review(item.id, "dismissed").then(loadPanels)}>Dismiss</button></div>}</article>) : <div className="ai-panel-empty">No open anomalies.</div>}</section><section><h3>Draft action proposals</h3><p className="ai-safety-note">This transaction was drafted by the AI Assistant. Review all accounts, dates, tax treatments, and amounts before approving. Creating it here produces a draft only.</p>{actions.length ? actions.slice(0, 4).map((item) => { const payload = item.proposed_payload?.payload; return <article className="ai-proposal" key={item.id}><span>{title(item.action_type)}</span><strong>{item.proposed_payload?.summary || item.requested_action}</strong><small>{title(item.status)}{payload?.date ? ` · ${payload.date}` : ""}</small>{payload?.lines?.length > 0 && <div className="ai-proposal-lines">{payload.lines.map((line, index) => <div key={`${line.account_id}-${index}`}><span>{line.account?.code} · {line.account?.name}</span><small>{Number(line.debit) ? `Debit ${line.debit}` : `Credit ${line.credit}`}</small></div>)}</div>}{item.proposed_payload?.warnings?.map((warning) => <p key={warning}>{warning}</p>)}{item.status === "proposed" && auth.hasPermission("use_ai_actions") && <button onClick={() => aiService.execute(item.id).then(loadPanels).catch((requestError) => setError(normaliseApiError(requestError)))}>Create draft for review</button>}</article>; }) : <div className="ai-panel-empty">No action proposals.</div>}</section></aside>
    </div><button className="ai-context-toggle" onClick={() => setContextOpen(true)}>Insights</button>{(historyOpen || contextOpen) && <button className="ai-drawer-overlay" aria-label="Close panels" onClick={() => { setHistoryOpen(false); setContextOpen(false); }}/>}</div>;
}
