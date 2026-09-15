import { useParams } from "react-router-dom";
import SourceDocumentPage from "../../components/documents/SourceDocumentPage";
export default function InvoiceDetailsPage() { const { invoiceId }=useParams(); return <SourceDocumentPage key={invoiceId} kind="invoice"/>; }
