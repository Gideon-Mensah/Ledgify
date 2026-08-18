import {
    ArrowLeft,
    Save,
} from "lucide-react";
import {
    useEffect,
    useState,
} from "react";
import {
    Link,
    useNavigate,
    useParams,
} from "react-router-dom";

import CustomerForm from "../../components/contacts/CustomerForm";

import { contactApiService } from "../../services/contactApiService";
import { normaliseApiError } from "../../services/apiError";

// Creates form data.
const createFormData = (customer) => ({
    name: customer?.name || "",
    contactName:
        customer?.contactName || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    website: customer?.website || "",
    accountNumber:
        customer?.accountNumber || "",

    address: {
        line1:
            customer?.address?.line1 || "",
        line2:
            customer?.address?.line2 || "",
        city:
            customer?.address?.city || "",
        county:
            customer?.address?.county || "",
        postcode:
            customer?.address?.postcode || "",
        country:
            customer?.address?.country ||
            "United Kingdom",
    },

    paymentTerms:
        customer?.paymentTerms || "30 days",
    currency:
        customer?.currency || "GBP",
    taxNumber:
        customer?.taxNumber || "",
    defaultIncomeAccount:
        customer?.defaultIncomeAccount ||
        "200",
    creditLimit:
        customer?.creditLimit ?? 0,
    status:
        customer?.status || "Active",
    notes:
        customer?.notes || "",
});

// Renders the edit customer page component.
function EditCustomerPage() {
    const { customerId } = useParams();
    const navigate = useNavigate();

    const [customer, setCustomer] = useState(null);

    const [formData, setFormData] =
        useState(null);

    const [errors, setErrors] =
        useState({});

    const [submitError, setSubmitError] =
        useState("");

    const [isSaving, setIsSaving] =
        useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        contactApiService.get(customerId).then((data) => {
            if (!cancelled) {
                setCustomer(data);
                setFormData(createFormData(data));
            }
        }).catch((error) => {
            if (!cancelled) setSubmitError(normaliseApiError(error));
        }).finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [customerId]);

    if (isLoading) return <div className="customer-not-found">Loading customer…</div>;

    if (!customer) {
        return (
            <div className="customer-not-found">
                <h1>Customer not found</h1>

                <p>
                    This customer may have been
                    removed or the link is incorrect.
                </p>

                <Link
                    to="/contacts/customers"
                    className="page-primary-button"
                >
                    <ArrowLeft size={17} />
                    Return to Customers
                </Link>
            </div>
        );
    }

    // Handles change.
    const handleChange = (event) => {
        const { name, value } =
            event.target;

        setFormData((currentData) => ({
            ...currentData,
            [name]: value,
        }));

        setErrors((currentErrors) => ({
            ...currentErrors,
            [name]: "",
        }));

        setSubmitError("");
    };

    // Validates form.
    const validateForm = () => {
        const nextErrors = {};

        if (!formData.name.trim()) {
            nextErrors.name =
                "Customer name is required.";
        }

        if (
            formData.email &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                formData.email
            )
        ) {
            nextErrors.email =
                "Enter a valid email address.";
        }

        {
            errors.email && (
                <small className="form-error">
                    {errors.email}
                </small>
            )
        }

        if (
            Number(formData.creditLimit) < 0
        ) {
            nextErrors.creditLimit =
                "Credit limit cannot be negative.";
        }

        {
            errors.creditLimit && (
                <small className="form-error">
                    {errors.creditLimit}
                </small>
            )
        }

        setErrors(nextErrors);

        return (
            Object.keys(nextErrors).length ===
            0
        );
    };

    // Handles submit.
    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!validateForm()) {
            return;
        }

        try {
            setIsSaving(true);
            setSubmitError("");

            const updatedCustomer =
                await contactApiService.updateCustomer(
                    customerId,
                    formData
                );

            navigate(
                `/contacts/customers/${updatedCustomer.id}`
            );
        } catch (error) {
            setSubmitError(
                normaliseApiError(error)
            );

            setIsSaving(false);
        }
    };

    return (
        <div className="edit-customer-page">
            <div className="edit-customer-header">
                <div>
                    <Link
                        to={`/contacts/customers/${customerId}`}
                        className="edit-customer-back-link"
                    >
                        <ArrowLeft size={17} />
                        Back to Customer
                    </Link>

                    <h1>Edit Customer</h1>

                    <p>
                        Update contact, address and
                        financial information for{" "}
                        {customer.name}.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                {submitError && (
                    <div
                        className="edit-customer-alert"
                        role="alert"
                    >
                        {submitError}
                    </div>
                )}

                <CustomerForm
                    formData={formData}
                    errors={errors}
                    onChange={handleChange}
                />

                <div className="edit-customer-actions">
                    <Link
                        to={`/contacts/customers/${customerId}`}
                        className="edit-customer-cancel-button"
                    >
                        Cancel
                    </Link>

                    <button
                        type="submit"
                        className="page-primary-button"
                        disabled={isSaving}
                    >
                        <Save size={17} />

                        {isSaving
                            ? "Saving..."
                            : "Save Changes"}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default EditCustomerPage;
