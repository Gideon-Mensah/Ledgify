import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { loadAuthStorage } from "../../services/authStorage";
import { api } from "../../services/api";
import { useAuth } from "../../store/AuthContext";
import { normaliseApiError } from "../../services/apiError";
import { saveBlob, safeFilename } from "../../utils/reportExport";
import DocumentView from "./DocumentView";
function SavedDocumentContent({kind:providedKind,id:providedId}) {
 const [search]=useSearchParams();const query=search.toString();
 const params=useParams();const kind=providedKind||params.kind;const id=providedId||params.documentId;const auth=useAuth();
 const [doc,setDoc]=useState(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;api.get(`documents/${kind}/${id}/?${query}`).then(data=>{if(live)setDoc(data);}).catch(e=>{if(live)setError(normaliseApiError(e));});return()=>{live=false;};},[kind,id,query]);
 const print=async()=>{setBusy(true);setError("");const organisationId=auth.selectedOrganisation.id;try{const fresh=await api.get(`documents/${kind}/${id}/?${query}`);setDoc(fresh);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await document.fonts.ready;await Promise.all([...document.querySelectorAll(".trusted-document img")].map(img=>img.decode()));if(loadAuthStorage().selectedOrganisation?.id!==organisationId)throw new Error("Organisation changed. Reopen the document before printing.");window.print();}catch(e){setError(normaliseApiError(e));}finally{setBusy(false);}};
 const download=async()=>{setBusy(true);try{saveBlob(await api.download(`documents/${kind}/${id}/pdf/?${query}&version=${doc.version}`),safeFilename(doc.number)+".pdf");}catch(e){setError(normaliseApiError(e));}finally{setBusy(false);}};
 return <section className="source-document-page">{error&&<p role="alert">{error}</p>}{doc?<><div className="document-actions"><button disabled={busy} onClick={print}>Print</button>{auth.hasPermission("export_reports")&&<button disabled={busy} onClick={download}>Download PDF</button>}</div><DocumentView document={doc}/></>:!error&&<p role="status">Loading document…</p>}</section>;
}

export default function SavedDocument(props) {const params=useParams();const [search]=useSearchParams();return <SavedDocumentContent key={`${props.kind||params.kind}:${props.id||params.documentId}:${search}`} {...props}/>;}
