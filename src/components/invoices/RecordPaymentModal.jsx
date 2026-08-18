import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Banknote,
  Landmark,
} from "lucide-react";

import Modal from "../common/Modal";

import { accountLookupService } from "../../services/accountLookupService";

// Gets today.
const getToday = () => {
  const today = new Date();

  const year = today.getFullYear();

  const month = String(
    today.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    today.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
        currency: currency || "GBP",
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

// Renders the record payment modal component.
function RecordPaymentModal({
  isOpen,
  invoiceNumber,
  balanceDue,
  invoiceCurrency = "GBP",
  onClose,
  onSave,
}) {
  const [
    bankAccounts,
    setBankAccounts,
  ] = useState([]);

  const [
    paymentDetails,
    setPaymentDetails,
  ] = useState({
    amount: "",
    paymentDate: getToday(),
    bankAccountId: "",
    paymentMethod:
      "Bank transfer",
    reference: "",
    notes: "",
  });

  const [errors, setErrors] =
    useState({});

  const [
    isRecording,
    setIsRecording,
  ] = useState(false);

  const paymentCurrency = String(
    invoiceCurrency || "GBP"
  ).toUpperCase();

  const compatibleAccounts =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return bankAccounts.filter(
        (account) =>
          account.status !==
            "Archived" &&
          String(
            account.currency ||
              "GBP"
          ).toUpperCase() ===
            paymentCurrency
      );
    }, [
      bankAccounts,
      paymentCurrency,
    ]);

  const selectedAccount =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return (
        compatibleAccounts.find(
          (account) =>
            String(account.id) ===
            String(
              paymentDetails.bankAccountId
            )
        ) || null
      );
    }, [
      compatibleAccounts,
      paymentDetails.bankAccountId,
    ]);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    const initialiseForm = window.requestAnimationFrame(async () => {

    let availableAccounts = [];

    try {
      availableAccounts = await accountLookupService.bank();
    } catch (error) {
      console.error(
        "Bank ledger accounts could not be loaded:",
        error
      );
    }

    if (cancelled) return;
    setBankAccounts(
      availableAccounts
    );

    const matchingAccounts =
      availableAccounts.filter(
        (account) =>
          account.status !==
            "Archived" &&
          String(
            account.currency ||
              "GBP"
          ).toUpperCase() ===
            paymentCurrency
      );

    const defaultAccount =
      matchingAccounts.find(
        (account) =>
          account.isDefault
      ) || matchingAccounts[0];

    setPaymentDetails({
      amount:
        Number(balanceDue) > 0
          ? Number(
              balanceDue
            ).toFixed(2)
          : "",

      paymentDate: getToday(),

      bankAccountId:
        defaultAccount?.id || "",

      paymentMethod:
        "Bank transfer",

      reference:
        invoiceNumber || "",

      notes: "",
    });

    setErrors({});
    setIsRecording(false);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(initialiseForm);
    };
  }, [
    isOpen,
    balanceDue,
    invoiceNumber,
    paymentCurrency,
  ]);

  // Handles change.
  const handleChange = (
    event
  ) => {
    const { name, value } =
      event.target;

    setPaymentDetails(
      (currentDetails) => ({
        ...currentDetails,
        [name]: value,
      })
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        [name]: "",
        form: "",
      })
    );
  };

  // Handles close.
  const handleClose = () => {
    if (isRecording) {
      return;
    }

    onClose();
  };

  // Validates form.
  const validateForm = () => {
    const nextErrors = {};

    const amount = Number(
      paymentDetails.amount
    );

    const numericBalance =
      Number(balanceDue) || 0;

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      nextErrors.amount =
        "Enter a payment amount greater than zero.";
    } else if (
      amount >
      numericBalance + 0.005
    ) {
      nextErrors.amount =
        `The payment cannot exceed ${formatCurrency(
          numericBalance,
          paymentCurrency
        )}.`;
    }

    if (
      !paymentDetails.paymentDate
    ) {
      nextErrors.paymentDate =
        "Select a payment date.";
    }

    if (
      !paymentDetails.bankAccountId
    ) {
      nextErrors.bankAccountId =
        "Select the account that received the payment.";
    } else if (
      !selectedAccount
    ) {
      nextErrors.bankAccountId =
        "The selected bank account is unavailable.";
    } else if (
      String(
        selectedAccount.currency ||
          "GBP"
      ).toUpperCase() !==
      paymentCurrency
    ) {
      nextErrors.bankAccountId =
        `Select a ${paymentCurrency} bank or cash account.`;
    }

    if (
      !paymentDetails.paymentMethod
    ) {
      nextErrors.paymentMethod =
        "Select a payment method.";
    }

    setErrors(nextErrors);

    return (
      Object.keys(nextErrors)
        .length === 0
    );
  };

  // Handles submit.
  const handleSubmit = async (
    event
  ) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsRecording(true);

    try {
      await onSave({
        amount: Number(
          paymentDetails.amount
        ),

        paymentDate:
          paymentDetails.paymentDate,

        bankAccountId:
          selectedAccount.id,

        bankAccount:
          selectedAccount.accountName,

        bankAccountName:
          selectedAccount.accountName,

        bankName:
          selectedAccount.bankName ||
          "",

        accountCurrency:
          selectedAccount.currency ||
          paymentCurrency,

        paymentMethod:
          paymentDetails.paymentMethod,

        reference:
          paymentDetails.reference.trim(),

        notes:
          paymentDetails.notes.trim(),
      });
    } catch (error) {
      setErrors({
        form:
          error.message ||
          "The payment could not be recorded.",
      });
    } finally {
      setIsRecording(false);
    }
  };

  const hasCompatibleAccounts =
    compatibleAccounts.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      title="Record payment"
      description={`Record a payment against ${
        invoiceNumber ||
        "this invoice"
      }.`}
      onClose={handleClose}
      footer={
        <>
          <button
            type="button"
            className="modal-secondary-button"
            disabled={isRecording}
            onClick={handleClose}
          >
            Cancel
          </button>

          <button
            type="submit"
            form="record-payment-form"
            className="page-primary-button"
            disabled={
              isRecording ||
              !hasCompatibleAccounts
            }
          >
            <Banknote size={18} />

            {isRecording
              ? "Recording..."
              : "Record payment"}
          </button>
        </>
      }
    >
      <form
        id="record-payment-form"
        className="payment-form"
        onSubmit={handleSubmit}
      >
        <div className="payment-balance-banner">
          <span>
            Current balance due
          </span>

          <strong>
            {formatCurrency(
              balanceDue,
              paymentCurrency
            )}
          </strong>
        </div>

        {errors.form && (
          <div className="invoice-form-alert">
            {errors.form}
          </div>
        )}

        {!hasCompatibleAccounts && (
          <div className="invoice-form-alert">
            No active{" "}
            {paymentCurrency} bank or
            cash account is available.
            Create a compatible account
            before recording this
            payment.
          </div>
        )}

        <div className="payment-form-grid">
          <div className="invoice-form-field">
            <label htmlFor="paymentAmount">
              Payment amount
            </label>

            <div className="payment-amount-input">
              <span>
                {paymentCurrency ===
                "GBP"
                  ? "£"
                  : paymentCurrency}
              </span>

              <input
                id="paymentAmount"
                name="amount"
                type="number"
                min="0.01"
                max={Number(
                  balanceDue
                ).toFixed(2)}
                step="0.01"
                value={
                  paymentDetails.amount
                }
                onChange={handleChange}
              />
            </div>

            {errors.amount && (
              <small className="form-error-message">
                {errors.amount}
              </small>
            )}
          </div>

          <div className="invoice-form-field">
            <label htmlFor="paymentDate">
              Payment date
            </label>

            <input
              id="paymentDate"
              name="paymentDate"
              type="date"
              value={
                paymentDetails.paymentDate
              }
              onChange={handleChange}
            />

            {errors.paymentDate && (
              <small className="form-error-message">
                {
                  errors.paymentDate
                }
              </small>
            )}
          </div>

          <div className="invoice-form-field">
            <label htmlFor="bankAccountId">
              Paid into
            </label>

            <select
              id="bankAccountId"
              name="bankAccountId"
              value={
                paymentDetails.bankAccountId
              }
              onChange={handleChange}
              disabled={
                !hasCompatibleAccounts
              }
            >
              <option value="">
                Select account
              </option>

              {compatibleAccounts.map(
                (account) => (
                  <option
                    key={account.id}
                    value={account.id}
                  >
                    {account.accountName}
                    {account.bankName
                      ? ` — ${account.bankName}`
                      : ""}
                    {account.isDefault
                      ? " (Default)"
                      : ""}
                  </option>
                )
              )}
            </select>

            {errors.bankAccountId && (
              <small className="form-error-message">
                {
                  errors.bankAccountId
                }
              </small>
            )}
          </div>

          <div className="invoice-form-field">
            <label htmlFor="paymentMethod">
              Payment method
            </label>

            <select
              id="paymentMethod"
              name="paymentMethod"
              value={
                paymentDetails.paymentMethod
              }
              onChange={handleChange}
            >
              <option value="">
                Select payment method
              </option>

              <option value="Bank transfer">
                Bank transfer
              </option>

              <option value="Debit card">
                Debit card
              </option>

              <option value="Credit card">
                Credit card
              </option>

              <option value="Cash">
                Cash
              </option>

              <option value="Cheque">
                Cheque
              </option>

              <option value="Direct debit">
                Direct debit
              </option>
            </select>

            {errors.paymentMethod && (
              <small className="form-error-message">
                {
                  errors.paymentMethod
                }
              </small>
            )}
          </div>

          {selectedAccount && (
            <div className="invoice-form-field invoice-form-field-full">
              <div className="payment-balance-banner">
                <span>
                  <Landmark size={16} />
                  {
                    selectedAccount.accountName
                  }
                </span>

                <strong>
                  {formatCurrency(
                    selectedAccount.currentBalance,
                    selectedAccount.currency
                  )}
                </strong>
              </div>
            </div>
          )}

          <div className="invoice-form-field invoice-form-field-full">
            <label htmlFor="paymentReference">
              Payment reference
            </label>

            <input
              id="paymentReference"
              name="reference"
              type="text"
              placeholder="Enter payment reference"
              value={
                paymentDetails.reference
              }
              onChange={handleChange}
            />
          </div>

          <div className="invoice-form-field invoice-form-field-full">
            <label htmlFor="paymentNotes">
              Notes
            </label>

            <textarea
              id="paymentNotes"
              name="notes"
              rows="3"
              placeholder="Optional payment notes"
              value={
                paymentDetails.notes
              }
              onChange={handleChange}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default RecordPaymentModal;
