import {
  applyBankRule,
  findMatchingBankRule,
} from "./bankRuleServices";

import {
  getBankAccounts,
  updateBankAccount,
} from "./bankAccountService";

import {
  assertBankTransactionChangePeriodOpen,
  assertBankTransactionPeriodOpen,
} from "./periodLockGuards";

const STORAGE_KEY =
  "ledgify_bank_transactions";

const DEFAULT_TRANSACTIONS = [
  {
    id: "transaction-001",
    bankAccountId: "bank-001",
    date: "2026-07-24",
    description: "Stripe payout",
    reference: "STRIPE-2407",
    contact: "Stripe Payments UK",
    category: "Sales income",
    transactionType: "Money in",
    amount: 1250,
    status: "Unreconciled",
    source: "Bank feed",
    notes: "",
    vatRate: "0",
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "transaction-002",
    bankAccountId: "bank-001",
    date: "2026-07-23",
    description: "Office supplies",
    reference: "AMZ-4581",
    contact: "Amazon Business",
    category: "Office expenses",
    transactionType: "Money out",
    amount: 86.45,
    status: "Reconciled",
    source: "Bank feed",
    notes: "",
    vatRate: "20",
    reconciledAt:
      new Date().toISOString(),
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "transaction-003",
    bankAccountId: "bank-001",
    date: "2026-07-22",
    description: "Client payment",
    reference: "INV-0008",
    contact: "Northstar Solutions",
    category: "Accounts receivable",
    transactionType: "Money in",
    amount: 950,
    status: "Reconciled",
    source: "Manual",
    notes: "",
    vatRate: "0",
    reconciledAt:
      new Date().toISOString(),
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "transaction-004",
    bankAccountId: "bank-001",
    date: "2026-07-21",
    description: "HMRC payment",
    reference: "HMRC-VAT",
    contact:
      "HM Revenue & Customs",
    category: "VAT payable",
    transactionType: "Money out",
    amount: 420,
    status: "Unreconciled",
    source: "Bank feed",
    notes: "",
    vatRate: "0",
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "transaction-005",
    bankAccountId: "bank-002",
    date: "2026-07-20",
    description:
      "Transfer from current account",
    reference: "TRANSFER-001",
    contact: "",
    category: "Bank transfer",
    transactionType: "Money in",
    amount: 2500,
    status: "Reconciled",
    source: "Transfer",
    notes: "",
    vatRate: "0",
    reconciledAt:
      new Date().toISOString(),
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "transaction-006",
    bankAccountId: "bank-003",
    date: "2026-07-19",
    description: "Taxi fare",
    reference: "CASH-019",
    contact: "City Taxi",
    category: "Travel expenses",
    transactionType: "Money out",
    amount: 24.5,
    status: "Unreconciled",
    source: "Manual",
    notes: "",
    vatRate: "0",
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
];

/*
|--------------------------------------------------------------------------
| General helpers
|--------------------------------------------------------------------------
*/

const cloneData = (value) => {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
};

const createRecordId = () => {
  if (
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

const roundMoney = (amount) => {
  return (
    Math.round(
      ((Number(amount) || 0) +
        Number.EPSILON) *
        100
    ) / 100
  );
};

const normaliseText = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase();
};

const normaliseAmount = (amount) => {
  const parsedAmount =
    Number(amount);

  return Number.isFinite(
    parsedAmount
  )
    ? roundMoney(
        Math.abs(parsedAmount)
      )
    : 0;
};

const normaliseDate = (value) => {
  if (!value) {
    return "";
  }

  const text =
    String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return text;
  }

  const parsedDate =
    new Date(text);

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return "";
  }

  const year =
    parsedDate.getFullYear();

  const month =
    String(
      parsedDate.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      parsedDate.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const normaliseTransactionType = (
  transactionType
) => {
  const value =
    normaliseText(
      transactionType
    );

  if (
    [
      "money in",
      "income",
      "credit",
      "receipt",
    ].includes(value)
  ) {
    return "Money in";
  }

  if (
    [
      "money out",
      "expense",
      "debit",
      "payment",
    ].includes(value)
  ) {
    return "Money out";
  }

  return "";
};

const isInvoicePaymentTransaction = (
  transaction
) => {
  return Boolean(
    transaction?.invoiceId
  ) ||
    normaliseText(
      transaction?.source
    ) === "invoice payment";
};

const isBillPaymentTransaction = (
  transaction
) => {
  return Boolean(
    transaction?.billId
  ) ||
    normaliseText(
      transaction?.source
    ) === "bill payment";
};

const isLinkedPaymentTransaction = (
  transaction
) => {
  return (
    isInvoicePaymentTransaction(
      transaction
    ) ||
    isBillPaymentTransaction(
      transaction
    )
  );
};

const isTransferTransaction = (
  transaction
) => {
  return Boolean(
    transaction?.transferId
  ) ||
    [
      "bank transfer",
      "transfer",
    ].includes(
      normaliseText(
        transaction?.source
      )
    );
};

const transactionCanUseBankRules = (
  transaction
) => {
  return (
    !isTransferTransaction(
      transaction
    ) &&
    !isLinkedPaymentTransaction(
      transaction
    )
  );
};

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const saveTransactions = (
  transactions
) => {
  if (
    !Array.isArray(
      transactions
    )
  ) {
    throw new Error(
      "Bank transactions must be stored as an array."
    );
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      transactions
    )
  );

  return transactions;
};

const readStoredTransactions = () => {
  const storedTransactions =
    localStorage.getItem(
      STORAGE_KEY
    );

  if (!storedTransactions) {
    const initialTransactions =
      cloneData(
        DEFAULT_TRANSACTIONS
      );

    saveTransactions(
      initialTransactions
    );

    return initialTransactions;
  }

  try {
    const parsedTransactions =
      JSON.parse(
        storedTransactions
      );

    if (
      Array.isArray(
        parsedTransactions
      )
    ) {
      return parsedTransactions;
    }
  } catch (error) {
    console.error(
      "Unable to read bank transactions:",
      error
    );
  }

  const repairedTransactions =
    cloneData(
      DEFAULT_TRANSACTIONS
    );

  saveTransactions(
    repairedTransactions
  );

  return repairedTransactions;
};

/*
|--------------------------------------------------------------------------
| Bank-account helpers
|--------------------------------------------------------------------------
*/

const getAllBankAccounts = () => {
  const accounts =
    getBankAccounts(true);

  return Array.isArray(accounts)
    ? accounts
    : [];
};

const findBankAccount = (
  accountId,
  accounts = getAllBankAccounts()
) => {
  return (
    accounts.find(
      (account) =>
        String(account.id) ===
        String(accountId)
    ) || null
  );
};

const requireBankAccount = (
  accountId,
  accounts = getAllBankAccounts()
) => {
  if (!accountId) {
    throw new Error(
      "Select a bank account."
    );
  }

  const account =
    findBankAccount(
      accountId,
      accounts
    );

  if (!account) {
    throw new Error(
      "The selected bank account could not be found."
    );
  }

  return account;
};

const getTransactionMovement = (
  transaction
) => {
  const amount =
    normaliseAmount(
      transaction.amount
    );

  const transactionType =
    normaliseTransactionType(
      transaction.transactionType ||
        transaction.type
    );

  if (
    transactionType ===
    "Money in"
  ) {
    return amount;
  }

  if (
    transactionType ===
    "Money out"
  ) {
    return -amount;
  }

  return 0;
};

const buildAccountMovementMap = (
  transactions
) => {
  return transactions.reduce(
    (
      movementMap,
      transaction
    ) => {
      if (
        !transaction.bankAccountId
      ) {
        return movementMap;
      }

      const accountKey =
        String(
          transaction.bankAccountId
        );

      movementMap[accountKey] =
        roundMoney(
          (movementMap[
            accountKey
          ] || 0) +
            getTransactionMovement(
              transaction
            )
        );

      return movementMap;
    },
    {}
  );
};

export const synchroniseBankAccountBalances =
  (transactionList) => {
    const transactions =
      Array.isArray(
        transactionList
      )
        ? transactionList
        : readStoredTransactions();

    const accounts =
      getAllBankAccounts();

    const movementMap =
      buildAccountMovementMap(
        transactions
      );

    const updatedAccounts = [];

    accounts.forEach(
      (account) => {
        const accountKey =
          String(account.id);

        const movement =
          Number(
            movementMap[
              accountKey
            ]
          ) || 0;

        const openingBalance =
          Number(
            account.openingBalance
          ) || 0;

        const currentBalance =
          Number.isFinite(
            Number(
              account.currentBalance
            )
          )
            ? Number(
                account.currentBalance
              )
            : openingBalance;

        const storedBaseline =
          Number(
            account.transactionBalanceBaseline
          );

        const hasStoredBaseline =
          account.transactionBalanceBaseline !==
            undefined &&
          account.transactionBalanceBaseline !==
            null &&
          account.transactionBalanceBaseline !==
            "" &&
          Number.isFinite(
            storedBaseline
          );

        const storedOpeningBalance =
          Number(
            account.transactionBaselineOpeningBalance
          );

        const hasStoredOpeningBalance =
          account.transactionBaselineOpeningBalance !==
            undefined &&
          account.transactionBaselineOpeningBalance !==
            null &&
          account.transactionBaselineOpeningBalance !==
            "" &&
          Number.isFinite(
            storedOpeningBalance
          );

        let baseline =
          hasStoredBaseline
            ? storedBaseline
            : currentBalance -
              movement;

        if (
          hasStoredBaseline &&
          hasStoredOpeningBalance &&
          Math.abs(
            openingBalance -
              storedOpeningBalance
          ) > 0.005
        ) {
          baseline +=
            openingBalance -
            storedOpeningBalance;
        }

        baseline =
          roundMoney(
            baseline
          );

        const calculatedBalance =
          roundMoney(
            baseline +
              movement
          );

        const needsUpdate =
          !hasStoredBaseline ||
          !hasStoredOpeningBalance ||
          Math.abs(
            calculatedBalance -
              currentBalance
          ) > 0.005 ||
          Math.abs(
            openingBalance -
              storedOpeningBalance
          ) > 0.005;

        if (!needsUpdate) {
          return;
        }

        const updatedAccount =
          updateBankAccount(
            account.id,
            {
              currentBalance:
                calculatedBalance,

              transactionBalanceBaseline:
                baseline,

              transactionBaselineOpeningBalance:
                openingBalance,

              balanceLastCalculatedAt:
                new Date().toISOString(),
            }
          );

        updatedAccounts.push(
          updatedAccount
        );
      }
    );

    return updatedAccounts;
  };

export const syncBankAccountBalances =
  synchroniseBankAccountBalances;

const initialiseTransactions = () => {
  const transactions =
    readStoredTransactions();

  try {
    synchroniseBankAccountBalances(
      transactions
    );
  } catch (error) {
    console.error(
      "Bank-account balances could not be synchronised:",
      error
    );
  }

  return transactions;
};

const commitTransactions = (
  previousTransactions,
  nextTransactions
) => {
  saveTransactions(
    nextTransactions
  );

  try {
    synchroniseBankAccountBalances(
      nextTransactions
    );
  } catch (error) {
    saveTransactions(
      previousTransactions
    );

    try {
      synchroniseBankAccountBalances(
        previousTransactions
      );
    } catch (
      rollbackError
    ) {
      console.error(
        "Bank balance rollback failed:",
        rollbackError
      );
    }

    throw error;
  }

  return nextTransactions;
};

/*
|--------------------------------------------------------------------------
| Transaction validation
|--------------------------------------------------------------------------
*/

const cleanTransactionInput = (
  transactionData = {},
  existingTransaction = {}
) => {
  const bankAccountId =
    transactionData.bankAccountId !==
    undefined
      ? transactionData.bankAccountId
      : existingTransaction.bankAccountId;

  const date =
    transactionData.date !==
    undefined
      ? normaliseDate(
          transactionData.date
        )
      : normaliseDate(
          existingTransaction.date
        );

  const description =
    transactionData.description !==
    undefined
      ? String(
          transactionData.description ||
            ""
        ).trim()
      : String(
          existingTransaction.description ||
            ""
        ).trim();

  const transactionType =
    normaliseTransactionType(
      transactionData.transactionType !==
        undefined
        ? transactionData.transactionType
        : existingTransaction.transactionType
    );

  const amount =
    normaliseAmount(
      transactionData.amount !==
        undefined
        ? transactionData.amount
        : existingTransaction.amount
    );

  requireBankAccount(
    bankAccountId
  );

  if (!date) {
    throw new Error(
      "Select a valid transaction date."
    );
  }

  if (!description) {
    throw new Error(
      "Enter a transaction description."
    );
  }

  if (!transactionType) {
    throw new Error(
      "Select whether this is money in or money out."
    );
  }

  if (amount <= 0) {
    throw new Error(
      "Enter an amount greater than zero."
    );
  }

  return {
    ...cloneData(
      existingTransaction
    ),

    ...cloneData(
      transactionData
    ),

    bankAccountId,

    date,

    description,

    transactionType,

    amount,

    reference:
      transactionData.reference !==
      undefined
        ? String(
            transactionData.reference ||
              ""
          ).trim()
        : String(
            existingTransaction.reference ||
              ""
          ).trim(),

    contact:
      transactionData.contact !==
      undefined
        ? String(
            transactionData.contact ||
              ""
          ).trim()
        : String(
            existingTransaction.contact ||
              ""
          ).trim(),

    category:
      transactionData.category !==
      undefined
        ? transactionData.category ||
          "Uncategorised"
        : existingTransaction.category ||
          "Uncategorised",

    status:
      transactionData.status !==
      undefined
        ? transactionData.status ||
          "Unreconciled"
        : existingTransaction.status ||
          "Unreconciled",

    source:
      transactionData.source !==
      undefined
        ? transactionData.source ||
          "Manual"
        : existingTransaction.source ||
          "Manual",

    notes:
      transactionData.notes !==
      undefined
        ? String(
            transactionData.notes ||
              ""
          ).trim()
        : String(
            existingTransaction.notes ||
              ""
          ).trim(),

    vatRate:
      transactionData.vatRate !==
      undefined
        ? String(
            transactionData.vatRate ||
              "0"
          )
        : String(
            existingTransaction.vatRate ||
              "0"
          ),
  };
};

const applyRuleWhenEligible = (
  transaction
) => {
  if (
    !transactionCanUseBankRules(
      transaction
    )
  ) {
    return transaction;
  }

  const matchingRule =
    findMatchingBankRule(
      transaction
    );

  return matchingRule
    ? applyBankRule(
        transaction,
        matchingRule
      )
    : transaction;
};

/*
|--------------------------------------------------------------------------
| Read transactions
|--------------------------------------------------------------------------
*/

export const getBankTransactions = (
  {
    bankAccountId = "",
    status = "",
    transactionType = "",
    search = "",
    source = "",
  } = {}
) => {
  let transactions =
    initialiseTransactions();

  if (bankAccountId) {
    transactions =
      transactions.filter(
        (transaction) =>
          String(
            transaction.bankAccountId
          ) ===
          String(bankAccountId)
      );
  }

  if (status) {
    transactions =
      transactions.filter(
        (transaction) =>
          normaliseText(
            transaction.status
          ) ===
          normaliseText(status)
      );
  }

  if (transactionType) {
    const resolvedType =
      normaliseTransactionType(
        transactionType
      );

    transactions =
      transactions.filter(
        (transaction) =>
          normaliseTransactionType(
            transaction.transactionType
          ) === resolvedType
      );
  }

  if (source) {
    transactions =
      transactions.filter(
        (transaction) =>
          normaliseText(
            transaction.source
          ) ===
          normaliseText(source)
      );
  }

  const cleanedSearch =
    normaliseText(search);

  if (cleanedSearch) {
    transactions =
      transactions.filter(
        (transaction) =>
          [
            transaction.description,
            transaction.reference,
            transaction.contact,
            transaction.category,
            transaction.appliedRuleName,
            transaction.source,
            transaction.notes,
          ].some((value) =>
            normaliseText(
              value
            ).includes(
              cleanedSearch
            )
          )
      );
  }

  return [...transactions].sort(
    (
      firstTransaction,
      secondTransaction
    ) => {
      const dateComparison =
        String(
          secondTransaction.date ||
            ""
        ).localeCompare(
          String(
            firstTransaction.date ||
              ""
          )
        );

      if (
        dateComparison !== 0
      ) {
        return dateComparison;
      }

      return String(
        secondTransaction.createdAt ||
          ""
      ).localeCompare(
        String(
          firstTransaction.createdAt ||
            ""
        )
      );
    }
  );
};

export const getTransactions =
  getBankTransactions;

export const getTransactionById = (
  transactionId
) => {
  return (
    initialiseTransactions().find(
      (transaction) =>
        String(
          transaction.id
        ) ===
        String(transactionId)
    ) || null
  );
};

export const getUnreconciledTransactions =
  (bankAccountId = "") => {
    return getBankTransactions({
      bankAccountId,

      status: "Unreconciled",
    });
  };

export const getBankTransfers = () => {
  const transfers =
    new Map();

  initialiseTransactions()
    .filter(
      (transaction) =>
        transaction.transferId
    )
    .forEach(
      (transaction) => {
        const transferId =
          String(
            transaction.transferId
          );

        if (
          !transfers.has(
            transferId
          )
        ) {
          transfers.set(
            transferId,
            []
          );
        }

        transfers
          .get(transferId)
          .push(transaction);
      }
    );

  return Array.from(
    transfers.entries()
  ).map(
    ([
      transferId,
      transactions,
    ]) => ({
      transferId,

      transactions,

      moneyOutTransaction:
        transactions.find(
          (transaction) =>
            normaliseTransactionType(
              transaction.transactionType
            ) === "Money out"
        ) || null,

      moneyInTransaction:
        transactions.find(
          (transaction) =>
            normaliseTransactionType(
              transaction.transactionType
            ) === "Money in"
        ) || null,
    })
  );
};

/*
|--------------------------------------------------------------------------
| Create transaction
|--------------------------------------------------------------------------
*/

export const createBankTransaction = (
  transactionData,
  options = {}
) => {
  const transactions =
    initialiseTransactions();

  const timestamp =
    new Date().toISOString();

  const cleanedTransaction =
    cleanTransactionInput(
      transactionData
    );

  const baseTransaction = {
    ...cleanedTransaction,

    id:
      transactionData?.id ||
      createRecordId(),

    createdAt:
      transactionData?.createdAt ||
      timestamp,

    updatedAt: timestamp,
  };

  const transaction =
    applyRuleWhenEligible(
      baseTransaction
    );

  if (
    !options.skipPeriodLock
  ) {
    assertBankTransactionPeriodOpen(
      transaction,
      "create this bank transaction",
      options
    );
  }

  commitTransactions(
    transactions,
    [
      transaction,
      ...transactions,
    ]
  );

  return transaction;
};

/*
|--------------------------------------------------------------------------
| Statement import
|--------------------------------------------------------------------------
*/

const createDuplicateKey = (
  transaction
) => {
  return [
    transaction.bankAccountId,
    normaliseDate(
      transaction.date
    ),
    normaliseTransactionType(
      transaction.transactionType
    ),
    normaliseAmount(
      transaction.amount
    ).toFixed(2),
    normaliseText(
      transaction.description
    ),
    normaliseText(
      transaction.reference
    ),
  ].join("|");
};

export const importBankStatementTransactions =
  (
    statementTransactions = [],
    options = {}
  ) => {
    if (
      !Array.isArray(
        statementTransactions
      ) ||
      statementTransactions.length ===
        0
    ) {
      throw new Error(
        "Select at least one transaction to import."
      );
    }

    const existingTransactions =
      initialiseTransactions();

    const timestamp =
      new Date().toISOString();

    let duplicateCount = 0;

    let ruleAppliedCount = 0;

    const existingDuplicateKeys =
      new Set(
        existingTransactions.map(
          createDuplicateKey
        )
      );

    const importedTransactions =
      [];

    statementTransactions.forEach(
      (
        statementTransaction,
        index
      ) => {
        let cleanedTransaction;

        try {
          cleanedTransaction =
            cleanTransactionInput({
              ...statementTransaction,

              description:
                statementTransaction.description ||
                `Imported transaction ${
                  index + 1
                }`,

              status:
                "Unreconciled",

              source:
                "Statement import",
            });
        } catch (error) {
          throw new Error(
            `Statement row ${
              statementTransaction.rowNumber ||
              index + 1
            }: ${error.message}`,
            { cause: error }
          );
        }

        const duplicateKey =
          createDuplicateKey(
            cleanedTransaction
          );

        if (
          existingDuplicateKeys.has(
            duplicateKey
          )
        ) {
          duplicateCount += 1;
          return;
        }

        const baseTransaction = {
          ...cleanedTransaction,

          id:
            createRecordId(),

          statementRowNumber:
            statementTransaction.rowNumber ||
            null,

          createdAt:
            timestamp,

          updatedAt:
            timestamp,
        };

        const importedTransaction =
          applyRuleWhenEligible(
            baseTransaction
          );

        if (
          importedTransaction.appliedRuleId
        ) {
          ruleAppliedCount += 1;
        }

        if (
          !options.skipPeriodLock
        ) {
          try {
            assertBankTransactionPeriodOpen(
              importedTransaction,
              "import this bank transaction",
              options
            );
          } catch (error) {
            throw new Error(
              `Statement row ${
                statementTransaction.rowNumber ||
                index + 1
              }: ${error.message}`,
              { cause: error }
            );
          }
        }

        importedTransactions.push(
          importedTransaction
        );

        existingDuplicateKeys.add(
          duplicateKey
        );
      }
    );

    if (
      importedTransactions.length >
      0
    ) {
      commitTransactions(
        existingTransactions,
        [
          ...importedTransactions,
          ...existingTransactions,
        ]
      );
    }

    return {
      importedTransactions,

      importedCount:
        importedTransactions.length,

      duplicateCount,

      ruleAppliedCount,
    };
  };

export const importBankTransactions =
  importBankStatementTransactions;

/*
|--------------------------------------------------------------------------
| Bank transfers
|--------------------------------------------------------------------------
*/

export const createBankTransfer = (
  transferData,
  options = {}
) => {
  const {
    fromBankAccountId,
    toBankAccountId,
    date,
    amount,
    reference = "",
    notes = "",
  } = transferData || {};

  if (!fromBankAccountId) {
    throw new Error(
      "Select the account the money is leaving."
    );
  }

  if (!toBankAccountId) {
    throw new Error(
      "Select the account receiving the money."
    );
  }

  if (
    String(
      fromBankAccountId
    ) ===
    String(toBankAccountId)
  ) {
    throw new Error(
      "The source and destination accounts must be different."
    );
  }

  const resolvedDate =
    normaliseDate(date);

  if (!resolvedDate) {
    throw new Error(
      "Select a valid transfer date."
    );
  }

  const transferAmount =
    normaliseAmount(amount);

  if (
    transferAmount <= 0
  ) {
    throw new Error(
      "Enter a transfer amount greater than zero."
    );
  }

  const accounts =
    getAllBankAccounts();

  const fromAccount =
    requireBankAccount(
      fromBankAccountId,
      accounts
    );

  const toAccount =
    requireBankAccount(
      toBankAccountId,
      accounts
    );

  const fromCurrency =
    String(
      fromAccount.currency ||
        "GBP"
    ).toUpperCase();

  const toCurrency =
    String(
      toAccount.currency ||
        "GBP"
    ).toUpperCase();

  if (
    fromCurrency !==
    toCurrency
  ) {
    throw new Error(
      "Transfers between different currencies require an exchange-rate workflow and cannot be created here yet."
    );
  }

  const transactions =
    initialiseTransactions();

  const transferId =
    createRecordId();

  const moneyOutId =
    createRecordId();

  const moneyInId =
    createRecordId();

  const timestamp =
    new Date().toISOString();

  const transferReference =
    String(
      reference || ""
    ).trim() ||
    `TRF-${Date.now()
      .toString()
      .slice(-8)}`;

  const cleanedNotes =
    String(notes || "").trim();

  const moneyOutTransaction = {
    id: moneyOutId,

    bankAccountId:
      fromBankAccountId,

    date: resolvedDate,

    description:
      `Transfer to ${fromAccount.id === toAccount.id ? "bank account" : toAccount.accountName}`,

    reference:
      transferReference,

    contact: "",

    category:
      "Bank transfer",

    transactionType:
      "Money out",

    amount:
      transferAmount,

    status:
      "Reconciled",

    source:
      "Bank transfer",

    notes:
      cleanedNotes,

    vatRate: "0",

    transferId,

    linkedTransactionId:
      moneyInId,

    reconciledAt:
      timestamp,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,
  };

  const moneyInTransaction = {
    id: moneyInId,

    bankAccountId:
      toBankAccountId,

    date: resolvedDate,

    description:
      `Transfer from ${fromAccount.accountName}`,

    reference:
      transferReference,

    contact: "",

    category:
      "Bank transfer",

    transactionType:
      "Money in",

    amount:
      transferAmount,

    status:
      "Reconciled",

    source:
      "Bank transfer",

    notes:
      cleanedNotes,

    vatRate: "0",

    transferId,

    linkedTransactionId:
      moneyOutId,

    reconciledAt:
      timestamp,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,
  };

  if (
    !options.skipPeriodLock
  ) {
    assertBankTransactionPeriodOpen(
      moneyOutTransaction,
      "create this bank transfer",
      options
    );

    assertBankTransactionPeriodOpen(
      moneyInTransaction,
      "create this bank transfer",
      options
    );
  }

  commitTransactions(
    transactions,
    [
      moneyOutTransaction,
      moneyInTransaction,
      ...transactions,
    ]
  );

  return {
    transferId,

    moneyOutTransaction,

    moneyInTransaction,
  };
};

export const createTransfer =
  createBankTransfer;

export const deleteBankTransfer = (
  transferId,
  options = {}
) => {
  if (!transferId) {
    throw new Error(
      "Transfer ID is required."
    );
  }

  const transactions =
    initialiseTransactions();

  const transferTransactions =
    transactions.filter(
      (transaction) =>
        String(
          transaction.transferId
        ) ===
        String(transferId)
    );

  if (
    transferTransactions.length ===
    0
  ) {
    throw new Error(
      "Bank transfer not found."
    );
  }

  if (
    !options.skipPeriodLock
  ) {
    transferTransactions.forEach(
      (transaction) => {
        assertBankTransactionPeriodOpen(
          transaction,
          "delete this bank transfer",
          options
        );
      }
    );
  }

  const updatedTransactions =
    transactions.filter(
      (transaction) =>
        String(
          transaction.transferId
        ) !==
        String(transferId)
    );

  commitTransactions(
    transactions,
    updatedTransactions
  );

  return transferTransactions;
};

export const deleteTransfer =
  deleteBankTransfer;

/*
|--------------------------------------------------------------------------
| Update transaction
|--------------------------------------------------------------------------
*/

export const updateBankTransaction = (
  transactionId,
  changes,
  {
    allowLinkedPaymentUpdate =
      false,

    allowPeriodLockOverride =
      false,

    skipPeriodLock = false,
  } = {}
) => {
  const transactions =
    initialiseTransactions();

  const existingTransaction =
    transactions.find(
      (transaction) =>
        String(
          transaction.id
        ) ===
        String(transactionId)
    );

  if (
    !existingTransaction
  ) {
    throw new Error(
      "Bank transaction not found."
    );
  }

  if (
    existingTransaction.transferId
  ) {
    throw new Error(
      "This transaction belongs to a bank transfer and cannot be edited individually."
    );
  }

  if (
    isLinkedPaymentTransaction(
      existingTransaction
    ) &&
    !allowLinkedPaymentUpdate
  ) {
    throw new Error(
      isInvoicePaymentTransaction(
        existingTransaction
      )
        ? "This transaction is linked to an invoice payment. Update or reverse the payment from the invoice instead."
        : "This transaction is linked to a supplier payment. Update or reverse the payment from the bill instead."
    );
  }

  const cleanedTransaction =
    cleanTransactionInput(
      changes,
      existingTransaction
    );

  const updatedTransaction = {
    ...cleanedTransaction,

    id:
      existingTransaction.id,

    createdAt:
      existingTransaction.createdAt,

    updatedAt:
      new Date().toISOString(),
  };

  if (!skipPeriodLock) {
    assertBankTransactionChangePeriodOpen(
      existingTransaction,
      updatedTransaction,
      "edit this bank transaction",
      {
        allowPeriodLockOverride,
      }
    );
  }

  const updatedTransactions =
    transactions.map(
      (transaction) =>
        String(
          transaction.id
        ) ===
        String(transactionId)
          ? updatedTransaction
          : transaction
    );

  commitTransactions(
    transactions,
    updatedTransactions
  );

  return updatedTransaction;
};

/*
|--------------------------------------------------------------------------
| Delete transaction
|--------------------------------------------------------------------------
*/

export const deleteBankTransaction = (
  transactionId,
  {
    allowLinkedPaymentDeletion =
      false,

    allowPeriodLockOverride =
      false,

    skipPeriodLock = false,
  } = {}
) => {
  const transactions =
    initialiseTransactions();

  const transaction =
    transactions.find(
      (
        currentTransaction
      ) =>
        String(
          currentTransaction.id
        ) ===
        String(transactionId)
    );

  if (!transaction) {
    throw new Error(
      "Bank transaction not found."
    );
  }

  if (
    transaction.transferId
  ) {
    throw new Error(
      "This transaction belongs to a bank transfer. Delete the complete transfer instead."
    );
  }

  const isInvoicePayment =
    isInvoicePaymentTransaction(
      transaction
    );

  const isBillPayment =
    isBillPaymentTransaction(
      transaction
    );

  if (
    !allowLinkedPaymentDeletion &&
    isInvoicePayment
  ) {
    throw new Error(
      "This transaction is linked to an invoice payment. Reverse the payment from the invoice instead."
    );
  }

  if (
    !allowLinkedPaymentDeletion &&
    isBillPayment
  ) {
    throw new Error(
      "This transaction is linked to a supplier payment. Reverse the payment from the bill instead."
    );
  }

  if (!skipPeriodLock) {
    assertBankTransactionPeriodOpen(
      transaction,
      "delete this bank transaction",
      {
        allowPeriodLockOverride,
      }
    );
  }

  const updatedTransactions =
    transactions.filter(
      (
        currentTransaction
      ) =>
        String(
          currentTransaction.id
        ) !==
        String(transactionId)
    );

  commitTransactions(
    transactions,
    updatedTransactions
  );

  return transaction;
};

/*
|--------------------------------------------------------------------------
| Reconciliation
|--------------------------------------------------------------------------
*/

export const reconcileTransaction = (
  transactionId,
  options = {}
) => {
  const transaction =
    getTransactionById(
      transactionId
    );

  if (!transaction) {
    throw new Error(
      "Bank transaction not found."
    );
  }

  if (
    normaliseText(
      transaction.status
    ) === "reconciled"
  ) {
    return transaction;
  }

  if (
    !options.skipPeriodLock
  ) {
    assertBankTransactionPeriodOpen(
      transaction,
      "reconcile this bank transaction",
      options
    );
  }

  return updateBankTransaction(
    transactionId,
    {
      status:
        "Reconciled",

      reconciledAt:
        new Date().toISOString(),
    },
    {
      allowLinkedPaymentUpdate:
        true,

      allowPeriodLockOverride:
        Boolean(
          options.allowPeriodLockOverride
        ),

      skipPeriodLock:
        true,
    }
  );
};

export const unreconcileTransaction = (
  transactionId,
  options = {}
) => {
  const transaction =
    getTransactionById(
      transactionId
    );

  if (!transaction) {
    throw new Error(
      "Bank transaction not found."
    );
  }

  if (
    normaliseText(
      transaction.status
    ) === "unreconciled"
  ) {
    return transaction;
  }

  if (
    !options.skipPeriodLock
  ) {
    assertBankTransactionPeriodOpen(
      transaction,
      "unreconcile this bank transaction",
      options
    );
  }

  return updateBankTransaction(
    transactionId,
    {
      status:
        "Unreconciled",

      reconciledAt: null,
    },
    {
      allowLinkedPaymentUpdate:
        true,

      allowPeriodLockOverride:
        Boolean(
          options.allowPeriodLockOverride
        ),

      skipPeriodLock:
        true,
    }
  );
};

/*
|--------------------------------------------------------------------------
| Summaries
|--------------------------------------------------------------------------
*/

export const getTransactionSummary = (
  bankAccountId = ""
) => {
  const transactions =
    getBankTransactions({
      bankAccountId,
    });

  return transactions.reduce(
    (
      summary,
      transaction
    ) => {
      const amount =
        normaliseAmount(
          transaction.amount
        );

      const transactionType =
        normaliseTransactionType(
          transaction.transactionType
        );

      return {
        moneyIn:
          roundMoney(
            summary.moneyIn +
              (transactionType ===
              "Money in"
                ? amount
                : 0)
          ),

        moneyOut:
          roundMoney(
            summary.moneyOut +
              (transactionType ===
              "Money out"
                ? amount
                : 0)
          ),

        netMovement:
          roundMoney(
            summary.netMovement +
              getTransactionMovement(
                transaction
              )
          ),

        unreconciled:
          summary.unreconciled +
          (normaliseText(
            transaction.status
          ) === "unreconciled"
            ? 1
            : 0),

        reconciled:
          summary.reconciled +
          (normaliseText(
            transaction.status
          ) === "reconciled"
            ? 1
            : 0),

        total:
          summary.total + 1,
      };
    },
    {
      moneyIn: 0,

      moneyOut: 0,

      netMovement: 0,

      unreconciled: 0,

      reconciled: 0,

      total: 0,
    }
  );
};

export const getBankTransactionSummary =
  getTransactionSummary;

/*
|--------------------------------------------------------------------------
| Bank rules
|--------------------------------------------------------------------------
*/

export const runBankRules = (
  {
    bankAccountId = "",

    unreconciledOnly =
      true,

    allowPeriodLockOverride =
      false,
  } = {}
) => {
  const transactions =
    initialiseTransactions();

  let matchedCount = 0;

  let skippedCount = 0;

  let alreadyAppliedCount =
    0;

  let protectedCount = 0;

  let lockedCount = 0;

  const updatedTransactions =
    transactions.map(
      (transaction) => {
        const accountMatches =
          !bankAccountId ||
          String(
            transaction.bankAccountId
          ) ===
            String(bankAccountId);

        if (!accountMatches) {
          return transaction;
        }

        if (
          unreconciledOnly &&
          normaliseText(
            transaction.status
          ) === "reconciled"
        ) {
          skippedCount += 1;
          return transaction;
        }

        if (
          !transactionCanUseBankRules(
            transaction
          )
        ) {
          protectedCount += 1;
          return transaction;
        }

        if (
          transaction.appliedRuleId
        ) {
          alreadyAppliedCount +=
            1;

          return transaction;
        }

        const matchingRule =
          findMatchingBankRule(
            transaction
          );

        if (!matchingRule) {
          skippedCount += 1;
          return transaction;
        }

        try {
          assertBankTransactionPeriodOpen(
            transaction,
            "apply a bank rule to this transaction",
            {
              allowPeriodLockOverride,
            }
          );
        } catch {
          lockedCount += 1;
          return transaction;
        }

        matchedCount += 1;

        return {
          ...applyBankRule(
            transaction,
            matchingRule
          ),

          updatedAt:
            new Date().toISOString(),
        };
      }
    );

  if (matchedCount > 0) {
    commitTransactions(
      transactions,
      updatedTransactions
    );
  }

  const eligibleTransactions =
    transactions.filter(
      (transaction) =>
        !bankAccountId ||
        String(
          transaction.bankAccountId
        ) ===
          String(bankAccountId)
    );

  return {
    totalTransactions:
      eligibleTransactions.length,

    matchedCount,

    skippedCount,

    alreadyAppliedCount,

    protectedCount,

    lockedCount,
  };
};

/*
|--------------------------------------------------------------------------
| Development reset
|--------------------------------------------------------------------------
*/

export const resetBankTransactions =
  () => {
    const previousTransactions =
      readStoredTransactions();

    const initialTransactions =
      cloneData(
        DEFAULT_TRANSACTIONS
      );

    commitTransactions(
      previousTransactions,
      initialTransactions
    );

    return initialTransactions;
  };
