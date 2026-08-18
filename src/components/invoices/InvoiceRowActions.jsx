import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  Copy,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";

// Renders the invoice row actions component.
function InvoiceRowActions({
  invoice,
  onDuplicate,
  onDelete,
  onDownload,
}) {
  const auth = useAuth();
  const [isOpen, setIsOpen] =
    useState(false);

  const menuRef = useRef(null);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    // Handles click outside.
    const handleClickOutside = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    // Handles escape.
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, []);

  // Closes menu.
  const closeMenu = () => {
    setIsOpen(false);
  };

  return (
    <div
      className="invoice-row-actions"
      ref={menuRef}
    >
      <button
        type="button"
        className="invoice-row-menu"
        aria-label={`Actions for ${invoice.invoiceNumber}`}
        aria-expanded={isOpen}
        onClick={() =>
          setIsOpen(
            (currentValue) =>
              !currentValue
          )
        }
      >
        <MoreHorizontal size={18} />
      </button>

      {isOpen && (
        <div
          className="invoice-row-dropdown"
          role="menu"
        >
          <Link
            to={`/sales/invoices/${invoice.id}`}
            role="menuitem"
            onClick={closeMenu}
          >
            <Eye size={16} />
            View invoice
          </Link>

          {invoice.backendStatus === "draft" && auth.hasPermission("create_invoice") && <Link
            to={`/sales/invoices/${invoice.id}/edit`}
            role="menuitem"
            onClick={closeMenu}
          >
            <Pencil size={16} />
            Edit invoice
          </Link>}

          {invoice.totals.balanceDue > 0 && invoice.backendStatus !== "draft" && auth.hasPermission("create_customer_payment") && (
            <Link
              to={`/sales/invoices/${invoice.id}?recordPayment=true`}
              role="menuitem"
              onClick={closeMenu}
            >
              <Banknote size={16} />
              Record payment
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDuplicate(invoice.id);
              closeMenu();
            }}
          >
            <Copy size={16} />
            Duplicate invoice
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDownload(invoice);
              closeMenu();
            }}
          >
            <Download size={16} />
            Download PDF
          </button>

          <div className="invoice-row-dropdown-divider" />

          <button
            type="button"
            className="invoice-row-dropdown-danger"
            role="menuitem"
            onClick={() => {
              onDelete(invoice);
              closeMenu();
            }}
          >
            <Trash2 size={16} />
            Delete invoice
          </button>
        </div>
      )}
    </div>
  );
}

export default InvoiceRowActions;
