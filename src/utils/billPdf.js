// Downloads only an authorised server-rendered document; browser values are not authoritative.
import { fetchDocumentPdf } from "./documentPdf.js";
import { saveBlob, safeFilename } from "./reportExport.js";
export const createBillPdf = async (document) => {
  if (!document?.id) throw new Error("Load a saved document before downloading.");
  return fetchDocumentPdf("bill",document.id);
};
export const downloadBillPdf = async (document) => {
  const blob = await createBillPdf(document);
  saveBlob(blob, safeFilename(document.invoiceNumber || document.billNumber || document.quoteNumber || document.creditNoteNumber || "bill")+".pdf");
};
