import { loadAuthStorage } from "../../services/authStorage";
import { api } from "../../services/api";
import { useAuth } from "../../store/AuthContext";
import { documentIdentity } from "../../utils/documentIdentity";
import { printReport } from "../../utils/printReport";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Printer } from "lucide-react";
import { exportReport } from "../../utils/reportExport";

export default function ReportExportMenu({ rows = [], loadRows, title, metadata = {}, disabled = false, printOnly = false }) {
  const auth=useAuth();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const container = useRef(null);
  useEffect(() => {
    const close = (event) => { if (!container.current?.contains(event.target)) setOpen(false); };
    const escape=(event)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("keydown",escape);
    document.addEventListener("pointerdown", close);
    return () => {document.removeEventListener("pointerdown", close);document.removeEventListener("keydown",escape);};
  }, []);
  const run = async (format) => { setError(""); setLoading(true); try { const organisationId=auth.selectedOrganisation.id;const validateContext=()=>{if(loadAuthStorage().selectedOrganisation?.id!==organisationId)throw new Error("Organisation changed. Reopen the report before exporting.");};const exportRows = loadRows ? await loadRows() : rows; const organisation=await api.get(`organisations/${auth.selectedOrganisation.id}/`);const details={...metadata,organisation:organisation.legal_name||organisation.name,currency:metadata.currency||organisation.base_currency,identity:documentIdentity(organisation)}; validateContext();if(format==="print")await printReport(exportRows,title,details,validateContext);else exportReport(exportRows, format, title, details); } catch (caught) { setError(caught?.message || "The report could not be exported."); } finally { setLoading(false); setOpen(false); } };
  if(!auth.hasPermission("export_reports"))return null;
  if(printOnly)return <div className="report-export"><button type="button" className="invoice-secondary-button" disabled={disabled || loading} onClick={()=>void run("print")}><Printer size={16}/>{loading?"Preparing…":"Print"}</button>{error && <span className="report-export-error" role="alert">{error}</span>}</div>;
  return <div className="report-export" ref={container}>
    <button type="button" className="report-export-trigger" disabled={disabled || loading} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Download size={16}/>{loading ? "Preparing…" : "Export"}<ChevronDown size={15}/></button>
    {open && <div className="report-export-menu" role="menu">
      <button role="menuitem" onClick={() => void run("print")}>Print</button>
      <button role="menuitem" onClick={() => void run("csv")}>CSV <span>Comma-separated</span></button>
      <button role="menuitem" onClick={() => void run("excel")}>Excel <span>Spreadsheet</span></button>
      <button role="menuitem" onClick={() => void run("pdf")}>PDF <span>Print-ready</span></button>
    </div>}
    {error && <span className="report-export-error" role="alert">{error}</span>}
  </div>;
}
