import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import Modal from "../common/Modal";

// Checks whether valid email is true.
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// Renders the email invoice modal component.
function EmailInvoiceModal({
  isOpen,
  invoice,
  onClose,
  onSend,
}) {
  const [emailDetails, setEmailDetails] = useState({
    to: "",
    cc: "",
    subject: "",
    message: "",
  });

  const [errors, setErrors] = useState({});
  const [isSending, setIsSending] = useState(false);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    if (!isOpen || !invoice) {
      return;
    }

    const initialiseForm = window.requestAnimationFrame(() => {

    setEmailDetails({
      to: invoice.customerEmail || "",
      cc: "",
      subject: `Invoice ${invoice.invoiceNumber} from Accounting Cloud Ltd`,
      message: `Hello ${invoice.customer},

Please find invoice ${invoice.invoiceNumber} attached.

The invoice is due on ${invoice.dueDate}.

Please use ${invoice.invoiceNumber} as your payment reference.

Kind regards,
Accounting Cloud Ltd`,
    });

    setErrors({});
    setIsSending(false);
    });
    return () => window.cancelAnimationFrame(initialiseForm);
  }, [isOpen, invoice]);

  // Handles change.
  const handleChange = (event) => {
    const { name, value } = event.target;

    setEmailDetails((currentDetails) => ({
      ...currentDetails,
      [name]: value,
    }));

    setErrors((currentErrors) => ({
      ...currentErrors,
      [name]: "",
    }));
  };

  // Validates form.
  const validateForm = () => {
    const nextErrors = {};

    if (!emailDetails.to.trim()) {
      nextErrors.to = "Enter the recipient email address.";
    } else if (!isValidEmail(emailDetails.to.trim())) {
      nextErrors.to = "Enter a valid email address.";
    }

    if (
      emailDetails.cc.trim() &&
      !isValidEmail(emailDetails.cc.trim())
    ) {
      nextErrors.cc = "Enter a valid CC email address.";
    }

    if (!emailDetails.subject.trim()) {
      nextErrors.subject = "Enter an email subject.";
    }

    if (!emailDetails.message.trim()) {
      nextErrors.message = "Enter an email message.";
    }

    setErrors(nextErrors);

    return Object.keys(nextErrors).length === 0;
  };

  // Handles submit.
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSending(true);

    try {
      await onSend({
        to: emailDetails.to.trim(),
        cc: emailDetails.cc.trim(),
        subject: emailDetails.subject.trim(),
        message: emailDetails.message.trim(),
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Email invoice"
      description={`Send ${invoice?.invoiceNumber || "invoice"} to the customer.`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="modal-secondary-button"
            onClick={onClose}
            disabled={isSending}
          >
            Cancel
          </button>

          <button
            type="submit"
            form="email-invoice-form"
            className="page-primary-button"
            disabled={isSending}
          >
            <Mail size={18} />

            {isSending
              ? "Sending..."
              : "Send invoice"}
          </button>
        </>
      }
    >
      <form
        id="email-invoice-form"
        className="email-invoice-form"
        onSubmit={handleSubmit}
      >
        <div className="email-invoice-attachment">
          <div>
            <strong>{invoice?.invoiceNumber}.pdf</strong>

            <span>
              Invoice PDF will be attached
            </span>
          </div>

          <span>PDF</span>
        </div>

        <div className="invoice-form-field">
          <label htmlFor="invoiceEmailTo">
            To
          </label>

          <input
            id="invoiceEmailTo"
            name="to"
            type="email"
            placeholder="customer@example.com"
            value={emailDetails.to}
            onChange={handleChange}
          />

          {errors.to && (
            <small className="form-error-message">
              {errors.to}
            </small>
          )}
        </div>

        <div className="invoice-form-field">
          <label htmlFor="invoiceEmailCc">
            CC
          </label>

          <input
            id="invoiceEmailCc"
            name="cc"
            type="email"
            placeholder="Optional CC email"
            value={emailDetails.cc}
            onChange={handleChange}
          />

          {errors.cc && (
            <small className="form-error-message">
              {errors.cc}
            </small>
          )}
        </div>

        <div className="invoice-form-field">
          <label htmlFor="invoiceEmailSubject">
            Subject
          </label>

          <input
            id="invoiceEmailSubject"
            name="subject"
            type="text"
            value={emailDetails.subject}
            onChange={handleChange}
          />

          {errors.subject && (
            <small className="form-error-message">
              {errors.subject}
            </small>
          )}
        </div>

        <div className="invoice-form-field">
          <label htmlFor="invoiceEmailMessage">
            Message
          </label>

          <textarea
            id="invoiceEmailMessage"
            name="message"
            rows="9"
            value={emailDetails.message}
            onChange={handleChange}
          />

          {errors.message && (
            <small className="form-error-message">
              {errors.message}
            </small>
          )}
        </div>
      </form>
    </Modal>
  );
}

export default EmailInvoiceModal;
