// Show the backend-authoritative bill balance, payments, sources, and journal links.

import {
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    ArrowLeft,
    Ban,
    Building2,
    CheckCircle2,
    CircleDollarSign,
    Copy,
    Download,
    FileText,
    PackageCheck,
    Pencil,
    Printer,
} from "lucide-react";
import {
    Link,
    useNavigate,
    useParams,
    useSearchParams,
} from "react-router-dom";

import RecordBillPaymentModal from "../../components/bills/RecordBillPaymentModal";

import { purchasesApiService } from "../../services/purchasesApiService";
import { normaliseApiError } from "../../services/apiError";
import { useAuth } from "../../store/AuthContext";
import { canDuplicateBill, canEditBill, canRecordBillPayment } from "../../utils/billActionRules";

import {
    downloadBillPdf,
} from "../../utils/billPdf";

// Backend money fields are fixed-point decimal strings. This avoids floating-point
// arithmetic when deciding whether a payable balance is still positive.
const hasPositiveMoney = (value) => /^\+?0*[1-9]\d*(?:\.\d+)?$/.test(String(value ?? "").trim()) ||
    /^\+?0*\.\d*[1-9]\d*$/.test(String(value ?? "").trim());

const overdueLabel = (dueDate, amountDue) => {
    if (!dueDate || !hasPositiveMoney(amountDue)) return "";
    const due = new Date(`${dueDate}T23:59:59`);
    if (Number.isNaN(due.getTime()) || due >= new Date()) return "";
    const days = Math.max(1, Math.ceil((Date.now() - due.getTime()) / 86400000));
    return `${days} day${days === 1 ? "" : "s"} overdue`;
};

// Normalizes text.
const normaliseText = (value) => {
    return String(value ?? "")
        .trim()
        .toLowerCase();
};

// Gets supplier address lines.
const getSupplierAddressLines = (
    address
) => {
    if (Array.isArray(address)) {
        return address
            .map((line) =>
                String(line || "").trim()
            )
            .filter(Boolean);
    }

    if (
        !address ||
        typeof address !== "object"
    ) {
        return [];
    }

    return [
        address.line1,
        address.line2,
        address.city,
        address.county,
        address.postcode,
        address.country,
    ]
        .map((line) =>
            String(line || "").trim()
        )
        .filter(Boolean);
};

// Finds bill supplier.
const findBillSupplier = (
    bill,
    suppliers
) => {
    if (!bill) {
        return null;
    }

    const supplierById =
        suppliers.find(
            (supplier) =>
                bill.supplierId !==
                undefined &&
                bill.supplierId !== null &&
                bill.supplierId !== "" &&
                Number(supplier.id) ===
                Number(bill.supplierId)
        );

    if (supplierById) {
        return supplierById;
    }

    const supplierName =
        bill.supplier ||
        bill.supplierName ||
        "";

    return (
        suppliers.find(
            (supplier) =>
                normaliseText(
                    supplier.name
                ) ===
                normaliseText(
                    supplierName
                )
        ) || null
    );
};

// Formats currency.
const formatCurrency = (
    amount,
    currency = "GBP"
) => {
    try {
        return new Intl.NumberFormat(
            "en-GB",
            {
                style: "currency",
                currency:
                    currency || "GBP",
            }
        ).format(Number(amount) || 0);
    } catch {
        return new Intl.NumberFormat(
            "en-GB",
            {
                style: "currency",
                currency: "GBP",
            }
        ).format(Number(amount) || 0);
    }
};

// Gets status class name.
const getStatusClassName = (
    status
) => {
    return String(status || "Draft")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
};

// Formats payment date.
const formatPaymentDate = (
    dateValue
) => {
    if (!dateValue) {
        return "—";
    }

    if (
        /^\d{4}-\d{2}-\d{2}$/.test(
            String(dateValue)
        )
    ) {
        return new Intl.DateTimeFormat(
            "en-GB",
            {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }
        ).format(
            new Date(
                `${dateValue}T00:00:00`
            )
        );
    }

    const parsedDate =
        new Date(dateValue);

    if (
        Number.isNaN(
            parsedDate.getTime()
        )
    ) {
        return String(dateValue);
    }

    return new Intl.DateTimeFormat(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }
    ).format(parsedDate);
};

// Formats date time.
const formatDateTime = (
    dateValue
) => {
    if (!dateValue) {
        return "—";
    }

    const parsedDate =
        new Date(dateValue);

    if (
        Number.isNaN(
            parsedDate.getTime()
        )
    ) {
        return String(dateValue);
    }

    return new Intl.DateTimeFormat(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }
    ).format(parsedDate);
};

