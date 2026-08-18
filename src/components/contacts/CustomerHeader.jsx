import {
    Archive,
    ArchiveRestore,
    ArrowLeft,
    FileText,
    Pencil,
    Plus,
    Trash2,
} from "lucide-react";
import {
    Link,
    useNavigate,
} from "react-router-dom";

// Renders the customer header component.
function CustomerHeader({
    customer,
    onToggleStatus,
    onDelete,
}) {
    const navigate = useNavigate();

    const isActive =
        customer.status === "Active";

    const customerInitial =
        String(customer.name || "C")
            .charAt(0)
            .toUpperCase();

    return (
        <section className="customer-header-card">
            <div className="customer-header-top">
                <button
                    type="button"
                    className="customer-back-button"
                    onClick={() =>
                        navigate(
                            "/contacts/customers"
                        )
                    }
                >
                    <ArrowLeft size={18} />
                    Customers
                </button>

                <div className="customer-header-actions">
                    <button
                        type="button"
                        className="customer-header-secondary-button"
                        onClick={onToggleStatus}
                    >
                        {isActive ? (
                            <>
                                <Archive size={17} />
                                Archive
                            </>
                        ) : (
                            <>
                                <ArchiveRestore
                                    size={17}
                                />
                                Restore
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        className="customer-header-delete-button"
                        onClick={onDelete}
                    >
                        <Trash2 size={17} />
                        Delete
                    </button>

                    <Link
                        to={`/contacts/customers/${customer.id}/statement`}
                        className="customer-header-secondary-button"
                    >
                        <FileText size={17} />
                        Statement
                    </Link>

                    <Link
                        to={`/contacts/customers/${customer.id}/edit`}
                        className="customer-header-secondary-button"
                    >
                        <Pencil size={17} />
                        Edit Customer
                    </Link>

                    <Link
                        to={`/sales/invoices/new?customerId=${customer.id}`}
                        className="page-primary-button"
                    >
                        <Plus size={18} />
                        New Invoice
                    </Link>
                </div>
            </div>

            <div className="customer-header-content">
                <div className="customer-avatar">
                    {customerInitial}
                </div>

                <div className="customer-header-details">
                    <div className="customer-name-row">
                        <h1>{customer.name}</h1>

                        <span
                            className={`customer-status ${isActive
                                    ? "active"
                                    : "inactive"
                                }`}
                        >
                            {customer.status}
                        </span>
                    </div>

                    <p>
                        {customer.contactName ||
                            "No contact person"}
                    </p>

                    <p>
                        {customer.email ||
                            "No email address"}
                    </p>

                    <small>
                        Customer No:{" "}
                        {customer.accountNumber ||
                            "Not assigned"}
                    </small>
                </div>
            </div>
        </section>
    );
}

export default CustomerHeader;