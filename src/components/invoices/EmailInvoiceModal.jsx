import { useState } from "react";
import Modal from "../common/Modal";
import { createPaymentSubmission } from "../../utils/paymentSubmission.js";
import { normaliseApiError } from "../../services/apiError";
export default function EmailInvoiceModal({isOpen,invoice,organisation,onClose,onSend}) {
  // Keep form and key while the modal is closed: an uncertain attempt must not resend.
  const [recipient,setRecipient]=useState(invoice.customerEmail||"");const [subject,setSubject]=useState(`Invoice ${invoice.invoiceNumber} from ${organisation.name}`.slice(0,200));const [message,setMessage]=useState(`Please find invoice ${invoice.invoiceNumber} attached.\n\nKind regards,\n${organisation.name}`);
  const [submission]=useState(createPaymentSubmission);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [accepted,setAccepted]=useState(false);
  const close=()=>{if(!busy)onClose();};
  const submit=async(event)=>{event.preventDefault();if(accepted)return;const payload={recipient,subject,message};const key=submission.begin(payload);if(!key)return;setBusy(true);setError("");try{await onSend(payload,key);setAccepted(true);}catch(e){setError(e.data?.detail||normaliseApiError(e));}finally{submission.finish();setBusy(false);}};
  return <Modal isOpen={isOpen} title="Email invoice" onClose={close}><form onSubmit={submit}><p>The server attaches the invoice PDF using saved organisation and accounting data.</p>{accepted&&<p role="status">This submission was accepted for delivery.</p>}<label>Recipient<input type="email" required maxLength={254} disabled={busy||accepted} value={recipient} onChange={e=>setRecipient(e.target.value)}/></label><label>Subject<input required maxLength={200} disabled={busy||accepted} value={subject} onChange={e=>setSubject(e.target.value)}/></label><label>Message<textarea maxLength={2000} rows={6} disabled={busy||accepted} value={message} onChange={e=>setMessage(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={close}>Close</button><button disabled={busy||accepted}>{busy?"Submitting…":"Send invoice"}</button></form></Modal>;
}
