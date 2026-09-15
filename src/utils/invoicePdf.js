// Downloads only an authorised server-rendered document; browser values are not authoritative.
import { fetchDocumentPdf } from "./documentPdf.js";
import { saveBlob, safeFilename } from "./reportExport.js";
export const createInvoicePdf = async (document) => {
  if (!document?.id) throw new Error("Load a saved document before downloading.");
  return fetchDocumentPdf("invoice",document.id);
};
export const downloadInvoicePdf = async (document) => {
  const blob = await createInvoicePdf(document);
  saveBlob(blob, safeFilename(document.invoiceNumber || document.billNumber || document.quoteNumber || document.creditNoteNumber || "invoice")+".pdf");
};
