// Downloads only an authorised server-rendered document; browser values are not authoritative.
import { fetchDocumentPdf } from "./documentPdf.js";
import { saveBlob, safeFilename } from "./reportExport.js";
export const createCreditNotePdf = async (document) => {
  if (!document?.id) throw new Error("Load a saved document before downloading.");
  return fetchDocumentPdf("customer-credit",document.id);
};
export const downloadCreditNotePdf = async (document) => {
  const blob = await createCreditNotePdf(document);
  saveBlob(blob, safeFilename(document.invoiceNumber || document.billNumber || document.quoteNumber || document.creditNoteNumber || "customer-credit")+".pdf");
};
