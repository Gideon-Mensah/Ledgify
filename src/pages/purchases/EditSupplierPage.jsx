import {
  useEffect,
  useState,
} from "react";
import {
  ArrowLeft,
  Save,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import { contactApiService } from "../../services/contactApiService";
import { normaliseApiError } from "../../services/apiError";

const paymentTermsOptions = [
  "Due immediately",
  "7 days",
  "14 days",
  "30 days",
  "60 days",
];

const expenseAccounts = [
  {
    code: "400",
    name: "Advertising and marketing",
  },
  {
    code: "420",
    name: "Office expenses",
  },
  {
    code: "438",
    name: "Software subscriptions",
  },
  {
    code: "445",
    name: "Utilities",
  },
  {
    code: "469",
    name: "Rent",
  },
  {
    code: "473",
    name: "Repairs and maintenance",
  },
  {
    code: "477",
    name: "Professional fees",
  },
  {
    code: "485",
    name: "Travel expenses",
  },
];

// Renders the edit supplier page component.
function EditSupplierPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();

  const [supplier, setSupplier] =
    useState(null);

  const [form, setForm] =
    useState(null);

  const [errors, setErrors] =
    useState({});

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    let cancelled = false;
    const initialLoad = window.requestAnimationFrame(async () => {
    let selectedSupplier;
    try {
      selectedSupplier = await contactApiService.get(supplierId);
    } catch (error) {
      if (!cancelled) setErrors({ form: normaliseApiError(error) });
      return;
    }
    if (cancelled) return;

    if (!selectedSupplier) {
      setSupplier(null);
      setForm(null);
      return;
    }

    setSupplier(selectedSupplier);

    setForm({
      name:
        selectedSupplier.name || "",
      accountNumber:
        selectedSupplier.accountNumber ||
        "",
      contactName:
        selectedSupplier.contactName ||
        "",
      email:
        selectedSupplier.email || "",
      phone:
        selectedSupplier.phone || "",
      website:
        selectedSupplier.website || "",
      paymentTerms:
        selectedSupplier.paymentTerms ||
        "30 days",
      currency:
        selectedSupplier.currency ||
        "GBP",
      taxNumber:
        selectedSupplier.taxNumber ||
        "",
      defaultExpenseAccount:
        selectedSupplier
          .defaultExpenseAccount || "",
      status:
        selectedSupplier.status ||
        "Active",
      notes:
        selectedSupplier.notes || "",
      address: {
        line1:
          selectedSupplier.address
            ?.line1 || "",
        line2:
          selectedSupplier.address
            ?.line2 || "",
        city:
          selectedSupplier.address
            ?.city || "",
        county:
          selectedSupplier.address
            ?.county || "",
        postcode:
          selectedSupplier.address
            ?.postcode || "",
        country:
          selectedSupplier.address
            ?.country ||
          "United Kingdom",
      },
    });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(initialLoad);
    };
  }, [supplierId]);

  if (!supplier || !form) {
    return (
      <div className="new-invoice-page">
        <div className="invoice-back-row">
          <Link
            to="/purchases/suppliers"
            className="invoice-back-link"
          >
            <ArrowLeft size={17} />
            Back to suppliers
          </Link>
        </div>

        <section className="invoice-form-card">
          <h1>
            Supplier not found
          </h1>

          <p>
            The requested supplier
            record does not exist.
          </p>
        </section>
      </div>
    );
  }

  // Handles change.
  const handleChange = (event) => {
    const { name, value } =
      event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      [name]: "",
      form: "",
    }));
  };

  // Handles address change.
  const handleAddressChange = (
    event
  ) => {
    const { name, value } =
      event.target;

    setForm((currentForm) => ({
      ...currentForm,
      address: {
        ...currentForm.address,
        [name]: value,
      },
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      [name]: "",
      form: "",
    }));
  };

  // Validates form.
  const validateForm = () => {
    const nextErrors = {};

    if (!form.name.trim()) {
      nextErrors.name =
        "Enter the supplier name.";
    }

    if (
      !form.accountNumber.trim()
    ) {
      nextErrors.accountNumber =
        "Enter an account number.";
    }

    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.email.trim()
      )
    ) {
      nextErrors.email =
        "Enter a valid email address.";
    }

    if (
      form.website.trim() &&
      !/^https?:\/\/.+/i.test(
        form.website.trim()
      )
    ) {
      nextErrors.website =
        "Include http:// or https:// in the website address.";
    }

    if (
      !form.address.line1.trim()
    ) {
      nextErrors.line1 =
        "Enter the first address line.";
    }

    if (
      !form.address.city.trim()
    ) {
      nextErrors.city =
        "Enter the city.";
    }

    if (
      !form.address.postcode.trim()
    ) {
      nextErrors.postcode =
        "Enter the postcode.";
    }

    if (
      !form.address.country.trim()
    ) {
      nextErrors.country =
        "Enter the country.";
    }

    setErrors(nextErrors);

    return (
      Object.keys(nextErrors)
        .length === 0
    );
  };

  // Handles submit.
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSaving(true);

    try {
      const updatedSupplier =
        await contactApiService.updateSupplier(
          supplier.id,
          {
            name:
              form.name.trim(),
            accountNumber:
              form.accountNumber.trim(),
            contactName:
              form.contactName.trim(),
            email:
              form.email
                .trim()
                .toLowerCase(),
            phone:
              form.phone.trim(),
            website:
              form.website.trim(),
            paymentTerms:
              form.paymentTerms,
            currency:
              form.currency,
            taxNumber:
              form.taxNumber.trim(),
            defaultExpenseAccount:
              form.defaultExpenseAccount,
            status:
              form.status,
            notes:
              form.notes.trim(),
            address: {
              line1:
                form.address.line1.trim(),
              line2:
                form.address.line2.trim(),
              city:
                form.address.city.trim(),
              county:
                form.address.county.trim(),
              postcode:
                form.address.postcode
                  .trim()
                  .toUpperCase(),
              country:
                form.address.country.trim(),
            },
          }
        );

      navigate(
        `/purchases/suppliers/${updatedSupplier.id}`
      );
    } catch (error) {
      setErrors({
        form:
          normaliseApiError(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="new-invoice-page">
      <div className="invoice-back-row">
        <Link
          to={`/purchases/suppliers/${supplier.id}`}
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to supplier
        </Link>
      </div>

      <PageHeader
        eyebrow="Purchases"
        title={`Edit ${supplier.name}`}
        description="Update the supplier’s contact details, address and financial settings."
      />

      <form
        className="invoice-form-layout"
        onSubmit={handleSubmit}
      >
        <section className="invoice-form-main">
          {errors.form && (
            <div className="invoice-form-alert">
              {errors.form}
            </div>
          )}

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Supplier details
                </h2>

                <p>
                  Update the supplier’s
                  business and contact
                  information.
                </p>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div className="invoice-form-field">
                <label htmlFor="name">
                  Supplier name
                </label>

                <input
                  id="name"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                />

                {errors.name && (
                  <small className="form-error-message">
                    {errors.name}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="accountNumber">
                  Account number
                </label>

                <input
                  id="accountNumber"
                  name="accountNumber"
                  value={
                    form.accountNumber
                  }
                  onChange={handleChange}
                />

                {errors.accountNumber && (
                  <small className="form-error-message">
                    {
                      errors.accountNumber
                    }
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="contactName">
                  Contact name
                </label>

                <input
                  id="contactName"
                  name="contactName"
                  value={
                    form.contactName
                  }
                  onChange={handleChange}
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="email">
                  Email address
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                />

                {errors.email && (
                  <small className="form-error-message">
                    {errors.email}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="phone">
                  Phone number
                </label>

                <input
                  id="phone"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="website">
                  Website
                </label>

                <input
                  id="website"
                  name="website"
                  type="url"
                  value={form.website}
                  onChange={handleChange}
                />

                {errors.website && (
                  <small className="form-error-message">
                    {errors.website}
                  </small>
                )}
              </div>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Address</h2>

                <p>
                  Update the supplier’s
                  registered or trading
                  address.
                </p>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div className="invoice-form-field invoice-form-field-full">
                <label htmlFor="line1">
                  Address line 1
                </label>

                <input
                  id="line1"
                  name="line1"
                  value={
                    form.address.line1
                  }
                  onChange={
                    handleAddressChange
                  }
                />

                {errors.line1 && (
                  <small className="form-error-message">
                    {errors.line1}
                  </small>
                )}
              </div>

              <div className="invoice-form-field invoice-form-field-full">
                <label htmlFor="line2">
                  Address line 2
                </label>

                <input
                  id="line2"
                  name="line2"
                  value={
                    form.address.line2
                  }
                  onChange={
                    handleAddressChange
                  }
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="city">
                  City
                </label>

                <input
                  id="city"
                  name="city"
                  value={
                    form.address.city
                  }
                  onChange={
                    handleAddressChange
                  }
                />

                {errors.city && (
                  <small className="form-error-message">
                    {errors.city}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="county">
                  County or region
                </label>

                <input
                  id="county"
                  name="county"
                  value={
                    form.address.county
                  }
                  onChange={
                    handleAddressChange
                  }
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="postcode">
                  Postcode
                </label>

                <input
                  id="postcode"
                  name="postcode"
                  value={
                    form.address.postcode
                  }
                  onChange={
                    handleAddressChange
                  }
                />

                {errors.postcode && (
                  <small className="form-error-message">
                    {errors.postcode}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="country">
                  Country
                </label>

                <input
                  id="country"
                  name="country"
                  value={
                    form.address.country
                  }
                  onChange={
                    handleAddressChange
                  }
                />

                {errors.country && (
                  <small className="form-error-message">
                    {errors.country}
                  </small>
                )}
              </div>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Financial settings
                </h2>

                <p>
                  Update purchasing,
                  tax and payment
                  defaults.
                </p>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div className="invoice-form-field">
                <label htmlFor="paymentTerms">
                  Payment terms
                </label>

                <select
                  id="paymentTerms"
                  name="paymentTerms"
                  value={
                    form.paymentTerms
                  }
                  onChange={handleChange}
                >
                  {paymentTermsOptions.map(
                    (term) => (
                      <option
                        key={term}
                        value={term}
                      >
                        {term}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="currency">
                  Currency
                </label>

                <select
                  id="currency"
                  name="currency"
                  value={form.currency}
                  onChange={handleChange}
                >
                  <option value="GBP">
                    GBP – British Pound
                  </option>

                  <option value="USD">
                    USD – US Dollar
                  </option>

                  <option value="EUR">
                    EUR – Euro
                  </option>

                  <option value="GHS">
                    GHS – Ghana Cedi
                  </option>
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="taxNumber">
                  VAT or tax number
                </label>

                <input
                  id="taxNumber"
                  name="taxNumber"
                  value={form.taxNumber}
                  onChange={handleChange}
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="defaultExpenseAccount">
                  Default expense account
                </label>

                <select
                  id="defaultExpenseAccount"
                  name="defaultExpenseAccount"
                  value={
                    form.defaultExpenseAccount
                  }
                  onChange={handleChange}
                >
                  <option value="">
                    No default account
                  </option>

                  {expenseAccounts.map(
                    (account) => (
                      <option
                        key={account.code}
                        value={account.code}
                      >
                        {account.code} –{" "}
                        {account.name}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="status">
                  Supplier status
                </label>

                <select
                  id="status"
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value="Active">
                    Active
                  </option>

                  <option value="Inactive">
                    Inactive
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Notes</h2>
              </div>
            </div>

            <div className="invoice-form-field">
              <label htmlFor="notes">
                Supplier notes
              </label>

              <textarea
                id="notes"
                name="notes"
                rows="5"
                value={form.notes}
                onChange={handleChange}
              />
            </div>
          </div>
        </section>

        <aside className="invoice-form-sidebar">
          <div className="invoice-total-card">
            <h2>
              Updated supplier
            </h2>

            <div className="supplier-form-summary">
              <div>
                <span>Name</span>

                <strong>
                  {form.name || "—"}
                </strong>
              </div>

              <div>
                <span>
                  Account number
                </span>

                <strong>
                  {form.accountNumber ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Payment terms
                </span>

                <strong>
                  {form.paymentTerms}
                </strong>
              </div>

              <div>
                <span>Currency</span>

                <strong>
                  {form.currency}
                </strong>
              </div>

              <div>
                <span>Status</span>

                <strong>
                  {form.status}
                </strong>
              </div>
            </div>
          </div>

          <div className="invoice-action-card">
            <button
              type="submit"
              className="invoice-approve-button"
              disabled={isSaving}
            >
              <Save size={18} />

              {isSaving
                ? "Saving..."
                : "Save changes"}
            </button>

            <Link
              to={`/purchases/suppliers/${supplier.id}`}
              className="invoice-save-draft-button"
            >
              Cancel
            </Link>
          </div>
        </aside>
      </form>
    </div>
  );
}

export default EditSupplierPage;
