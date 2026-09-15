import { useParams } from "react-router-dom";
import SourceDocumentPage from "../../components/documents/SourceDocumentPage";
export default function BillDetailsPage() { const { billId }=useParams(); return <SourceDocumentPage key={billId} kind="bill"/>; }
