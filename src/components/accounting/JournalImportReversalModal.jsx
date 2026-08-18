import {
  useMemo,
  useState,
} from "react";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  RotateCcw,
  X,
} from "lucide-react";

import {
  Link,
} from "react-router-dom";

import {
  reverseJournalImportBatch,
} from "../../services/journalImportService";

import "../../styles/journalImportReversalModal.css";

const getToday = () =>
  new Date()
    .toISOString()
    .slice(0, 10);

const normaliseText = (
  value
) =>
  String(value || "")
    .trim()
    .toLowerCase();

const formatCurrency = (
  amount
) =>
  new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency: "GBP",
    }
  ).format(
    Number(amount) || 0
  );

const JournalImportReversalModal = ({
  batch,
  onClose,
  onCompleted,
}) => {
  const [
    reversalDate,
    setReversalDate,
  ] = useState(
    getToday()
  );

  const [
    reason,
    setReason,
  ] = useState("");

  const [
    processing,
    setProcessing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    result,
    setResult,
  ] = useState(null);

  const batchSummary =
    useMemo(() => {
      const journals =
        Array.isArray(
          batch?.journals
        )
          ? batch.journals
          : [];

      const postedJournals =
        journals.filter(
          (journal) =>
            Boolean(
              journal.journalId
            )
        );

      const activeJournals =
        postedJournals.filter(
          (journal) =>
            normaliseText(
              journal.status
            ) !== "reversed"
        );

      const reversedJournals =
        postedJournals.filter(
          (journal) =>
            normaliseText(
              journal.status
            ) === "reversed"
        );

      return {
        postedJournals:
          postedJournals.length,

        activeJournals:
          activeJournals.length,

        reversedJournals:
          reversedJournals.length,
      };
    }, [batch]);

  const handleClose = () => {
    if (processing) {
      return;
    }

    if (
      typeof onClose ===
      "function"
    ) {
      onClose();
    }
  };

  const handleSubmit = (
    event
  ) => {
    event.preventDefault();

    try {
      setProcessing(true);
      setError("");

      const reversalResult =
        reverseJournalImportBatch(
          batch.id,
          reason,
          {
            reversalDate,
          }
        );

      setResult(
        reversalResult
      );

      if (
        typeof onCompleted ===
        "function"
      ) {
        onCompleted(
          reversalResult
        );
      }
    } catch (
      reversalError
    ) {
      setError(
        reversalError.message ||
          "The journal import batch could not be reversed."
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div
      className="journal-import-reversal-overlay"
      role="presentation"
      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          handleClose();
        }
      }}
    >
      <section
        className="journal-import-reversal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-import-reversal-title"
      >
        <div className="journal-import-reversal-header">
          <div>
            <span>
              Import batch reversal
            </span>

            <h2 id="journal-import-reversal-title">
              {result
                ? "Reversal Results"
                : "Reverse Journal Import Batch"}
            </h2>

            <p>
              {batch.fileName}
            </p>
          </div>

          <button
            type="button"
            onClick={
              handleClose
            }
            disabled={
              processing
            }
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {!result ? (
          <form
            onSubmit={
              handleSubmit
            }
          >
            <div className="journal-import-reversal-body">
              <div className="journal-import-reversal-warning">
                <AlertTriangle
                  size={21}
                />

                <div>
                  <strong>
                    This creates separate
                    reversal journals
                  </strong>

                  <p>
                    Every active journal in
                    this import batch will be
                    reversed. The original
                    journals remain available
                    in the General Ledger and
                    Audit Trail.
                  </p>
                </div>
              </div>

              {error && (
                <div className="journal-import-reversal-message is-error">
                  <AlertTriangle
                    size={18}
                  />

                  <span>
                    {error}
                  </span>
                </div>
              )}

              <div className="journal-import-reversal-summary">
                <div>
                  <span>
                    Posted journals
                  </span>

                  <strong>
                    {
                      batchSummary.postedJournals
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Active journals
                  </span>

                  <strong>
                    {
                      batchSummary.activeJournals
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Already reversed
                  </span>

                  <strong>
                    {
                      batchSummary.reversedJournals
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Batch value
                  </span>

                  <strong>
                    {formatCurrency(
                      batch.totalDebit
                    )}
                  </strong>
                </div>
              </div>

              <label className="journal-import-reversal-field">
                <span>
                  Reversal date
                </span>

                <input
                  type="date"
                  value={
                    reversalDate
                  }
                  onChange={(
                    event
                  ) =>
                    setReversalDate(
                      event.target.value
                    )
                  }
                  required
                />
              </label>

              <label className="journal-import-reversal-field">
                <span>
                  Reversal reason
                </span>

                <textarea
                  value={reason}
                  onChange={(
                    event
                  ) => {
                    setReason(
                      event.target.value
                    );

                    setError("");
                  }}
                  rows="4"
                  placeholder="Explain why this journal import batch is being reversed."
                  required
                />
              </label>
            </div>

            <div className="journal-import-reversal-footer">
              <button
                type="button"
                className="journal-import-reversal-cancel"
                onClick={
                  handleClose
                }
                disabled={
                  processing
                }
              >
                Cancel
              </button>

              <button
                type="submit"
                className="journal-import-reversal-confirm"
                disabled={
                  processing ||
                  batchSummary.activeJournals ===
                    0
                }
              >
                <RotateCcw
                  size={17}
                />

                {processing
                  ? "Reversing..."
                  : `Reverse ${batchSummary.activeJournals} journal${
                      batchSummary.activeJournals ===
                      1
                        ? ""
                        : "s"
                    }`}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="journal-import-reversal-body">
              <div
                className={`journal-import-reversal-message ${
                  result.fullyReversed
                    ? "is-success"
                    : "is-warning"
                }`}
              >
                {result.fullyReversed ? (
                  <CheckCircle2
                    size={19}
                  />
                ) : (
                  <AlertTriangle
                    size={19}
                  />
                )}

                <span>
                  {result.message}
                </span>
              </div>

              <div className="journal-import-reversal-result-summary">
                <div>
                  <span>
                    Reversed
                  </span>

                  <strong>
                    {
                      result.reversedJournals
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Failed
                  </span>

                  <strong>
                    {
                      result.failedJournals
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Total journals
                  </span>

                  <strong>
                    {
                      result.totalJournals
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Batch status
                  </span>

                  <strong>
                    {
                      result.batch.status
                    }
                  </strong>
                </div>
              </div>

              {result.results.length >
                0 && (
                <section className="journal-import-reversal-results-panel">
                  <div className="journal-import-reversal-section-heading">
                    <h3>
                      Created reversal journals
                    </h3>

                    <span>
                      {
                        result.results.length
                      }{" "}
                      successful
                    </span>
                  </div>

                  <div className="journal-import-reversal-table-wrapper">
                    <table className="journal-import-reversal-table">
                      <thead>
                        <tr>
                          <th>
                            Imported journal
                          </th>

                          <th>
                            Original
                          </th>

                          <th>
                            Reversal
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {result.results.map(
                          (
                            reversal
                          ) => (
                            <tr
                              key={
                                reversal.importJournalId
                              }
                            >
                              <td>
                                <strong>
                                  {
                                    reversal.journalKey
                                  }
                                </strong>
                              </td>

                              <td>
                                <Link
                                  to={`/accounting/journals/${reversal.originalJournalId}`}
                                >
                                  <FileText
                                    size={15}
                                  />

                                  {reversal.originalJournalNumber ||
                                    "View original"}
                                </Link>
                              </td>

                              <td>
                                <Link
                                  to={`/accounting/journals/${reversal.reversalJournalId}`}
                                >
                                  <RotateCcw
                                    size={15}
                                  />

                                  {reversal.reversalJournalNumber ||
                                    "View reversal"}
                                </Link>
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {result.errors.length >
                0 && (
                <section className="journal-import-reversal-errors-panel">
                  <div className="journal-import-reversal-section-heading">
                    <h3>
                      Journals not reversed
                    </h3>

                    <span>
                      {
                        result.errors.length
                      }{" "}
                      failed
                    </span>
                  </div>

                  <div className="journal-import-reversal-error-list">
                    {result.errors.map(
                      (
                        reversalError
                      ) => (
                        <div
                          key={
                            reversalError.importJournalId
                          }
                        >
                          <AlertTriangle
                            size={17}
                          />

                          <div>
                            <strong>
                              {
                                reversalError.journalKey
                              }
                            </strong>

                            <span>
                              {
                                reversalError.message
                              }
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </section>
              )}
            </div>

            <div className="journal-import-reversal-footer">
              <button
                type="button"
                className="journal-import-reversal-close"
                onClick={
                  handleClose
                }
              >
                Close results
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default JournalImportReversalModal;