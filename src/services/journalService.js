import {
  journals as defaultJournals,
} from "../data/journals";

import {
  applyAccountBalanceChanges,
  getAccounts,
} from "./accountService";

import {
  assertManualJournalChangePeriodOpen,
  assertManualJournalPeriodOpen,
} from "./periodLockGuards";

const STORAGE_KEY =
  "ledgify_journals";

const BALANCE_TOLERANCE =
  0.005;

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

const roundMoney = (value) => {
  return (
    Math.round(
      ((Number(value) || 0) +
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

  const displayDateMatch =
    text.match(
      /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
    );

  if (displayDateMatch) {
    const months = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };

    const month =
      months[
        displayDateMatch[2]
          .toLowerCase()
      ];

    if (month) {
      return `${displayDateMatch[3]}-${month}-${String(
        displayDateMatch[1]
      ).padStart(2, "0")}`;
    }
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

const normaliseStatus = (status) => {
  const value =
    normaliseText(status);

  if (value === "posted") {
    return "Posted";
  }

  if (value === "reversed") {
    return "Reversed";
  }

  return "Draft";
};

const isSystemJournal = (
  journal
) => {
  return Boolean(
    journal?.isSystem ||
      journal?.sourceType
  );
};

const isReversalJournal = (
  journal
) => {
  return Boolean(
    journal?.originalJournalId ||
      journal?.isReversal
  );
};

const getJournalDate = (
  journal
) => {
  return normaliseDate(
    journal?.date ||
      journal?.journalDate ||
      journal?.postedAt ||
      journal?.createdAt
  );
};

const getJournalNumber = (
  journal
) => {
  return (
    journal?.journalNumber ||
    journal?.reference ||
    journal?.sourceNumber ||
    ""
  );
};

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const initialiseJournals = () => {
  const storedJournals =
    localStorage.getItem(
      STORAGE_KEY
    );

  if (storedJournals) {
    try {
      const parsedJournals =
        JSON.parse(
          storedJournals
        );

      if (
        Array.isArray(
          parsedJournals
        )
      ) {
        return parsedJournals;
      }
    } catch (error) {
      console.error(
        "Unable to read saved journals:",
        error
      );
    }
  }

  const initialJournals =
    cloneData(
      defaultJournals || []
    );

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      initialJournals
    )
  );

  return initialJournals;
};

export const saveJournals = (
  journals
) => {
  if (
    !Array.isArray(journals)
  ) {
    throw new Error(
      "Journals must be stored as an array."
    );
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(journals)
  );

  return journals;
};

/*
|--------------------------------------------------------------------------
| Account and line helpers
|--------------------------------------------------------------------------
*/

const getAllAccounts = () => {
  const accounts =
    getAccounts({
      status: "All",
    });

  return Array.isArray(accounts)
    ? accounts
    : [];
};

const findLineAccount = (
  line,
  accounts
) => {
  const accountId =
    line?.accountId ??
    line?.account?.id ??
    null;

  if (
    accountId !== null &&
    accountId !== undefined &&
    accountId !== ""
  ) {
    const accountById =
      accounts.find(
        (account) =>
          String(account.id) ===
          String(accountId)
      );

    if (accountById) {
      return accountById;
    }
  }

  const accountCode =
    String(
      line?.accountCode ||
        line?.account?.code ||
        ""
    ).trim();

  if (accountCode) {
    return (
      accounts.find(
        (account) =>
          String(account.code) ===
          accountCode
      ) || null
    );
  }

  return null;
};

const cleanJournalLine = (
  line,
  index,
  accounts
) => {
  const account =
    findLineAccount(
      line,
      accounts
    );

  if (!account) {
    throw new Error(
      `Select a valid account for journal line ${
        index + 1
      }.`
    );
  }

  const debit =
    roundMoney(
      line?.debit
    );

  const credit =
    roundMoney(
      line?.credit
    );

  if (
    debit < 0 ||
    credit < 0
  ) {
    throw new Error(
      `Journal line ${
        index + 1
      } cannot contain a negative debit or credit.`
    );
  }

  if (
    debit > BALANCE_TOLERANCE &&
    credit > BALANCE_TOLERANCE
  ) {
    throw new Error(
      `Journal line ${
        index + 1
      } cannot contain both a debit and a credit.`
    );
  }

  if (
    debit <= BALANCE_TOLERANCE &&
    credit <= BALANCE_TOLERANCE
  ) {
    throw new Error(
      `Enter a debit or credit amount for journal line ${
        index + 1
      }.`
    );
  }

  return {
    ...cloneData(
      line || {}
    ),

    id:
      line?.id ||
      createRecordId(),

    accountId:
      account.id,

    accountCode:
      account.code,

    accountName:
      account.name,

    description:
      String(
        line?.description ||
          ""
      ).trim(),

    debit,

    credit,
  };
};

export const calculateJournalTotals = (
  lines = []
) => {
  const resolvedLines =
    Array.isArray(lines)
      ? lines
      : [];

  return resolvedLines.reduce(
    (totals, line) => ({
      debit:
        roundMoney(
          totals.debit +
            (Number(
              line?.debit
            ) || 0)
        ),

      credit:
        roundMoney(
          totals.credit +
            (Number(
              line?.credit
            ) || 0)
        ),
    }),
    {
      debit: 0,
      credit: 0,
    }
  );
};

export const validateJournalLines = (
  lines
) => {
  if (
    !Array.isArray(lines) ||
    lines.length < 2
  ) {
    throw new Error(
      "A journal must contain at least two lines."
    );
  }

  const accounts =
    getAllAccounts();

  const cleanedLines =
    lines.map(
      (line, index) =>
        cleanJournalLine(
          line,
          index,
          accounts
        )
    );

  const totals =
    calculateJournalTotals(
      cleanedLines
    );

  if (
    totals.debit <=
      BALANCE_TOLERANCE ||
    totals.credit <=
      BALANCE_TOLERANCE
  ) {
    throw new Error(
      "The journal must contain at least one debit and one credit."
    );
  }

  if (
    Math.abs(
      totals.debit -
        totals.credit
    ) >
    BALANCE_TOLERANCE
  ) {
    throw new Error(
      `The journal is not balanced. Debits are ${totals.debit.toFixed(
        2
      )} and credits are ${totals.credit.toFixed(
        2
      )}.`
    );
  }

  return {
    lines:
      cleanedLines,

    totalDebit:
      totals.debit,

    totalCredit:
      totals.credit,
  };
};

const cleanJournalInput = (
  journalData = {},
  existingJournal = {}
) => {
  const date =
    journalData.date !==
    undefined
      ? normaliseDate(
          journalData.date
        )
      : getJournalDate(
          existingJournal
        );

  if (!date) {
    throw new Error(
      "Select a valid journal date."
    );
  }

  const description =
    journalData.description !==
    undefined
      ? String(
          journalData.description ||
            ""
        ).trim()
      : String(
          existingJournal.description ||
            ""
        ).trim();

  if (!description) {
    throw new Error(
      "Enter a journal description."
    );
  }

  const lines =
    journalData.lines !==
    undefined
      ? journalData.lines
      : existingJournal.lines;

  const validation =
    validateJournalLines(
      lines
    );

  return {
    ...cloneData(
      existingJournal
    ),

    ...cloneData(
      journalData
    ),

    date,

    journalDate: date,

    description,

    reference:
      journalData.reference !==
      undefined
        ? String(
            journalData.reference ||
              ""
          ).trim()
        : String(
            existingJournal.reference ||
              ""
          ).trim(),

    notes:
      journalData.notes !==
      undefined
        ? String(
            journalData.notes ||
              ""
          ).trim()
        : String(
            existingJournal.notes ||
              ""
          ).trim(),

    lines:
      validation.lines,

    totalDebit:
      validation.totalDebit,

    totalCredit:
      validation.totalCredit,
  };
};

/*
|--------------------------------------------------------------------------
| Account balance updates
|--------------------------------------------------------------------------
*/

const buildAccountBalanceChanges = (
  lines,
  {
    reverse = false,
  } = {}
) => {
  return lines.map((line) => ({
    accountId:
      line.accountId,

    accountCode:
      line.accountCode,

    debit:
      reverse
        ? roundMoney(
            line.credit
          )
        : roundMoney(
            line.debit
          ),

    credit:
      reverse
        ? roundMoney(
            line.debit
          )
        : roundMoney(
            line.credit
          ),
  }));
};

const applyJournalBalanceImpact = (
  journal,
  {
    reverse = false,
  } = {}
) => {
  const lines =
    Array.isArray(
      journal?.lines
    )
      ? journal.lines
      : [];

  if (
    lines.length === 0
  ) {
    return [];
  }

  const changes =
    buildAccountBalanceChanges(
      lines,
      {
        reverse,
      }
    );

  applyAccountBalanceChanges(
    changes
  );

  return changes;
};

const commitPostedJournal = (
  previousJournals,
  nextJournals,
  journal
) => {
  let balanceApplied =
    false;

  try {
    applyJournalBalanceImpact(
      journal
    );

    balanceApplied =
      true;

    saveJournals(
      nextJournals
    );

    return journal;
  } catch (error) {
    if (balanceApplied) {
      try {
        applyJournalBalanceImpact(
          journal,
          {
            reverse: true,
          }
        );
      } catch (
        rollbackError
      ) {
        console.error(
          "Journal balance rollback failed:",
          rollbackError
        );
      }
    }

    try {
      saveJournals(
        previousJournals
      );
    } catch (
      storageRollbackError
    ) {
      console.error(
        "Journal storage rollback failed:",
        storageRollbackError
      );
    }

    throw error;
  }
};

/*
|--------------------------------------------------------------------------
| Journal numbering
|--------------------------------------------------------------------------
*/

const calculateNextJournalNumber = (
  journals
) => {
  const highestNumber =
    journals.reduce(
      (highest, journal) => {
        const numericPart =
          Number(
            String(
              getJournalNumber(
                journal
              )
            ).replace(
              /\D/g,
              ""
            )
          );

        if (
          !Number.isFinite(
            numericPart
          )
        ) {
          return highest;
        }

        return Math.max(
          highest,
          numericPart
        );
      },
      0
    );

  return `JRN-${String(
    highestNumber + 1
  ).padStart(4, "0")}`;
};

export const getNextJournalNumber =
  () => {
    return calculateNextJournalNumber(
      initialiseJournals()
    );
  };

/*
|--------------------------------------------------------------------------
| Read journals
|--------------------------------------------------------------------------
*/

export const getJournals = (
  {
    status = "",
    sourceType = "",
    search = "",
    fromDate = "",
    toDate = "",
  } = {}
) => {
  let journals =
    initialiseJournals();

  const resolvedFromDate =
    normaliseDate(
      fromDate
    );

  const resolvedToDate =
    normaliseDate(
      toDate
    );

  if (status) {
    journals =
      journals.filter(
        (journal) =>
          normaliseText(
            journal.status
          ) ===
          normaliseText(
            status
          )
      );
  }

  if (sourceType) {
    journals =
      journals.filter(
        (journal) =>
          normaliseText(
            journal.sourceType
          ) ===
          normaliseText(
            sourceType
          )
      );
  }

  if (resolvedFromDate) {
    journals =
      journals.filter(
        (journal) =>
          getJournalDate(
            journal
          ) >=
          resolvedFromDate
      );
  }

  if (resolvedToDate) {
    journals =
      journals.filter(
        (journal) =>
          getJournalDate(
            journal
          ) <=
          resolvedToDate
      );
  }

  const searchValue =
    normaliseText(search);

  if (searchValue) {
    journals =
      journals.filter(
        (journal) =>
          [
            journal.journalNumber,
            journal.reference,
            journal.description,
            journal.sourceType,
            journal.sourceNumber,
            journal.sourceAction,
            journal.createdBy,
          ].some((value) =>
            normaliseText(
              value
            ).includes(
              searchValue
            )
          )
      );
  }

  return [...journals].sort(
    (first, second) => {
      const dateComparison =
        String(
          getJournalDate(
            second
          )
        ).localeCompare(
          String(
            getJournalDate(
              first
            )
          )
        );

      if (
        dateComparison !== 0
      ) {
        return dateComparison;
      }

      return String(
        second.createdAt ||
          ""
      ).localeCompare(
        String(
          first.createdAt ||
            ""
        )
      );
    }
  );
};

export const getJournalById = (
  journalId
) => {
  return (
    initialiseJournals().find(
      (journal) =>
        String(journal.id) ===
        String(journalId)
    ) || null
  );
};

export const getJournalSummary =
  () => {
    const journals =
      initialiseJournals();

    return {
      total:
        journals.length,

      draft:
        journals.filter(
          (journal) =>
            normaliseStatus(
              journal.status
            ) === "Draft"
        ).length,

      posted:
        journals.filter(
          (journal) =>
            normaliseStatus(
              journal.status
            ) === "Posted"
        ).length,

      reversed:
        journals.filter(
          (journal) =>
            normaliseStatus(
              journal.status
            ) === "Reversed"
        ).length,

      system:
        journals.filter(
          isSystemJournal
        ).length,

      manual:
        journals.filter(
          (journal) =>
            !isSystemJournal(
              journal
            )
        ).length,
    };
  };

/*
|--------------------------------------------------------------------------
| Create manual journal
|--------------------------------------------------------------------------
*/

export const createJournal = (
  journalData,
  options = {}
) => {
  if (
    !journalData ||
    typeof journalData !==
      "object"
  ) {
    throw new Error(
      "Journal data is required."
    );
  }

  const journals =
    initialiseJournals();

  const now =
    new Date().toISOString();

  const cleanedJournal =
    cleanJournalInput(
      journalData
    );

  const requestedStatus =
    normaliseStatus(
      journalData.status
    );

  const newJournal = {
    ...cleanedJournal,

    id:
      journalData.id ||
      createRecordId(),

    journalNumber:
      journalData.journalNumber ||
      journalData.reference ||
      calculateNextJournalNumber(
        journals
      ),

    reference:
      journalData.reference ||
      journalData.journalNumber ||
      calculateNextJournalNumber(
        journals
      ),

    status:
      requestedStatus,

    isSystem: false,

    sourceType: "",

    sourceId: null,

    sourceNumber: "",

    sourceAction: "",

    originalJournalId: null,

    reversalJournalId: null,

    isReversal: false,

    createdBy:
      journalData.createdBy ||
      "Current user",

    createdAt:
      journalData.createdAt ||
      now,

    updatedAt: now,

    postedAt:
      requestedStatus ===
      "Posted"
        ? now
        : null,

    reversedAt: null,

    reversalReason: "",
  };

  if (
    !options.skipPeriodLock
  ) {
    assertManualJournalPeriodOpen(
      newJournal,
      requestedStatus ===
        "Posted"
        ? "create and post this manual journal"
        : "create this manual journal",
      options
    );
  }

  if (
    requestedStatus ===
    "Posted"
  ) {
    return commitPostedJournal(
      journals,
      [
        newJournal,
        ...journals,
      ],
      newJournal
    );
  }

  saveJournals([
    newJournal,
    ...journals,
  ]);

  return newJournal;
};

/*
|--------------------------------------------------------------------------
| Update manual journal
|--------------------------------------------------------------------------
*/

export const updateJournal = (
  journalId,
  updates,
  options = {}
) => {
  const journals =
    initialiseJournals();

  const existingJournal =
    journals.find(
      (journal) =>
        String(journal.id) ===
        String(journalId)
    );

  if (!existingJournal) {
    throw new Error(
      "Journal not found."
    );
  }

  if (
    isSystemJournal(
      existingJournal
    )
  ) {
    throw new Error(
      "System-generated journals cannot be edited manually."
    );
  }

  if (
    normaliseStatus(
      existingJournal.status
    ) !== "Draft"
  ) {
    throw new Error(
      "Only draft journals can be edited."
    );
  }

  const cleanedJournal =
    cleanJournalInput(
      updates,
      existingJournal
    );

  const updatedJournal = {
    ...existingJournal,

    ...cleanedJournal,

    id:
      existingJournal.id,

    journalNumber:
      existingJournal.journalNumber,

    reference:
      updates?.reference !==
      undefined
        ? String(
            updates.reference ||
              ""
          ).trim()
        : existingJournal.reference,

    status: "Draft",

    createdAt:
      existingJournal.createdAt,

    updatedAt:
      new Date().toISOString(),
  };

  if (
    !options.skipPeriodLock
  ) {
    assertManualJournalChangePeriodOpen(
      existingJournal,
      updatedJournal,
      "edit this manual journal",
      options
    );
  }

  const updatedJournals =
    journals.map(
      (journal) =>
        String(journal.id) ===
        String(journalId)
          ? updatedJournal
          : journal
    );

  saveJournals(
    updatedJournals
  );

  return updatedJournal;
};

/*
|--------------------------------------------------------------------------
| Post manual journal
|--------------------------------------------------------------------------
*/

export const postJournal = (
  journalId,
  options = {}
) => {
  const journals =
    initialiseJournals();

  const existingJournal =
    journals.find(
      (journal) =>
        String(journal.id) ===
        String(journalId)
    );

  if (!existingJournal) {
    throw new Error(
      "Journal not found."
    );
  }

  if (
    isSystemJournal(
      existingJournal
    )
  ) {
    throw new Error(
      "System journals are posted automatically by their source transaction."
    );
  }

  if (
    normaliseStatus(
      existingJournal.status
    ) === "Posted"
  ) {
    return existingJournal;
  }

  if (
    normaliseStatus(
      existingJournal.status
    ) === "Reversed"
  ) {
    throw new Error(
      "A reversed journal cannot be posted again."
    );
  }

  const validation =
    validateJournalLines(
      existingJournal.lines
    );

  const now =
    new Date().toISOString();

  const postedJournal = {
    ...existingJournal,

    lines:
      validation.lines,

    totalDebit:
      validation.totalDebit,

    totalCredit:
      validation.totalCredit,

    status: "Posted",

    postedAt: now,

    updatedAt: now,
  };

  if (
    !options.skipPeriodLock
  ) {
    assertManualJournalPeriodOpen(
      postedJournal,
      "post this manual journal",
      options
    );
  }

  const updatedJournals =
    journals.map(
      (journal) =>
        String(journal.id) ===
        String(journalId)
          ? postedJournal
          : journal
    );

  return commitPostedJournal(
    journals,
    updatedJournals,
    postedJournal
  );
};

/*
|--------------------------------------------------------------------------
| Delete manual journal
|--------------------------------------------------------------------------
*/

export const deleteJournal = (
  journalId,
  options = {}
) => {
  const journals =
    initialiseJournals();

  const existingJournal =
    journals.find(
      (journal) =>
        String(journal.id) ===
        String(journalId)
    );

  if (!existingJournal) {
    throw new Error(
      "Journal not found."
    );
  }

  if (
    isSystemJournal(
      existingJournal
    )
  ) {
    throw new Error(
      "System-generated journals cannot be deleted manually."
    );
  }

  if (
    normaliseStatus(
      existingJournal.status
    ) !== "Draft"
  ) {
    throw new Error(
      "Only draft journals can be deleted. Posted journals must be reversed."
    );
  }

  if (
    !options.skipPeriodLock
  ) {
    assertManualJournalPeriodOpen(
      existingJournal,
      "delete this manual journal",
      options
    );
  }

  const updatedJournals =
    journals.filter(
      (journal) =>
        String(journal.id) !==
        String(journalId)
    );

  saveJournals(
    updatedJournals
  );

  return updatedJournals;
};

/*
|--------------------------------------------------------------------------
| Reverse journal
|--------------------------------------------------------------------------
*/

const createReversalLines = (
  journal
) => {
  return (
    journal.lines || []
  ).map((line) => ({
    id: createRecordId(),

    accountId:
      line.accountId,

    accountCode:
      line.accountCode,

    accountName:
      line.accountName,

    description:
      line.description ||
      `Reversal of ${journal.reference || journal.journalNumber}`,

    debit:
      roundMoney(
        line.credit
      ),

    credit:
      roundMoney(
        line.debit
      ),
  }));
};

export const reverseJournal = (
  journalId,
  reason = "",
  {
    allowSystem = false,

    allowPeriodLockOverride =
      false,

    skipPeriodLock = false,

    reversalDate = "",
  } = {}
) => {
  const journals =
    initialiseJournals();

  const existingJournal =
    journals.find(
      (journal) =>
        String(journal.id) ===
        String(journalId)
    );

  if (!existingJournal) {
    throw new Error(
      "Journal not found."
    );
  }

  const systemJournal =
    isSystemJournal(
      existingJournal
    );

  if (
    systemJournal &&
    !allowSystem
  ) {
    throw new Error(
      "System-generated journals must be reversed from their source transaction."
    );
  }

  if (
    normaliseStatus(
      existingJournal.status
    ) === "Draft"
  ) {
    throw new Error(
      "A draft journal cannot be reversed."
    );
  }

  if (
    normaliseStatus(
      existingJournal.status
    ) === "Reversed"
  ) {
    throw new Error(
      "This journal has already been reversed."
    );
  }

  if (
    isReversalJournal(
      existingJournal
    )
  ) {
    throw new Error(
      "A reversal journal cannot be reversed again."
    );
  }

  if (
    !systemJournal &&
    !skipPeriodLock
  ) {
    assertManualJournalPeriodOpen(
      existingJournal,
      "reverse this manual journal",
      {
        allowPeriodLockOverride,
      }
    );
  }

  const cleanedReason =
    String(reason || "")
      .trim();

  const now =
    new Date().toISOString();

  const resolvedReversalDate =
    normaliseDate(
      reversalDate
    ) ||
    getJournalDate(
      existingJournal
    );

  const reversalNumber =
    calculateNextJournalNumber(
      journals
    );

  const reversalJournal = {
    id:
      createRecordId(),

    journalNumber:
      reversalNumber,

    reference:
      `REV-${existingJournal.reference || existingJournal.journalNumber || reversalNumber}`,

    date:
      resolvedReversalDate,

    journalDate:
      resolvedReversalDate,

    description:
      `Reversal of ${existingJournal.description}`,

    notes:
      cleanedReason,

    status: "Posted",

    lines:
      createReversalLines(
        existingJournal
      ),

    totalDebit:
      existingJournal.totalCredit,

    totalCredit:
      existingJournal.totalDebit,

    isSystem:
      systemJournal,

    isReversal: true,

    originalJournalId:
      existingJournal.id,

    reversalJournalId: null,

    sourceType:
      systemJournal
        ? existingJournal.sourceType
        : "Journal reversal",

    sourceId:
      existingJournal.sourceId ??
      existingJournal.id,

    sourceNumber:
      existingJournal.sourceNumber ||
      existingJournal.reference ||
      existingJournal.journalNumber,

    sourceAction:
      "Reverse journal",

    createdBy:
      systemJournal
        ? "Ledgify System"
        : "Current user",

    createdAt: now,

    updatedAt: now,

    postedAt: now,

    reversedAt: null,

    reversalReason:
      cleanedReason,
  };

  const reversedOriginal = {
    ...existingJournal,

    status: "Reversed",

    reversalJournalId:
      reversalJournal.id,

    reversedAt: now,

    reversalReason:
      cleanedReason,

    updatedAt: now,
  };

  const updatedJournals = [
    reversalJournal,

    ...journals.map(
      (journal) =>
        String(journal.id) ===
        String(journalId)
          ? reversedOriginal
          : journal
    ),
  ];

  return commitPostedJournal(
    journals,
    updatedJournals,
    reversalJournal
  );
};

/*
|--------------------------------------------------------------------------
| System journals
|--------------------------------------------------------------------------
*/

const sourceMatches = (
  journal,
  {
    sourceType,
    sourceId,
    sourceAction,
  }
) => {
  if (
    !isSystemJournal(
      journal
    )
  ) {
    return false;
  }

  if (
    sourceType &&
    normaliseText(
      journal.sourceType
    ) !==
      normaliseText(
        sourceType
      )
  ) {
    return false;
  }

  if (
    sourceId !==
      undefined &&
    sourceId !== null &&
    sourceId !== "" &&
    String(
      journal.sourceId
    ) !==
      String(sourceId)
  ) {
    return false;
  }

  if (
    sourceAction &&
    normaliseText(
      journal.sourceAction
    ) !==
      normaliseText(
        sourceAction
      )
  ) {
    return false;
  }

  return true;
};

export const getSystemJournalBySource = (
  sourceTypeOrOptions,
  sourceId = null,
  sourceAction = ""
) => {
  const options =
    sourceTypeOrOptions &&
    typeof sourceTypeOrOptions ===
      "object"
      ? sourceTypeOrOptions
      : {
          sourceType:
            sourceTypeOrOptions,

          sourceId,

          sourceAction,
        };

  const journals =
    initialiseJournals();

  return (
    journals.find(
      (journal) =>
        !isReversalJournal(
          journal
        ) &&
        sourceMatches(
          journal,
          options
        )
    ) || null
  );
};

export const createSystemJournal = (
  journalData
) => {
  if (
    !journalData ||
    typeof journalData !==
      "object"
  ) {
    throw new Error(
      "System journal data is required."
    );
  }

  const sourceType =
    String(
      journalData.sourceType ||
        "System journal"
    ).trim();

  const sourceId =
    journalData.sourceId ??
    null;

  const sourceAction =
    String(
      journalData.sourceAction ||
        ""
    ).trim();

  if (
    sourceId !== null &&
    sourceId !== undefined &&
    sourceId !== ""
  ) {
    const existingJournal =
      getSystemJournalBySource({
        sourceType,

        sourceId,

        sourceAction,
      });

    if (
      existingJournal &&
      normaliseStatus(
        existingJournal.status
      ) !== "Reversed"
    ) {
      return existingJournal;
    }
  }

  const journals =
    initialiseJournals();

  const cleanedJournal =
    cleanJournalInput(
      journalData
    );

  const now =
    new Date().toISOString();

  const systemJournal = {
    ...cleanedJournal,

    id:
      journalData.id ||
      createRecordId(),

    journalNumber:
      journalData.journalNumber ||
      calculateNextJournalNumber(
        journals
      ),

    reference:
      journalData.reference ||
      journalData.sourceNumber ||
      calculateNextJournalNumber(
        journals
      ),

    status: "Posted",

    isSystem: true,

    isReversal: false,

    originalJournalId: null,

    reversalJournalId: null,

    sourceType,

    sourceId,

    sourceNumber:
      String(
        journalData.sourceNumber ||
          journalData.reference ||
          ""
      ).trim(),

    sourceAction,

    createdBy:
      journalData.createdBy ||
      "Ledgify System",

    createdAt:
      journalData.createdAt ||
      now,

    updatedAt: now,

    postedAt:
      journalData.postedAt ||
      now,

    reversedAt: null,

    reversalReason: "",
  };

  return commitPostedJournal(
    journals,
    [
      systemJournal,
      ...journals,
    ],
    systemJournal
  );
};

const resolveSystemJournal = (
  journalOrSource,
  sourceId = null,
  sourceAction = ""
) => {
  if (
    journalOrSource &&
    typeof journalOrSource ===
      "object"
  ) {
    if (journalOrSource.id) {
      return getJournalById(
        journalOrSource.id
      );
    }

    return getSystemJournalBySource(
      journalOrSource
    );
  }

  const journalById =
    getJournalById(
      journalOrSource
    );

  if (
    journalById &&
    isSystemJournal(
      journalById
    )
  ) {
    return journalById;
  }

  return getSystemJournalBySource(
    journalOrSource,
    sourceId,
    sourceAction
  );
};

export const reverseSystemJournal = (
  journalOrSource,
  sourceIdOrReason = "",
  reasonOrOptions = "",
  maybeOptions = {}
) => {
  let sourceId = null;
  let reason;
  let options;

  const journalById =
    getJournalById(
      journalOrSource
    );

  if (
    journalById &&
    isSystemJournal(
      journalById
    )
  ) {
    reason =
      typeof sourceIdOrReason ===
        "string"
        ? sourceIdOrReason
        : "";

    options =
      reasonOrOptions &&
      typeof reasonOrOptions ===
        "object"
        ? reasonOrOptions
        : maybeOptions;
  } else if (
    journalOrSource &&
    typeof journalOrSource ===
      "object"
  ) {
    reason =
      typeof sourceIdOrReason ===
        "string"
        ? sourceIdOrReason
        : "";

    options =
      reasonOrOptions &&
      typeof reasonOrOptions ===
        "object"
        ? reasonOrOptions
        : maybeOptions;
  } else {
    sourceId =
      sourceIdOrReason;

    reason =
      typeof reasonOrOptions ===
        "string"
        ? reasonOrOptions
        : "";

    options =
      reasonOrOptions &&
      typeof reasonOrOptions ===
        "object"
        ? reasonOrOptions
        : maybeOptions;
  }

  const journal =
    resolveSystemJournal(
      journalOrSource,
      sourceId
    );

  if (!journal) {
    throw new Error(
      "The system journal could not be found."
    );
  }

  if (
    !isSystemJournal(
      journal
    )
  ) {
    throw new Error(
      "The selected journal is not a system-generated journal."
    );
  }

  return reverseJournal(
    journal.id,
    reason,
    {
      ...options,

      allowSystem: true,

      skipPeriodLock: true,
    }
  );
};

/*
|--------------------------------------------------------------------------
| Roll back system journal
|--------------------------------------------------------------------------
*/

export const rollbackSystemJournal = (
  journalId
) => {
  const journals =
    initialiseJournals();

  const journal =
    journals.find(
      (currentJournal) =>
        String(
          currentJournal.id
        ) ===
        String(journalId)
    );

  if (!journal) {
    return false;
  }

  if (
    !isSystemJournal(
      journal
    )
  ) {
    throw new Error(
      "Only system-generated journals can be rolled back."
    );
  }

  if (
    normaliseStatus(
      journal.status
    ) === "Draft"
  ) {
    const updatedJournals =
      journals.filter(
        (currentJournal) =>
          String(
            currentJournal.id
          ) !==
          String(journal.id)
      );

    saveJournals(
      updatedJournals
    );

    return true;
  }

  if (
    !isReversalJournal(
      journal
    ) &&
    journal.reversalJournalId
  ) {
    throw new Error(
      "Roll back the reversal journal before rolling back the original system journal."
    );
  }

  let balancesReversed =
    false;

  try {
    applyJournalBalanceImpact(
      journal,
      {
        reverse: true,
      }
    );

    balancesReversed =
      true;

    let updatedJournals =
      journals.filter(
        (currentJournal) =>
          String(
            currentJournal.id
          ) !==
          String(journal.id)
      );

    if (
      isReversalJournal(
        journal
      ) &&
      journal.originalJournalId
    ) {
      updatedJournals =
        updatedJournals.map(
          (currentJournal) =>
            String(
              currentJournal.id
            ) ===
            String(
              journal.originalJournalId
            )
              ? {
                  ...currentJournal,

                  status:
                    "Posted",

                  reversalJournalId:
                    null,

                  reversedAt:
                    null,

                  reversalReason:
                    "",

                  updatedAt:
                    new Date().toISOString(),
                }
              : currentJournal
        );
    }

    saveJournals(
      updatedJournals
    );

    return true;
  } catch (error) {
    if (balancesReversed) {
      try {
        applyJournalBalanceImpact(
          journal
        );
      } catch (
        balanceRestoreError
      ) {
        console.error(
          "System journal balance restoration failed:",
          balanceRestoreError
        );
      }
    }

    try {
      saveJournals(
        journals
      );
    } catch (
      storageRestoreError
    ) {
      console.error(
        "System journal storage restoration failed:",
        storageRestoreError
      );
    }

    throw error;
  }
};

/*
|--------------------------------------------------------------------------
| Development reset
|--------------------------------------------------------------------------
*/

export const resetJournals = () => {
  const initialJournals =
    cloneData(
      defaultJournals || []
    );

  saveJournals(
    initialJournals
  );

  return initialJournals;
};
