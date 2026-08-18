import { useEffect, useRef, useState } from "react";
import { Banknote, Copy, Download, Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import { canDeleteBill, canDuplicateBill, canEditBill, canRecordBillPayment } from "../../utils/billActionRules";

export default function BillRowActions({ bill, onDelete, onDownload, onDuplicate }) {
  const auth = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const closeOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="invoice-row-actions" ref={menuRef}>
      <button
        type="button"
        className="invoice-row-menu"
        aria-label={`Actions for ${bill.billNumber}`}
        aria-expanded={isOpen}
        onClick={(event) => { event.stopPropagation(); setIsOpen((current) => !current); }}
      >
        <MoreHorizontal size={18} />
      </button>
      {isOpen && (
        <div className="invoice-row-dropdown" role="menu">
          <Link to={`/purchases/bills/${bill.id}`} role="menuitem" onClick={() => setIsOpen(false)}>
            <Eye size={16} />
            View bill
          </Link>
          {canEditBill(bill, auth.hasPermission) && <Link to={`/purchases/bills/${bill.id}/edit`} role="menuitem" onClick={() => setIsOpen(false)}>
            <Pencil size={16} />
            Edit bill
          </Link>}
          {canRecordBillPayment(bill, auth.hasPermission) && <Link to={`/purchases/bills/${bill.id}?recordPayment=true`} role="menuitem" onClick={() => setIsOpen(false)}>
            <Banknote size={16} />
            Record payment
          </Link>}
          <div className="invoice-row-dropdown-divider" />
          {canDuplicateBill(bill, auth.hasPermission) && <button type="button" role="menuitem" onClick={() => { onDuplicate(bill); setIsOpen(false); }}>
            <Copy size={16} />
            Duplicate bill
          </button>}
          <button type="button" role="menuitem" onClick={() => { onDownload(bill); setIsOpen(false); }}>
            <Download size={16} />
            Download PDF
          </button>
          {canDeleteBill(bill, auth.hasPermission) && <>
            <div className="invoice-row-dropdown-divider" />
            <button type="button" className="invoice-row-dropdown-danger" role="menuitem" onClick={() => { onDelete(bill); setIsOpen(false); }}>
              <Trash2 size={16} />
              Delete bill
            </button>
          </>}
        </div>
      )}
    </div>
  );
}