// Renders the bill details page component.
function BillDetailsPage() {
    const auth = useAuth();
    const { billId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();

    const navigate = useNavigate();

    const suppliers = useMemo(() => [], []);

    const [bill, setBill] =
        useState(null);
    const [loadError, setLoadError] = useState("");

    const [
        isPaymentModalOpen,
        setIsPaymentModalOpen,
    ] = useState(false);

    const [
        isDuplicating,
        setIsDuplicating,
    ] = useState(false);

    // Keeps this part of the page in sync when its inputs change.
    useEffect(() => {
        // Loads bill.
        const loadBill = async () => {
            try {
                setBill(await purchasesApiService.get(billId));
                setLoadError("");
            } catch (error) {
                setLoadError(normaliseApiError(error));
                setBill(null);
            }
        };

        const initialLoad = window.requestAnimationFrame(() => {
            loadBill();
            setIsPaymentModalOpen(false);
        });

        window.addEventListener(
            "focus",
            loadBill
        );

        return () => {
            window.cancelAnimationFrame(initialLoad);
            window.removeEventListener(
                "focus",
                loadBill
            );
        };
    }, [billId]);

    useEffect(() => {
        if (bill && searchParams.get("recordPayment") === "true" && canRecordBillPayment(bill, auth.hasPermission)) {
            const frame = window.requestAnimationFrame(() => {
                setIsPaymentModalOpen(true);
                setSearchParams({}, { replace: true });
            });
            return () => window.cancelAnimationFrame(frame);
        }
        return undefined;
    }, [auth.hasPermission, bill, searchParams, setSearchParams]);

    const selectedSupplier =
        // Recalculates this value only when its inputs change.
        useMemo(() => {
            return findBillSupplier(
                bill,
                suppliers
            );
        }, [bill, suppliers]);

    const supplierId =
        selectedSupplier?.id ??
        bill?.supplierId ??
        null;

    const supplierUrl =
        supplierId !== null &&
            supplierId !== undefined &&
            supplierId !== ""
            ? `/purchases/suppliers/${supplierId}`
            : null;

    const supplierName =
        bill?.supplier ||
        bill?.supplierName ||
        selectedSupplier?.name ||
        "Supplier";

    const supplierEmail =
        bill?.supplierEmail ||
        selectedSupplier?.email ||
        "";

    const supplierAddressLines =
        // Recalculates this value only when its inputs change.
        useMemo(() => {
            const savedAddress =
                getSupplierAddressLines(
                    bill?.supplierAddress
                );

            if (savedAddress.length > 0) {
                return savedAddress;
            }

            return getSupplierAddressLines(
                selectedSupplier?.address
            );
        }, [
            bill?.supplierAddress,
            selectedSupplier,
        ]);

    const isFromPurchaseOrder =
        bill?.purchaseOrderId !==
        undefined &&
        bill?.purchaseOrderId !== null &&
        bill?.purchaseOrderId !== "";

    const purchaseOrderUrl =
        isFromPurchaseOrder
            ? `/purchases/orders/${bill.purchaseOrderId}`
            : null;

    if (!bill) {
        return (
            <div className="invoice-details-page">
                <div className="invoice-back-row">
                    <Link
                        to="/purchases/bills"
                        className="invoice-back-link"
                    >
                        <ArrowLeft size={17} />
                        Back to bills
                    </Link>
                </div>

                <section className="invoice-form-card">
                    <h1>Bill not found</h1>

                    <p>{loadError || "The requested supplier bill does not exist or may have been deleted."}</p>
                </section>
            </div>
        );
    }

    // Handles approve.
    const handleApprove = async () => {
        try {
            const updated =
                await purchasesApiService.approve(bill.id);

            setBill(updated);
        } catch (error) {
            window.alert(
                error.message ||
                "The bill could not be approved."
            );
        }
    };

    // Handles duplicate.
    const handleDuplicate = async () => {
        const confirmed =
            window.confirm(
                `Create a new draft copy of ${bill.billNumber}?`
            );

        if (!confirmed) {
            return;
        }

        setIsDuplicating(true);

        try {
            const duplicatedBill =
                await purchasesApiService.duplicate(bill.id);

            navigate(
                `/purchases/bills/${duplicatedBill.id}/edit`
            );
        } catch (error) {
            window.alert(
                error.message ||
                "The bill could not be duplicated."
            );

            setIsDuplicating(false);
        }
    };

    // Handles void.
    const handleVoid = () => {
        window.alert("Bill voiding is not available through the current backend API.");
    };

    // Handles record payment.
    const handleRecordPayment =
        async (paymentData) => {
            try {
                const updated =
                    await purchasesApiService.recordPayment(bill, paymentData);

                setBill(updated);

                setIsPaymentModalOpen(
                    false
                );
            } catch (error) {
                throw new Error(
                    normaliseApiError(error),
                    { cause: error }
                );
            }
        };

    const canRecordPayment =
        canRecordBillPayment(bill, auth.hasPermission);
    const overdue = overdueLabel(bill.dueDateIso, bill.amountDue);

    const canVoid = false;

    return (
        <div className="invoice-details-page">
            <div className="invoice-back-row">
                <Link
                    to="/purchases/bills"
                    className="invoice-back-link"
                >
                    <ArrowLeft size={17} />
                    Back to bills
                </Link>
            </div>

            <div className="invoice-details-header">
                <div>
                    <div className="invoice-details-title-row">
                        <h1>{bill.billNumber}</h1>

                        <span
                            className={`invoice-status bill-status-${getStatusClassName(
                                bill.status
                            )}`}
                        >
                            {bill.status}
                        </span>
                    </div>

                    <p>
                        Bill from{" "}
                        {supplierUrl ? (
                            <Link
                                to={supplierUrl}
                                className="invoice-number-link"
                            >
                                {supplierName}
                            </Link>
                        ) : (
                            <strong>
                                {supplierName}
                            </strong>
                        )}
                        , issued on{" "}
                        {bill.issueDate || "—"}
                    </p>

                    {isFromPurchaseOrder && (
                        <div className="bill-source-row">
                            <span className="bill-source-badge">
                                <FileText size={14} />
                                Created from purchase
                                order
                            </span>

                            <Link
                                to={purchaseOrderUrl}
                                className="bill-source-link"
                            >
                                {bill.purchaseOrderNumber ||
                                    `Purchase order #${bill.purchaseOrderId}`}
                            </Link>
                        </div>
                    )}
                </div>

                <div className="invoice-details-actions">
                    {supplierUrl && (
                        <Link
                            to={supplierUrl}
                            className="invoice-secondary-button"
                        >
                            <Building2 size={17} />
                            View supplier
                        </Link>
                    )}

                    {isFromPurchaseOrder && (
                        <Link
                            to={purchaseOrderUrl}
                            className="invoice-secondary-button"
                        >
                            <PackageCheck size={17} />
                            View purchase order
                        </Link>
                    )}

                    {canDuplicateBill(bill, auth.hasPermission) && <button
                        type="button"
                        className="invoice-secondary-button"
                        onClick={() =>
                            window.print()
                        }
                    >
                        <Printer size={17} />
                        Print
                    </button>}

                    <button
                        type="button"
                        className="invoice-secondary-button"
                        onClick={handleDuplicate}
                        disabled={isDuplicating}
                    >
                        <Copy size={17} />

                        {isDuplicating
                            ? "Duplicating..."
                            : "Duplicate"}
                    </button>

                    {canEditBill(bill, auth.hasPermission) && (
                        <Link
                            to={`/purchases/bills/${bill.id}/edit`}
                            className="invoice-secondary-button"
                        >
                            <Pencil size={17} />
                            Edit
                        </Link>
                    )}

                    {bill.accountingJournal && (
                        <Link
                            to={`/accounting/journals/${bill.accountingJournal}`}
                            className="invoice-secondary-button"
                        >
                            <FileText size={17} />
                            View journal
                        </Link>
                    )}

                    {[
                        "Draft",
                        "Awaiting approval",
                    ].includes(bill.status) && auth.hasPermission("approve_bill") && (
                            <button
                                type="button"
                                className="page-primary-button"
                                onClick={handleApprove}
                            >
                                <CheckCircle2
                                    size={17}
                                />
                                Approve
                            </button>
                        )}

                    {canRecordPayment && (
                        <button
                            type="button"
                            className="page-primary-button"
                            onClick={() =>
                                setIsPaymentModalOpen(
                                    true
                                )
                            }
                        >
                            <CircleDollarSign
                                size={17}
                            />
                            Record payment
                        </button>
                    )}

                    {canVoid && (
                        <button
                            type="button"
                            className="invoice-danger-button"
                            onClick={handleVoid}
                        >
                            <Ban size={17} />
                            Void
                        </button>
                    )}
                </div>
            </div>

            <section className="bill-detail-summary" aria-label="Bill financial summary">
                <div><span>Total</span><strong>{formatCurrency(bill.total, bill.currency)}</strong></div>
                <div><span>Amount paid</span><strong>{formatCurrency(bill.amountPaid, bill.currency)}</strong></div>
                <div><span>Credits</span><strong>{formatCurrency(bill.amountCredited, bill.currency)}</strong></div>
                <div className="bill-detail-due"><span>Amount due</span><strong>{formatCurrency(bill.amountDue, bill.currency)}</strong></div>
                <div><span>Due date</span><strong>{bill.dueDate || "—"}</strong>{overdue && <small className="bill-overdue-label">{overdue}</small>}</div>
            </section>

            <div className="invoice-details-layout">
                <main className="invoice-document">
                    <div className="invoice-document-top">
                        <div className="invoice-company-brand">
                            <div className="invoice-company-logo">
                                AC
                            </div>

                            <div>
                                <h2>
                                    Accounting Cloud Ltd
                                </h2>

                                <p>
                                    12 Business Park
                                </p>

                                <p>
                                    Sheffield, S1 2AB
                                </p>

                                <p>
                                    United Kingdom
                                </p>
                            </div>
                        </div>

                        <div className="invoice-document-title">
                            <span>
                                Supplier bill
                            </span>

                            <strong>
                                {bill.billNumber}
                            </strong>
                        </div>
                    </div>

                    <div className="invoice-address-grid">
                        <div>
                            <span className="invoice-document-label">
                                Supplier
                            </span>

                            {supplierUrl ? (
                                <Link
                                    to={supplierUrl}
                                    className="invoice-number-link"
                                >
                                    <strong>
                                        {supplierName}
                                    </strong>
                                </Link>
                            ) : (
                                <strong>
                                    {supplierName}
                                </strong>
                            )}

                            {supplierAddressLines
                                .length > 0 ? (
                                supplierAddressLines.map(
                                    (line, index) => (
                                        <p
                                            key={`${line}-${index}`}
                                        >
                                            {line}
                                        </p>
                                    )
                                )
                            ) : (
                                <p>
                                    No supplier address
                                    available.
                                </p>
                            )}

                            {supplierEmail && (
                                <p>{supplierEmail}</p>
                            )}
                        </div>

                        <div className="invoice-document-meta">
                            <div>
                                <span>
                                    Supplier reference
                                </span>

                                <strong>
                                    {bill.supplierReference ||
                                        "—"}
                                </strong>
                            </div>

                            {isFromPurchaseOrder && (
                                <div>
                                    <span>
                                        Purchase order
                                    </span>

                                    <Link
                                        to={purchaseOrderUrl}
                                        className="bill-purchase-order-reference"
                                    >
                                        {bill.purchaseOrderNumber ||
                                            `PO #${bill.purchaseOrderId}`}
                                    </Link>
                                </div>
                            )}

                            <div>
                                <span>Issue date</span>

                                <strong>
                                    {bill.issueDate ||
                                        "—"}
                                </strong>
                            </div>

                            <div>
                                <span>Due date</span>

                                <strong>
                                    {bill.dueDate || "—"}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Payment terms
                                </span>

                                <strong>
                                    {bill.paymentTerms ||
                                        "—"}
                                </strong>
                            </div>
                        </div>
                    </div>

                    <div className="invoice-document-table-wrapper">
                        <table className="invoice-document-table bill-document-table">
                            <thead>
                                <tr>
                                    <th>Description</th>
                                    <th>Account</th>
                                    <th>Quantity</th>
                                    <th>Unit price</th>
                                    <th>Discount</th>
                                    <th>Tax</th>
                                    <th>Total</th>
                                </tr>
                            </thead>

                            <tbody>
                                {(bill.items || []).map(
                                    (item, index) => {
                                        return (
                                            <tr
                                                key={
                                                    item.id ||
                                                    `${bill.id}-${index}`
                                                }
                                            >
                                                <td>
                                                    <strong>
                                                        {item.description ||
                                                            "Untitled item"}
                                                    </strong>
                                                </td>

                                                <td>
                                                    {item.accountCode
                                                        ? `${item.accountCode}${item.accountName ? ` · ${item.accountName}` : ""}`
                                                        : "—"}
                                                </td>

                                                <td>
                                                    {Number(
                                                        item.quantity
                                                    ) || 0}
                                                </td>

                                                <td>
                                                    {formatCurrency(
                                                        item.unitPrice,
                                                        bill.currency
                                                    )}
                                                </td>

                                                <td>
                                                    {formatCurrency(item.discountAmount, bill.currency)}
                                                </td>

                                                <td>
                                                    {Number(
                                                        item.vatRate
                                                    ) || 0}
                                                    %
                                                </td>

                                                <td>
                                                    <strong>
                                                        {formatCurrency(
                                                            item.lineTotal,
                                                            bill.currency
                                                        )}
                                                    </strong>
                                                </td>
                                            </tr>
                                        );
                                    }
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="invoice-document-summary">
                        <div className="invoice-document-notes">
                            <span className="invoice-document-label">
                                Notes
                            </span>

                            <p>
                                {bill.notes ||
                                    "No notes were added."}
                            </p>
                        </div>

                        <div className="invoice-document-totals">
                            <div>
                                <span>Subtotal</span>

                                <strong>
                                    {formatCurrency(
                                        bill.subtotal,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Tax</span>

                                <strong>
                                    {formatCurrency(
                                        bill.taxTotal,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div className="invoice-document-grand-total">
                                <span>Total</span>

                                <strong>
                                    {formatCurrency(
                                        bill.total,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Paid</span>

                                <strong>
                                    {formatCurrency(
                                        bill.amountPaid,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Outstanding
                                </span>

                                <strong>
                                    {formatCurrency(
                                        bill.amountDue,
                                        bill.currency
                                    )}
                                </strong>
                            </div>
                        </div>
                    </div>
                </main>

                <aside className="invoice-details-sidebar">
                    <section className="invoice-details-card">
                        <div className="invoice-details-card-header">
                            <h2>Supplier</h2>
                        </div>

                        <div className="invoice-details-list">
                            <div>
                                <span>Name</span>

                                {supplierUrl ? (
                                    <Link
                                        to={supplierUrl}
                                        className="invoice-number-link"
                                    >
                                        {supplierName}
                                    </Link>
                                ) : (
                                    <strong>
                                        {supplierName}
                                    </strong>
                                )}
                            </div>

                            <div>
                                <span>Email</span>

                                {supplierEmail ? (
                                    <a
                                        href={`mailto:${supplierEmail}`}
                                    >
                                        {supplierEmail}
                                    </a>
                                ) : (
                                    <strong>—</strong>
                                )}
                            </div>

                            <div>
                                <span>
                                    Account number
                                </span>

                                <strong>
                                    {selectedSupplier
                                        ?.accountNumber ||
                                        "—"}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Payment terms
                                </span>

                                <strong>
                                    {bill.paymentTerms ||
                                        selectedSupplier
                                            ?.paymentTerms ||
                                        "—"}
                                </strong>
                            </div>
                        </div>

                        {supplierUrl && (
                            <Link
                                to={supplierUrl}
                                className="invoice-secondary-button invoice-full-width-button"
                            >
                                <Building2 size={17} />
                                View supplier
                            </Link>
                        )}
                    </section>

                    {isFromPurchaseOrder && (
                        <section className="invoice-details-card">
                            <div className="invoice-details-card-header">
                                <h2>
                                    Purchase order
                                </h2>
                            </div>

                            <div className="invoice-payment-summary">
                                <div>
                                    <span>
                                        Order number
                                    </span>

                                    <strong>
                                        {bill.purchaseOrderNumber ||
                                            `PO #${bill.purchaseOrderId}`}
                                    </strong>
                                </div>

                                <div>
                                    <span>Source</span>

                                    <strong>
                                        Created from purchase
                                        order
                                    </strong>
                                </div>

                                <div>
                                    <span>
                                        Bill created
                                    </span>

                                    <strong>
                                        {formatDateTime(
                                            bill.createdAt
                                        )}
                                    </strong>
                                </div>
                            </div>

                            <Link
                                to={purchaseOrderUrl}
                                className="invoice-secondary-button invoice-full-width-button"
                            >
                                <PackageCheck size={17} />
                                View purchase order
                            </Link>
                        </section>
                    )}

                    <section className="invoice-details-card">
                        <div className="invoice-details-card-header">
                            <h2>Bill summary</h2>
                        </div>

                        <div className="invoice-payment-summary">
                            <div>
                                <span>Status</span>

                                <strong>
                                    {bill.status}
                                </strong>
                            </div>

                            <div>
                                <span>Total</span>

                                <strong>
                                    {formatCurrency(
                                        bill.total,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Paid</span>

                                <strong>
                                    {formatCurrency(
                                        bill.amountPaid,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Outstanding
                                </span>

                                <strong>
                                    {formatCurrency(
                                        bill.amountDue,
                                        bill.currency
                                    )}
                                </strong>
                            </div>

                            <div>
                                <span>Category</span>

                                <strong>
                                    {bill.category || "—"}
                                </strong>
                            </div>

                            <div>
                                <span>Currency</span>

                                <strong>
                                    {bill.currency || "GBP"}
                                </strong>
                            </div>
                        </div>

                        <button
                            type="button"
                            className="invoice-secondary-button invoice-full-width-button"
                            onClick={() =>
                                downloadBillPdf(bill)
                            }
                        >
                            <Download size={17} />
                            Download PDF
                        </button>
                    </section>

                    <section className="invoice-details-card bill-payments-card">
                                <div className="invoice-details-card-header">
                                    <h2>
                                        Payment history
                                    </h2>
                                </div>

                                {(bill.payments || []).length > 0 ? (
                                <div className="bill-payment-list">
                                    {(bill.payments || []).map(
                                        (
                                            payment,
                                            index
                                        ) => (
                                            <div
                                                className="bill-payment-item"
                                                key={
                                                    payment.id ||
                                                    `${payment.paymentDate}-${index}`
                                                }
                                            >
                                                <div>
                                                    <strong>
                                                        {payment.paymentMethod ||
                                                            "Payment"}
                                                    </strong>

                                                    <span>
                                                        {formatPaymentDate(
                                                            payment.paymentDate
                                                        )}
                                                    </span>

                                                    {payment.bankAccountName && (
                                                        <small>
                                                            Paid from{" "}
                                                            {
                                                                payment.bankAccountName
                                                            }
                                                        </small>
                                                    )}

                                                    {payment.reference && (
                                                        <small>
                                                            Reference:{" "}
                                                            {
                                                                payment.reference
                                                            }
                                                        </small>
                                                    )}

                                                    <small className="bill-payment-status">{payment.status || "Posted"}</small>

                                                    {payment.bankTransactionId && (
                                                        <small>
                                                            Bank transaction recorded
                                                        </small>
                                                    )}
                                                </div>

                                                <div className="invoice-payment-history-actions">
                                                    <strong>
                                                        {formatCurrency(
                                                            payment.amount,
                                                            bill.currency
                                                        )}
                                                    </strong>

                                                    {payment.accountingJournal && <Link className="invoice-number-link" to={`/accounting/journals/${payment.accountingJournal}`}>View journal</Link>}
                                                </div>
                                            </div>
                                        )
                                    )}
                                </div>
                                ) : <div className="bill-payment-empty"><p>No payments have been recorded for this bill.</p>{canRecordPayment && <button type="button" className="invoice-secondary-button" onClick={() => setIsPaymentModalOpen(true)}><CircleDollarSign size={16} />Record payment</button>}</div>}
                            </section>

                    <section className="invoice-details-card">
                        <div className="invoice-details-card-header">
                            <h2>Activity</h2>
                        </div>

                        {(bill.activity || [])
                            .length > 0 ? (
                            <div className="invoice-activity-list">
                                {(bill.activity || []).map(
                                    (
                                        activity,
                                        index
                                    ) => (
                                        <div
                                            className="invoice-activity-item"
                                            key={
                                                activity.id ||
                                                `${activity.date}-${index}`
                                            }
                                        >
                                            <span className="invoice-activity-dot" />

                                            <div>
                                                <strong>
                                                    {activity.title}
                                                </strong>

                                                <p>
                                                    {
                                                        activity.description
                                                    }
                                                </p>

                                                <small>
                                                    {activity.date}
                                                </small>
                                            </div>
                                        </div>
                                    )
                                )}
                            </div>
                        ) : (
                            <p>
                                No activity has been
                                recorded for this bill.
                            </p>
                        )}
                    </section>
                </aside>
            </div>

            <RecordBillPaymentModal
                isOpen={isPaymentModalOpen}
                bill={bill}
                outstanding={
                    bill.amountDue
                }
                onClose={() =>
                    setIsPaymentModalOpen(false)
                }
                onRecord={
                    handleRecordPayment
                }
            />
        </div>
    );
}

export default BillDetailsPage;
