import { useState } from "react";
import {
  ArrowLeft,
  Save,
} from "lucide-react";
import {
  Link,
  useNavigate,
} from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import { contactApiService } from "../../services/contactApiService";
import { normaliseApiError } from "../../services/apiError";
import { fxApiService } from "../../services/fxApiService";
import { useEffect } from "react";

const paymentTermsOptions = [
  "Due immediately",
  "7 days",
  "14 days",
  "30 days",
  "60 days",
];

const initialForm = {
  name: "",
  accountNumber: "",
  contactName: "",
  email: "",
  phone: "",
  website: "",
  paymentTerms: "30 days",
  currency: "GBP",
  taxNumber: "",
  status: "Active",
  notes: "",
  address: {
    line1: "",
    line2: "",
    city: "",
    county: "",
    postcode: "",
    country: "GB",
  },
};

// Renders the new supplier page component.
function NewSupplierPage() {
  const navigate = useNavigate();

  const [form, setForm] =
    useState(() => ({
      ...initialForm,
      accountNumber: "",
    }));

  const [errors, setErrors] =
    useState({});
  const [currencies, setCurrencies] = useState([]);

  useEffect(() => {
    let active = true;
    fxApiService.currencies().then((result) => {
      if (active) setCurrencies(Array.isArray(result) ? result : result.results || []);
    }).catch((error) => {
      if (active) setErrors((current) => ({ ...current, form: normaliseApiError(error) }));
    });
    return () => { active = false; };
  }, []);

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

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
      const newSupplier =
        await contactApiService.createSupplier({
          name: form.name.trim(),
          accountNumber:
            form.accountNumber.trim(),
          contactName:
            form.contactName.trim(),
          email:
            form.email
              .trim()
              .toLowerCase(),
          phone: form.phone.trim(),
          website:
            form.website.trim(),
          paymentTerms:
            form.paymentTerms,
          currency: form.currency,
          taxNumber:
            form.taxNumber.trim(),
          status: form.status,
          notes: form.notes.trim(),
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
        });

      navigate(
        `/purchases/suppliers/${newSupplier.id}?created=1`
      );
    } catch (error) {
      console.error(
        "Unable to create supplier:",
        error
      );

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
          to="/purchases/suppliers"
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to suppliers
        </Link>
      </div>

      <PageHeader
        eyebrow="Purchases"
        title="New supplier"
        description="Create a supplier record for bills, payments and purchasing history."
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
                  Enter the supplier’s
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
                  placeholder="For example, Greenfield Services Ltd"
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
                  placeholder="Main contact person"
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
                  placeholder="accounts@example.com"
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
                  placeholder="0114 555 0000"
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
                  placeholder="https://example.com"
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
                  Enter the supplier’s
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
                  Configure default
                  purchasing and tax
                  information.
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
                  {!currencies.some((currency) => currency.code === form.currency) && <option value={form.currency}>{form.currency}</option>}
                  {currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} – {currency.name}</option>)}
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="taxNumber">
                  VAT or tax number
                </label>

                <input
                  id="taxNumber"
                  name="taxNumber"
                  value={
                    form.taxNumber
                  }
                  onChange={handleChange}
                  placeholder="For example, GB123456789"
                />
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

                <p>
                  Add internal information
                  about this supplier.
                </p>
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
                placeholder="Optional internal notes"
              />
            </div>
          </div>
        </section>

        <aside className="invoice-form-sidebar">
          <div className="invoice-total-card">
            <h2>Supplier summary</h2>

            <div className="supplier-form-summary">
              <div>
                <span>Name</span>

                <strong>
                  {form.name ||
                    "New supplier"}
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
                : "Create supplier"}
            </button>

            <Link
              to="/purchases/suppliers"
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

export default NewSupplierPage;
