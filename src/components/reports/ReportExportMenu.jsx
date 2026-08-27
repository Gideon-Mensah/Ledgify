import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { exportReport } from "../../utils/reportExport";

export default function ReportExportMenu({ rows = [], loadRows, title, metadata = {}, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const container = useRef(null);
  useEffect(() => {
    const close = (event) => { if (!container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const run = async (format) => { setError(""); setLoading(true); try { const exportRows = loadRows ? await loadRows() : rows; exportReport(exportRows, format, title, metadata); } catch (caught) { setError(caught?.message || "The report could not be exported."); } finally { setLoading(false); setOpen(false); } };
  return <div className="report-export" ref={container}>
    <button type="button" className="report-export-trigger" disabled={disabled || loading} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Download size={16}/>{loading ? "Preparing…" : "Export"}<ChevronDown size={15}/></button>
    {open && <div className="report-export-menu" role="menu">
      <button role="menuitem" onClick={() => void run("csv")}>CSV <span>Comma-separated</span></button>
      <button role="menuitem" onClick={() => void run("excel")}>Excel <span>Spreadsheet</span></button>
      <button role="menuitem" onClick={() => void run("pdf")}>PDF <span>Print-ready</span></button>
    </div>}
    {error && <span className="report-export-error" role="alert">{error}</span>}
  </div>;
}
