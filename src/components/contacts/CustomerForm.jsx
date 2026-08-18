// Renders the customer form component.
function CustomerForm({
  formData,
  errors,
  onChange,
}) {
  // Handles change.
  const handleChange = (event) => {
    const { name, value } = event.target;

    if (name.startsWith("address.")) {
      const field = name.split(".")[1];

      onChange({
        target: {
          name: "address",
          value: {
            ...formData.address,
            [field]: value,
          },
        },
      });

      return;
    }

    onChange(event);
  };

  return (
    <div className="customer-form">

      <section className="form-section">

        <h2>Customer Information</h2>

        <div className="form-grid">

          <div className="form-group">
            <label>Customer Name *</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
            />
            {errors.name && (
              <small className="form-error">
                {errors.name}
              </small>
            )}
          </div>

          <div className="form-group">
            <label>Contact Name</label>
            <input
              type="text"
              name="contactName"
              value={formData.contactName}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Phone</label>
            <input
              type="text"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Website</label>
            <input
              type="text"
              name="website"
              value={formData.website}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Account Number</label>
            <input
              type="text"
              name="accountNumber"
              value={formData.accountNumber}
              onChange={handleChange}
            />
          </div>

        </div>

      </section>

      <section className="form-section">

        <h2>Address</h2>

        <div className="form-grid">

          <div className="form-group">
            <label>Address Line 1</label>
            <input
              type="text"
              name="address.line1"
              value={formData.address.line1}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Address Line 2</label>
            <input
              type="text"
              name="address.line2"
              value={formData.address.line2}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>City</label>
            <input
              type="text"
              name="address.city"
              value={formData.address.city}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>County</label>
            <input
              type="text"
              name="address.county"
              value={formData.address.county}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Postcode</label>
            <input
              type="text"
              name="address.postcode"
              value={formData.address.postcode}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Country</label>
            <input
              type="text"
              name="address.country"
              value={formData.address.country}
              onChange={handleChange}
            />
          </div>

        </div>

      </section>

      <section className="form-section">

        <h2>Accounting</h2>

        <div className="form-grid">

          <div className="form-group">
            <label>Payment Terms</label>
            <input
              type="text"
              name="paymentTerms"
              value={formData.paymentTerms}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Currency</label>
            <input
              type="text"
              name="currency"
              value={formData.currency}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Tax Number</label>
            <input
              type="text"
              name="taxNumber"
              value={formData.taxNumber}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Default Income Account</label>
            <input
              type="text"
              name="defaultIncomeAccount"
              value={formData.defaultIncomeAccount}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Credit Limit</label>
            <input
              type="number"
              name="creditLimit"
              value={formData.creditLimit}
              onChange={handleChange}
            />
          </div>

        </div>

      </section>

      <section className="form-section">

        <h2>Notes</h2>

        <textarea
          rows="5"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          className="form-textarea"
        />

      </section>

    </div>
  );
}

export default CustomerForm;