import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import { loadAuthStorage } from "../../services/authStorage";
import { api } from "../../services/api";
import { salesApiService } from "../../services/salesApiService";
import { purchasesApiService } from "../../services/purchasesApiService";
import { normaliseApiError } from "../../services/apiError";
import { safeFilename, saveBlob } from "../../utils/reportExport";
import { getOrganisationToday } from "../../utils/dateUtils";
import { documentActions } from "../../utils/documentActions";
import DocumentView from "./DocumentView";
import RecordPaymentModal from "../invoices/RecordPaymentModal";
import RecordBillPaymentModal from "../bills/RecordBillPaymentModal";
import EmailInvoiceModal from "../invoices/EmailInvoiceModal";
import Modal from "../common/Modal";

export default function SourceDocumentPage({ kind }) {
  const auth=useAuth(); const params=useParams(); const sales=kind==="invoice"; const id=params.invoiceId || params.billId;
  const service=sales?salesApiService:purchasesApiService; const collection=sales?"invoices":"bills";const base=sales?"sales":"purchases";
  const [data,setData]=useState(null);const [contract,setContract]=useState(null);const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const guard=useRef(false);
  const [paymentOpen,setPaymentOpen]=useState(false);const [emailOpen,setEmailOpen]=useState(false);const [correction,setCorrection]=useState(null);
  const [reason,setReason]=useState("");const [date,setDate]=useState(()=>getOrganisationToday(auth.selectedOrganisation?.timezone));
  const load=useCallback(async()=>{setLoading(true);try {const [record,doc]=await Promise.all([service.get(id),api.get(`documents/${kind}/${id}/`)]);setData(record);setContract(doc);}catch(e){setData(null);setContract(null);throw e;}finally{setLoading(false);}},[service,id,kind]);
  useEffect(()=>{let active=true;Promise.all([service.get(id),api.get(`documents/${kind}/${id}/`)]).then(([record,doc])=>{if(active){setData(record);setContract(doc);setLoading(false);}}).catch(e=>{if(active){setError(normaliseApiError(e));setLoading(false);}});return()=>{active=false;};},[service,id,kind]);
  const run=async(task)=>{if(guard.current)return;guard.current=true;setBusy(true);setError("");try{await task();}catch(e){setError(normaliseApiError(e));}finally{guard.current=false;setBusy(false);}};
  const download=()=>run(async()=>{const blob=await api.download(`documents/${kind}/${id}/pdf/?version=${contract.version}`);if(blob.type!=="application/pdf")throw new Error("The PDF could not be prepared.");saveBlob(blob,safeFilename(contract.number)+".pdf");});
  const print=()=>run(async()=>{const organisationId=auth.selectedOrganisation.id;await load();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await document.fonts.ready;await Promise.all([...document.querySelectorAll('.trusted-document img')].map(img=>img.decode()));if(loadAuthStorage().selectedOrganisation?.id!==organisationId)throw new Error("Organisation changed. Reopen the document before printing.");window.print();});
  const reverse=()=>run(async()=>{if(!reason.trim())throw new Error("Enter a reversal reason.");await api.post(correction?`${sales?"customer":"supplier"}-payments/${correction.id}/reverse/`:`${collection}/${id}/reverse/`,{reason,reversal_date:date});await load();setCorrection(null);setMessage("Reversal posted. Document and payment records reloaded from the ledger.");});
  const recordPayment=async(values)=>{await service.recordPayment(data,values);await load();setPaymentOpen(false);setMessage("Payment recorded.");};
  if(loading&&!contract)return <p role="status">Loading document…</p>;
  if(!data||!contract)return <section role="alert"><h1>Document unavailable</h1><p>{error}</p><Link to={`/${base}/${collection}`}>Back to documents</Link></section>;
  const actions=documentActions(kind,data,auth.hasPermission);
  return <div className="source-document-page">
    <div className="document-actions"><Link to={`/${base}/${collection}`}>Back to {collection}</Link>
      <button disabled={busy||loading} onClick={print}>Print</button>{actions.pdf.visible&&<button disabled={busy||loading} onClick={download}>Download PDF</button>}
      {sales&&actions.email.visible&&<button disabled={busy||!actions.email.enabled} title={actions.email.reason} onClick={()=>setEmailOpen(true)}>Email</button>}
      {actions.edit.visible&&actions.edit.enabled&&<Link to={`/${base}/${collection}/${id}/edit`}>Edit</Link>}
      {actions.approve.visible&&actions.approve.enabled&&<button disabled={busy} onClick={()=>run(async()=>{await service.approve(id);await load();setMessage("Document approved.");})}>Approve</button>}
      {actions.pay.visible&&actions.pay.enabled&&<button disabled={busy} onClick={()=>setPaymentOpen(true)}>Record payment</button>}
      {actions.reverse.visible&&<button disabled={busy||!actions.reverse.enabled} title={actions.reverse.reason} onClick={()=>{setReason("");setCorrection(false);}}>Reverse document</button>}
    </div>
    {error&&<p className="document-notice" role="alert">{error}</p>}{message&&<p className="document-notice" role="status">{message}</p>}
    <DocumentView document={contract}/>
    <section className="document-payment-history"><h2>Payments</h2>{!data.payments?.length&&<p>No payments recorded.</p>}{data.payments?.map(payment=><article key={payment.id}><span>{payment.paymentDate} · {payment.amount} {data.currency} · {payment.status}</span>{payment.accountingJournal&&<Link to={`/accounting/journals/${payment.accountingJournal}`}>View journal</Link>}{auth.hasPermission("reverse_journal")&&payment.status!=="reversed"&&<button disabled={busy} onClick={()=>{setReason("");setCorrection(payment);}}>Reverse payment</button>}<Link to={`/documents/${sales?"customer-payment":"supplier-payment"}/${payment.id}`}>Payment confirmation</Link></article>)}</section>
    {sales?<RecordPaymentModal isOpen={paymentOpen} invoiceId={data.id} invoiceNumber={data.invoiceNumber} balanceDue={data.amountDue} invoiceCurrency={data.currency} onClose={()=>setPaymentOpen(false)} onSave={recordPayment}/>:<RecordBillPaymentModal isOpen={paymentOpen} bill={data} outstanding={data.amountDue} onClose={()=>setPaymentOpen(false)} onRecord={recordPayment}/>}
    {sales&&<EmailInvoiceModal isOpen={emailOpen} invoice={data} organisation={contract.organisation} onClose={()=>setEmailOpen(false)} onSend={async(payload,key)=>{const result=await api.post(`invoices/${id}/email/`,{...payload,document_version:contract.version},{headers:{"Idempotency-Key":key}});if(result.status!=="sent")throw new Error(result.detail);setMessage(result.detail);setEmailOpen(false);return result;}}/>}
    <Modal isOpen={correction!==null} title={correction?"Reverse payment?":"Reverse document?"} onClose={()=>{if(!busy)setCorrection(null);}}><p>This posts an equal and opposite journal. The original audit history remains. The backend checks settlements, permissions and the selected period.</p><label>Reversal date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label>Reason<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={()=>setCorrection(null)}>Cancel</button><button disabled={busy||!date||!reason.trim()} onClick={reverse}>{busy?"Posting…":"Confirm reversal"}</button></Modal>
  </div>;
}
