// Downloads only an authorised server-rendered document; browser values are not authoritative.
import { fetchDocumentPdf } from "./documentPdf.js";
import { saveBlob, safeFilename } from "./reportExport.js";
export const createQuotePdf = async (document) => {
  if (!document?.id) throw new Error("Load a saved document before downloading.");
  return fetchDocumentPdf("quote",document.id);
};
export const downloadQuotePdf = async (document) => {
  const blob = await createQuotePdf(document);
  saveBlob(blob, safeFilename(document.invoiceNumber || document.billNumber || document.quoteNumber || document.creditNoteNumber || "quote")+".pdf");
};
