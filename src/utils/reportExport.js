import { presentReport, reportAmount, reportMetadata } from "./reportPresentation.js";
import { resolveCurrencyCode } from "./currency.js";
// Turn structured report rows into CSV, spreadsheet, or printable PDF output.

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { createXlsxWorkbook } from "./xlsxWorkbook.js";

const formulaPrefix = /^\s*[=+\-@]/;
const safeText = (value) => {
  const text = String(value ?? "");
  return formulaPrefix.test(text) ? `'${text}` : text;
};
export const safeFilename = (value) => String(value || "report").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "report";
export const saveBlob = (blob, name) => {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("The export did not contain any downloadable data.");
  const link = document.createElement("a"); const url = URL.createObjectURL(blob); link.href = url; link.download = safeFilename(name); document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
export function exportReport(rows, format, title, metadata = {}) {
  if(rows?.length>10000)throw new Error("Select a shorter report period (maximum 10,000 rows).");
  if(!Array.isArray(rows)||!rows.length)throw new Error("No report data is available to export.");
  metadata = { ...metadata, currency: resolveCurrencyCode(metadata.currency) };
  rows = rows.map((row) => ({ ...row, currency: row.currency || metadata.currency }));
  const sections = presentReport(rows, title, metadata);
  const columns = [...new Set(sections.flatMap(section=>section.columns.map(c=>c.label)))];
  const body = sections.flatMap(section=>[...(section.heading?[[section.heading]]:[]),...section.rows.map(row=>columns.map(label=>{const c=section.columns.find(c=>c.label===label);return c?row[c.key]:'';}))]); const base = safeFilename(`${metadata.organisation ? `${metadata.organisation}-` : ""}${title}-${metadata.as_of_date || metadata.end_date || new Date().toISOString().slice(0, 10)}`.toLowerCase());
  const meta = reportMetadata(metadata).map(([key,value])=>`${key}: ${value}`).join(" · ");
  if (format === "pdf") {
    if(!metadata.identity?.name && !metadata.organisation)throw new Error("Load the organisation profile before exporting a PDF.");
    const document=new jsPDF({orientation:columns.length>6?"landscape":"portrait"});const width=document.internal.pageSize.getWidth()-28;let y=16;
    const write=(text,size=9)=>{document.setFontSize(size);const lines=document.splitTextToSize(String(text),width);document.text(lines,14,y);y+=lines.length*size*.4+3;};
    const identity=metadata.identity;
    if(identity?.logo_data){document.addImage(identity.logo_data,"PNG",14,y,35,17,undefined,"FAST");y+=22;}
    write(identity?.name||metadata.organisation,15);
    if(identity){write(identity.address.join(" · "));for(const key of ["phone","email","website","registration_number","tax_number"])if(identity[key])write(`${key.replaceAll("_"," ")}: ${identity[key]}`);}
    write(title,14);if(meta)write(meta,8);
    for(const section of sections){
      autoTable(document,{head:[...(section.heading?[[{content:section.heading,colSpan:section.columns.length}]]:[]),section.columns.map(c=>c.label)],body:section.rows.map(row=>section.columns.map(c=>c.money?reportAmount(row[c.key]):row[c.key])),startY:y,margin:{top:14,bottom:18,left:14,right:14},styles:{fontSize:8,cellPadding:2,overflow:"linebreak"},columnStyles:Object.fromEntries(section.columns.map((c,i)=>[i,{halign:c.money?'right':'left',cellWidth:width*c.width/section.columns.reduce((sum,item)=>sum+item.width,0)}])),headStyles:{fillColor:[235,235,235],textColor:0},showHead:"everyPage",rowPageBreak:"avoid"});
      y=document.lastAutoTable.finalY+6;
    }
    const pages=document.getNumberOfPages();for(let page=1;page<=pages;page++){document.setPage(page);document.setFontSize(8);document.text(`Page ${page} of ${pages}`,14,document.internal.pageSize.getHeight()-8);}
    document.save(`${base}.pdf`);return;
  }
  const metadataRows = [[title], ["Organisation", metadata.identity?.name || metadata.organisation || ""], ...reportMetadata(metadata), []];
  const escaped = (value) => `"${safeText(value).replaceAll('"', '""')}"`;
  if (format === "csv") { saveBlob(new Blob([`\uFEFF${[...metadataRows, columns, ...body].map((row) => row.map(escaped).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }), `${base}.csv`); return; }
  if (format === "excel") { saveBlob(createXlsxWorkbook({ title, rows, metadata }), `${base}.xlsx`); return; }
  throw new Error(`Unsupported export format: ${format}`);
}
