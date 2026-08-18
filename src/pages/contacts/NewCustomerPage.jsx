import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
} from "lucide-react";

import PageHeader from "../../components/layout/PageHeader";
import CustomerForm from "../../components/contacts/CustomerForm";
import { contactApiService } from "../../services/contactApiService";
import { normaliseApiError } from "../../services/apiError";

// Creates initial form.
const createInitialForm = () => ({
  name: "",
  contactName: "",
  email: "",
  phone: "",
  website: "",
  accountNumber: "",
  paymentTerms: "30 days",
  currency: "GBP",
  taxNumber: "",
  defaultIncomeAccount: "200",
  creditLimit: 0,
  status: "Active",
  notes: "",
  address: {
    line1: "",
    line2: "",
    city: "",
    county: "",
    postcode: "",
    country: "United Kingdom",
  },
});

// Renders the new customer page component.
function NewCustomerPage() {
  const navigate = useNavigate();

  const [formData, setFormData] =
    useState(createInitialForm);

  const [errors, setErrors] =
    useState({});

  const [saving, setSaving] =
    useState(false);

  // Handles change.
  const handleChange = (event) => {
    const { name, value } =
      event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // Performs the validate task.
  const validate = () => {
    const validationErrors = {};

    if (!formData.name.trim()) {
      validationErrors.name =
        "Customer name is required.";
    }

    setErrors(validationErrors);

    return (
      Object.keys(validationErrors)
        .length === 0
    );
  };

  // Handles submit.
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    try {
      setSaving(true);

      const customer =
        await contactApiService.createCustomer(formData);

      navigate(
        `/contacts/customers/${customer.id}`
      );
    } catch (error) {
      alert(normaliseApiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>

      <PageHeader
        eyebrow="Contacts"
        title="New Customer"
        description="Create a new customer."
        action={
          <button
            type="button"
            className="page-secondary-button"
            onClick={() =>
              navigate(-1)
            }
          >
            <ArrowLeft size={18} />
            Back
          </button>
        }
      />

      <form onSubmit={handleSubmit}>

        <CustomerForm
          formData={formData}
          errors={errors}
          onChange={handleChange}
        />

        <div className="page-form-actions">

          <button
            type="submit"
            className="page-primary-button"
            disabled={saving}
          >
            <Save size={18} />

            {saving
              ? "Saving..."
              : "Save Customer"}
          </button>

        </div>

      </form>

    </div>
  );
}

export default NewCustomerPage;
