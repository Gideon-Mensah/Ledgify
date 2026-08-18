import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { exportReport } from "../../utils/reportExport";

export default function ReportExportMenu({ rows = [], title, metadata = {}, disabled = false }) {
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  useEffect(() => {
    const close = (event) => { if (!container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const run = (format) => { exportReport(rows, format, title, metadata); setOpen(false); };
  return <div className="report-export" ref={container}>
    <button type="button" className="report-export-trigger" disabled={disabled || !rows.length} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Download size={16}/>Export<ChevronDown size={15}/></button>
    {open && <div className="report-export-menu" role="menu">
      <button role="menuitem" onClick={() => run("csv")}>CSV <span>Comma-separated</span></button>
      <button role="menuitem" onClick={() => run("excel")}>Excel <span>Spreadsheet</span></button>
      <button role="menuitem" onClick={() => run("pdf")}>PDF <span>Print-ready</span></button>
    </div>}
  </div>;
}
