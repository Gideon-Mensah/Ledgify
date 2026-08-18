// Request deterministic matches and leave acceptance safeguards to the reconciliation backend.

const STORAGE_KEY =
  "ledgify_reconciliation_history";

// Gets stored history.
const getStoredHistory = () => {
  const storedHistory =
    localStorage.getItem(STORAGE_KEY);

  if (!storedHistory) {
    return [];
  }

  try {
    return JSON.parse(storedHistory);
  } catch {
    return [];
  }
};

// Saves history.
const saveHistory = (history) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(history)
  );

  return history;
};

// Gets reconciliation history.
export const getReconciliationHistory =
  (bankAccountId = "") => {
    const history =
      getStoredHistory();

    const filteredHistory =
      bankAccountId
        ? history.filter(
            (session) =>
              String(
                session.bankAccountId
              ) ===
              String(bankAccountId)
          )
        : history;

    return [...filteredHistory].sort(
      (firstSession, secondSession) =>
        new Date(
          secondSession.completedAt
        ) -
        new Date(
          firstSession.completedAt
        )
    );
  };

// Creates reconciliation session.
export const createReconciliationSession =
  ({
    bankAccountId,
    accountName,
    statementBalance,
    reconciledBalance,
    transactionCount,
    statementDate,
  }) => {
    if (!bankAccountId) {
      throw new Error(
        "Select a bank account."
      );
    }

    if (!statementDate) {
      throw new Error(
        "Select a statement date."
      );
    }

    const numericStatementBalance =
      Number(statementBalance);

    const numericReconciledBalance =
      Number(reconciledBalance);

    if (
      !Number.isFinite(
        numericStatementBalance
      )
    ) {
      throw new Error(
        "Enter a valid statement balance."
      );
    }

    const difference =
      numericStatementBalance -
      numericReconciledBalance;

    if (
      Math.abs(difference) > 0.005
    ) {
      throw new Error(
        "The reconciliation cannot be completed while there is a difference."
      );
    }

    const history =
      getStoredHistory();

    const session = {
      id: crypto.randomUUID(),
      bankAccountId,
      accountName:
        accountName ||
        "Bank account",
      statementDate,
      statementBalance:
        numericStatementBalance,
      reconciledBalance:
        numericReconciledBalance,
      difference: 0,
      transactionCount:
        Number(transactionCount) ||
        0,
      status: "Completed",
      completedAt:
        new Date().toISOString(),
    };

    saveHistory([
      session,
      ...history,
    ]);

    return session;
  };

// Deletes reconciliation session.
export const deleteReconciliationSession =
  (sessionId) => {
    const history =
      getStoredHistory();

    const session =
      history.find(
        (item) =>
          String(item.id) ===
          String(sessionId)
      );

    if (!session) {
      throw new Error(
        "Reconciliation session not found."
      );
    }

    saveHistory(
      history.filter(
        (item) =>
          String(item.id) !==
          String(sessionId)
      )
    );

    return session;
  };
