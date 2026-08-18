import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import TablePagination from "../../components/common/TablePagination";
import { useTablePagination } from "../../hooks/useTablePagination";
import { normaliseApiError } from "../../services/apiError";
import { commercialService } from "../../services/commercialService";
import "../../styles/chartOfAccounts.css";
import "../../styles/products.css";
import { CreditNoteDetail, CreditNotesList } from "../../components/commercial/CreditNotesWorkspace";

const definitions = {
  quotes: { title: "Quotes", list: "quotes", detail: "quote", base: "/sales/quotes" },
  "sales-orders": { title: "Sales orders", list: "salesOrders", detail: "salesOrder", base: "/sales/orders" },
  "purchase-orders": { title: "Purchase orders", list: "purchaseOrders", detail: "purchaseOrder", base: "/purchases/orders" },
  "customer-credits": { title: "Customer credit notes", list: "customerCredits", detail: "customerCredit", base: "/sales/credit-notes" },
  "supplier-credits": { title: "Supplier credits", list: "supplierCredits", detail: "supplierCredit", base: "/purchases/supplier-credits" },
};
const show = (value) => value == null || value === "" ? "—" : Array.isArray(value) ? `${value.length} lines` : typeof value === "object" ? value.name || value.code || value.id || "—" : String(value);
function Table({ rows, base, links=true }) {
  const pagination = useTablePagination(rows);
  if (!rows.length) return <div className="invoice-form-card">No documents found.</div>;
  const columns=Object.keys(rows[0]).filter((key) => !["id", "created_at", "updated_at", "notes"].includes(key)).slice(0, 8);
  return <><div className="chart-accounts-table-wrapper"><table className="chart-accounts-table"><thead><tr>{columns.map((key) => <th key={key}>{key.replaceAll("_", " ")}</th>)}{links && <th>Action</th>}</tr></thead><tbody>{pagination.pageRows.map((row, index) => <tr key={row.id || index}>{columns.map((key) => <td key={key}>{show(row[key])}</td>)}{links && <td><Link className="invoice-secondary-button" to={`${base}/${row.id}`}>View</Link></td>}</tr>)}</tbody></table></div><TablePagination {...pagination}/></>;
}
function GenericCommercialListPage({ type }) {
  const definition=definitions[type]; const [rows,setRows]=useState([]); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{try{setRows(await commercialService[definition.list]());setError("");}catch(requestError){setError(normaliseApiError(requestError));}finally{setLoading(false);}},[definition]);
  useEffect(()=>{const frame=window.requestAnimationFrame(()=>void load());return()=>window.cancelAnimationFrame(frame);},[load]);
  return <div className="products-page"><PageHeader eyebrow="Commercial workflows" title={definition.title} description="Organisation-scoped documents from the Ledgify backend." action={type.includes("credits") ? <Link className="invoice-primary-button" to={`${definition.base}/new`}>New credit</Link> : null} />{error&&<div className="invoice-form-alert">{error}</div>}{loading?<div className="invoice-form-card">Loading…</div>:<section className="invoice-form-card"><Table rows={rows} base={definition.base}/></section>}</div>;
}
function GenericCommercialDetailPage({ type }) {
  const params=useParams(); const id=params.quoteId||params.salesOrderId||params.purchaseOrderId||params.creditNoteId; const definition=definitions[type]; const [document,setDocument]=useState(null); const [error,setError]=useState("");
  useEffect(()=>{let active=true;commercialService[definition.detail](id).then((data)=>active&&setDocument(data)).catch((requestError)=>active&&setError(normaliseApiError(requestError)));return()=>{active=false;};},[definition,id]);
  return <div className="products-page"><PageHeader eyebrow="Commercial workflows" title={document?.quote_number||document?.order_number||document?.purchase_order_number||definition.title} description="Live backend document and lifecycle status." action={<Link className="invoice-secondary-button" to={definition.base}>Back</Link>}/>{error&&<div className="invoice-form-alert">{error}</div>}{document&&<><section className="invoice-form-card"><Table rows={[document]} base={definition.base} links={false}/></section><section className="invoice-form-card"><h2>Lines</h2><Table rows={document.lines||[]} base={definition.base} links={false}/></section></>}</div>;
}

export function LiveCommercialListPage({ type }) {
  if (type === "customer-credits" || type === "supplier-credits") {
    return <CreditNotesList supplier={type === "supplier-credits"} />;
  }
  return <GenericCommercialListPage type={type} />;
}

export function LiveCommercialDetailPage({ type }) {
  if (type === "customer-credits" || type === "supplier-credits") {
    return <CreditNoteDetail supplier={type === "supplier-credits"} />;
  }
  return <GenericCommercialDetailPage type={type} />;
}
