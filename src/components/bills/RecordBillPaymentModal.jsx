import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CircleDollarSign,
  Landmark,
} from "lucide-react";

import Modal from "../common/Modal";

import { accountLookupService } from "../../services/accountLookupService";
import { useAuth } from "../../store/AuthContext";
import { getOrganisationToday } from "../../utils/dateUtils";

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

const decimalToMinorUnits = (value) => {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
};

// Renders the record bill payment modal component.
function RecordBillPaymentModal({
  isOpen,
  bill,
  outstanding,
  onClose,
  onRecord,
}) {
  const auth = useAuth();
  const today = getOrganisationToday(auth.selectedOrganisation?.timezone);
  const [
    bankAccounts,
    setBankAccounts,
  ] = useState([]);

  const [details, setDetails] =
    useState({
      amount: "",
      paymentDate: today,
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

  const billCurrency = String(
    bill?.currency || "GBP"
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
            billCurrency
      );
    }, [
      bankAccounts,
      billCurrency,
    ]);

  const selectedAccount =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return (
        compatibleAccounts.find(
          (account) =>
            String(account.id) ===
            String(
              details.bankAccountId
            )
        ) || null
      );
    }, [
      compatibleAccounts,
      details.bankAccountId,
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
        "Payment ledger accounts could not be loaded:",
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
            billCurrency
      );

    const defaultAccount =
      matchingAccounts.find(
        (account) =>
          account.isDefault
      ) || matchingAccounts[0];

    setDetails({
      amount:
        Number(outstanding) > 0
          ? Number(
              outstanding
            ).toFixed(2)
          : "",

      paymentDate: today,

      bankAccountId:
        defaultAccount?.id || "",

      paymentMethod:
        "Bank transfer",

      reference:
        bill?.billNumber || "",

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
    outstanding,
    bill?.id,
    bill?.billNumber,
    billCurrency,
    today,
  ]);

  // Handles change.
  const handleChange = (
    event
  ) => {
    const { name, value } =
      event.target;

    setDetails((current) => ({
      ...current,
      [name]: value,
    }));

    setErrors((current) => ({
      ...current,
      [name]: "",
      form: "",
    }));
  };

  // Handles close.
  const handleClose = () => {
    if (isRecording) {
      return;
    }

    onClose();
  };

  // Handles submit.
  const handleSubmit = async (
    event
  ) => {
    event.preventDefault();

    const nextErrors = {};

    const amountMinor = decimalToMinorUnits(details.amount);
    const outstandingMinor = decimalToMinorUnits(outstanding);

    if (
      amountMinor === null || amountMinor <= 0n
    ) {
      nextErrors.amount =
        "Enter an amount greater than zero.";
    } else if (
      outstandingMinor === null || amountMinor > outstandingMinor
    ) {
      nextErrors.amount =
        `The payment cannot exceed ${formatCurrency(
          outstanding,
          billCurrency
        )}.`;
    }

    if (!details.paymentDate) {
      nextErrors.paymentDate =
        "Select a payment date.";
    }

    if (
      !details.bankAccountId
    ) {
      nextErrors.bankAccountId =
        "Select the account used to make this payment.";
    } else if (
      !selectedAccount
    ) {
      nextErrors.bankAccountId =
        "The selected payment account is unavailable.";
    } else if (
      String(
        selectedAccount.currency ||
          "GBP"
      ).toUpperCase() !==
      billCurrency
    ) {
      nextErrors.bankAccountId =
        `Select a ${billCurrency} payment account.`;
    }

    if (
      !details.paymentMethod
    ) {
      nextErrors.paymentMethod =
        "Select a payment method.";
    }

    setErrors(nextErrors);

    if (
      Object.keys(nextErrors)
        .length > 0
    ) {
      return;
    }

    setIsRecording(true);

    try {
      await onRecord({
        amount: details.amount,

        paymentDate:
          details.paymentDate,

        bankAccountId:
          selectedAccount.id,

        bankAccountName:
          selectedAccount.accountName,

        bankName:
          selectedAccount.bankName,

        accountCurrency:
          selectedAccount.currency ||
          billCurrency,

        paymentMethod:
          details.paymentMethod,

        reference:
          details.reference.trim(),

        notes:
          details.notes.trim(),
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
      title="Record bill payment"
      description={`Record a payment against ${
        bill?.billNumber ||
        "this bill"
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
            form="record-bill-payment-form"
            className="page-primary-button"
            disabled={
              isRecording ||
              !hasCompatibleAccounts
            }
          >
            <CircleDollarSign
              size={18}
            />

            {isRecording
              ? "Recording..."
              : "Record payment"}
          </button>
        </>
      }
    >
      <form
        id="record-bill-payment-form"
        className="email-invoice-form"
        onSubmit={handleSubmit}
      >
        <div className="bill-payment-modal-summary">
          <div><span>Bill total</span><strong>{formatCurrency(bill?.total, billCurrency)}</strong></div>
          <div><span>Already paid</span><strong>{formatCurrency(bill?.amountPaid, billCurrency)}</strong></div>
          <div><span>Remaining due</span><strong>{formatCurrency(outstanding, billCurrency)}</strong></div>
        </div>

        {errors.form && (
          <div className="invoice-form-alert">
            {errors.form}
          </div>
        )}

        {!hasCompatibleAccounts && (
          <div className="invoice-form-alert">
            No active{" "}
            {billCurrency} bank or
            cash account is available.
            Create a compatible account
            before recording this
            payment.
          </div>
        )}

        <div className="invoice-form-field">
          <label htmlFor="billPaymentAmount">
            Payment amount
          </label>

          <input
            id="billPaymentAmount"
            name="amount"
            type="number"
            min="0.01"
            max={Number(
              outstanding
            ).toFixed(2)}
            step="0.01"
            value={details.amount}
            onChange={handleChange}
          />

          {errors.amount && (
            <small className="form-error-message">
              {errors.amount}
            </small>
          )}
        </div>

        <div className="invoice-form-field">
          <label htmlFor="billPaymentDate">
            Payment date
          </label>

          <input
            id="billPaymentDate"
            name="paymentDate"
            type="date"
            value={
              details.paymentDate
            }
            onChange={handleChange}
          />

          {errors.paymentDate && (
            <small className="form-error-message">
              {errors.paymentDate}
            </small>
          )}
        </div>

        <div className="invoice-form-field">
          <label htmlFor="billPaymentBankAccount">
            Payment account
          </label>

          <select
            id="billPaymentBankAccount"
            name="bankAccountId"
            value={
              details.bankAccountId
            }
            onChange={handleChange}
            disabled={
              !hasCompatibleAccounts
            }
          >
            <option value="">
              Select payment account
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

        {selectedAccount && (
          <div className="bill-payment-balance">
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
        )}

        <div className="invoice-form-field">
          <label htmlFor="billPaymentMethod">
            Payment method
          </label>

          <select
            id="billPaymentMethod"
            name="paymentMethod"
            value={
              details.paymentMethod
            }
            onChange={handleChange}
          >
            <option value="Bank transfer">
              Bank transfer
            </option>

            <option value="Direct debit">
              Direct debit
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
          </select>

          {errors.paymentMethod && (
            <small className="form-error-message">
              {
                errors.paymentMethod
              }
            </small>
          )}
        </div>

        <div className="invoice-form-field">
          <label htmlFor="billPaymentReference">
            Reference
          </label>

          <input
            id="billPaymentReference"
            name="reference"
            value={
              details.reference
            }
            placeholder="Payment reference"
            onChange={handleChange}
          />
        </div>

        <div className="invoice-form-field">
          <label htmlFor="billPaymentNotes">
            Notes
          </label>

          <textarea
            id="billPaymentNotes"
            name="notes"
            rows="4"
            value={details.notes}
            placeholder="Optional payment notes"
            onChange={handleChange}
          />
        </div>
      </form>
    </Modal>
  );
}

export default RecordBillPaymentModal;
