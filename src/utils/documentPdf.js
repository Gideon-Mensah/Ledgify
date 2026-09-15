import { api } from "../services/api.js";
export async function fetchDocumentPdf(kind, id) {
 if(!id)throw new Error("Load a saved document before downloading.");
 const blob=await api.download(`documents/${kind}/${id}/pdf/`);
 if(blob.type!=="application/pdf"||blob.size<100)throw new Error("The server did not return a valid PDF.");
 return blob;
}
