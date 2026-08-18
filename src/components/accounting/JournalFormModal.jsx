import {
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getAccounts,
} from "../../services/accountService";

import {
  createJournal,
  getNextJournalNumber,
  postJournal,
  updateJournal,
} from "../../services/journalService";

const createLineId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
};

const createEmptyLine = () => ({
  id: createLineId(),
  accountId: "",
  description: "",
  debit: "",
  credit: "",
});

const getToday = () => {
  const date = new Date();

  const offset =
    date.getTimezoneOffset() *
    60 *
    1000;

  return new Date(
    date.getTime() - offset
  )
    .toISOString()
    .slice(0, 10);
};

const createInitialForm = () => ({
  journalNumber:
    getNextJournalNumber(),

  date: getToday(),
  reference: "",
  description: "",

  lines: [
    createEmptyLine(),
    createEmptyLine(),
  ],
});

const formatCurrency = (
  amount
) => {
  return new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency: "GBP",
    }
  ).format(Number(amount) || 0);
};

function JournalFormModal({
  isOpen,
  journal = null,
  onClose,
  onSaved,
}) {
  const [accounts, setAccounts] =
    useState([]);

  const [form, setForm] =
    useState(
      createInitialForm()
    );

  const [error, setError] =
    useState("");

  const [
    savingAction,
    setSavingAction,
  ] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const initialiseForm = window.requestAnimationFrame(() => {

    setAccounts(
      getAccounts({
        status: "Active",
      })
    );

    setError("");

    if (journal) {
      setForm({
        journalNumber:
          journal.journalNumber,

        date:
          journal.date,

        reference:
          journal.reference || "",

        description:
          journal.description || "",

        lines:
          journal.lines.map(
            (line) => ({
              ...line,

              debit:
                Number(
                  line.debit
                ) > 0
                  ? line.debit
                  : "",

              credit:
                Number(
                  line.credit
                ) > 0
                  ? line.credit
                  : "",
            })
          ),
      });

      return;
    }

    setForm(
      createInitialForm()
    );
    });
    return () => window.cancelAnimationFrame(initialiseForm);
  }, [isOpen, journal]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (
      event
    ) => {
      if (
        event.key === "Escape"
      ) {
        onClose();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [isOpen, onClose]);

  const totals = useMemo(() => {
    return form.lines.reduce(
      (summary, line) => {
        summary.debit +=
          Number(line.debit) || 0;

        summary.credit +=
          Number(line.credit) || 0;

        return summary;
      },
      {
        debit: 0,
        credit: 0,
      }
    );
  }, [form.lines]);

  const difference =
    Math.abs(
      totals.debit -
        totals.credit
    );

  const isBalanced =
    totals.debit > 0 &&
    difference <= 0.005;

  const handleFieldChange = (
    event
  ) => {
    const { name, value } =
      event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    setError("");
  };

  const handleLineChange = (
    lineId,
    field,
    value
  ) => {
    setForm((currentForm) => ({
      ...currentForm,

      lines:
        currentForm.lines.map(
          (line) => {
            if (
              line.id !== lineId
            ) {
              return line;
            }

            if (
              field === "debit"
            ) {
              return {
                ...line,
                debit: value,
                credit:
                  Number(value) > 0
                    ? ""
                    : line.credit,
              };
            }

            if (
              field === "credit"
            ) {
              return {
                ...line,
                credit: value,
                debit:
                  Number(value) > 0
                    ? ""
                    : line.debit,
              };
            }

            return {
              ...line,
              [field]: value,
            };
          }
        ),
    }));

    setError("");
  };

  const addLine = () => {
    setForm((currentForm) => ({
      ...currentForm,

      lines: [
        ...currentForm.lines,
        createEmptyLine(),
      ],
    }));
  };

  const removeLine = (
    lineId
  ) => {
    if (
      form.lines.length <= 2
    ) {
      return;
    }

    setForm((currentForm) => ({
      ...currentForm,

      lines:
        currentForm.lines.filter(
          (line) =>
            line.id !== lineId
        ),
    }));
  };

  const saveJournal = async (
    action
  ) => {
    setSavingAction(action);
    setError("");

    try {
      let savedJournal;

      if (journal) {
        savedJournal =
          updateJournal(
            journal.id,
            form
          );

        if (
          action === "post"
        ) {
          savedJournal =
            postJournal(
              savedJournal.id
            );
        }
      } else {
        savedJournal =
          createJournal(
            form,
            action === "post"
              ? "Posted"
              : "Draft"
          );
      }

      onSaved(savedJournal);
    } catch (saveError) {
      setError(
        saveError.message ||
          "The journal could not be saved."
      );
    } finally {
      setSavingAction("");
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="journal-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        className="journal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-modal-title"
      >
        <div className="journal-modal-header">
          <div>
            <span>
              Manual journal
            </span>

            <h2 id="journal-modal-title">
              {journal
                ? "Edit journal"
                : "New journal"}
            </h2>

            <p>
              Total debits must equal
              total credits before
              posting.
            </p>
          </div>

          <button
            type="button"
            className="journal-modal-close"
            onClick={onClose}
            aria-label="Close journal form"
          >
            <X size={20} />
          </button>
        </div>

        <div className="journal-form">
          {error && (
            <div className="journal-form-error">
              {error}
            </div>
          )}

          <div className="journal-details-grid">
            <div className="journal-form-field">
              <label htmlFor="journal-number">
                Journal number
              </label>

              <input
                id="journal-number"
                name="journalNumber"
                value={
                  form.journalNumber
                }
                onChange={
                  handleFieldChange
                }
              />
            </div>

            <div className="journal-form-field">
              <label htmlFor="journal-date">
                Journal date
              </label>

              <input
                id="journal-date"
                name="date"
                type="date"
                value={form.date}
                onChange={
                  handleFieldChange
                }
              />
            </div>

            <div className="journal-form-field">
              <label htmlFor="journal-reference">
                Reference
              </label>

              <input
                id="journal-reference"
                name="reference"
                value={
                  form.reference
                }
                onChange={
                  handleFieldChange
                }
                placeholder="Optional reference"
              />
            </div>

            <div className="journal-form-field journal-form-field-full">
              <label htmlFor="journal-description">
                Description
              </label>

              <input
                id="journal-description"
                name="description"
                value={
                  form.description
                }
                onChange={
                  handleFieldChange
                }
                placeholder="Explain the reason for this journal"
              />
            </div>
          </div>

          <div className="journal-lines-section">
            <div className="journal-lines-heading">
              <div>
                <h3>Journal lines</h3>

                <p>
                  Enter one debit and one
                  credit at minimum.
                </p>
              </div>

              <button
                type="button"
                className="invoice-secondary-button"
                onClick={addLine}
              >
                <Plus size={16} />
                Add line
              </button>
            </div>

            <div className="journal-lines-wrapper">
              <div className="journal-lines-header">
                <span>Account</span>
                <span>Description</span>
                <span>Debit</span>
                <span>Credit</span>
                <span />
              </div>

              {form.lines.map(
                (line) => (
                  <div
                    className="journal-line-row"
                    key={line.id}
                  >
                    <select
                      value={
                        line.accountId
                      }
                      onChange={(event) =>
                        handleLineChange(
                          line.id,
                          "accountId",
                          event.target
                            .value
                        )
                      }
                    >
                      <option value="">
                        Select account
                      </option>

                      {accounts.map(
                        (account) => (
                          <option
                            key={
                              account.id
                            }
                            value={
                              account.id
                            }
                          >
                            {account.code} –{" "}
                            {account.name}
                          </option>
                        )
                      )}
                    </select>

                    <input
                      value={
                        line.description
                      }
                      onChange={(event) =>
                        handleLineChange(
                          line.id,
                          "description",
                          event.target
                            .value
                        )
                      }
                      placeholder="Line description"
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        line.debit
                      }
                      onChange={(event) =>
                        handleLineChange(
                          line.id,
                          "debit",
                          event.target
                            .value
                        )
                      }
                      placeholder="0.00"
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        line.credit
                      }
                      onChange={(event) =>
                        handleLineChange(
                          line.id,
                          "credit",
                          event.target
                            .value
                        )
                      }
                      placeholder="0.00"
                    />

                    <button
                      type="button"
                      className="journal-remove-line"
                      disabled={
                        form.lines.length <=
                        2
                      }
                      onClick={() =>
                        removeLine(
                          line.id
                        )
                      }
                      aria-label="Remove journal line"
                    >
                      <Trash2
                        size={16}
                      />
                    </button>
                  </div>
                )
              )}
            </div>

            <div className="journal-totals">
              <div>
                <span>Total debits</span>

                <strong>
                  {formatCurrency(
                    totals.debit
                  )}
                </strong>
              </div>

              <div>
                <span>Total credits</span>

                <strong>
                  {formatCurrency(
                    totals.credit
                  )}
                </strong>
              </div>

              <div
                className={
                  isBalanced
                    ? "journal-balance-status journal-balanced"
                    : "journal-balance-status journal-unbalanced"
                }
              >
                <span>
                  {isBalanced
                    ? "Balanced"
                    : "Difference"}
                </span>

                <strong>
                  {formatCurrency(
                    difference
                  )}
                </strong>
              </div>
            </div>
          </div>

          <div className="journal-modal-actions">
            <button
              type="button"
              className="invoice-secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="button"
              className="invoice-save-draft-button"
              disabled={
                Boolean(
                  savingAction
                )
              }
              onClick={() =>
                saveJournal("draft")
              }
            >
              <Save size={17} />

              {savingAction ===
              "draft"
                ? "Saving..."
                : "Save draft"}
            </button>

            <button
              type="button"
              className="page-primary-button"
              disabled={
                Boolean(
                  savingAction
                ) || !isBalanced
              }
              onClick={() =>
                saveJournal("post")
              }
            >
              <Send size={17} />

              {savingAction ===
              "post"
                ? "Posting..."
                : "Post journal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default JournalFormModal;
