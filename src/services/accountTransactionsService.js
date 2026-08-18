import {
  getAccounts,
} from "./accountService";

import {
  getGeneralLedger,
} from "./generalLedgerService";

const MONEY_TOLERANCE =
  0.005;

const roundMoney = (
  value
) => {
  return (
    Math.round(
      ((Number(value) ||
        0) +
        Number.EPSILON) *
        100
    ) / 100
  );
};

const normaliseText = (
  value
) => {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
};

const normaliseDate = (
  value
) => {
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
      parsedDate.getMonth() +
        1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      parsedDate.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
};

const getAccountTypeText = (
  account
) => {
  return [
    account?.type,
    account?.accountType,
    account?.category,
    account?.group,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const getNormalBalance = (
  account
) => {
  const configured =
    normaliseText(
      account?.normalBalance
    );

  if (
    configured === "debit"
  ) {
    return "Debit";
  }

  if (
    configured === "credit"
  ) {
    return "Credit";
  }

  const typeText =
    getAccountTypeText(
      account
    );

  const creditNormal =
    [
      "liability",
      "equity",
      "revenue",
      "income",
      "sales",
      "capital",
    ].some(
      (
        keyword
      ) =>
        typeText.includes(
          keyword
        )
    );

  return creditNormal
    ? "Credit"
    : "Debit";
};

const calculateSignedMovement =
  (
    account,
    debit,
    credit
  ) => {
    const normalBalance =
      getNormalBalance(
        account
      );

    if (
      normalBalance ===
      "Credit"
    ) {
      return roundMoney(
        Number(
          credit || 0
        ) -
          Number(
            debit || 0
          )
      );
    }

    return roundMoney(
      Number(
        debit || 0
      ) -
        Number(
          credit || 0
        )
    );
  };

const getBalanceSide = (
  account,
  balance
) => {
  const normalBalance =
    getNormalBalance(
      account
    );

  if (
    Number(balance) >= 0
  ) {
    return normalBalance;
  }

  return normalBalance ===
    "Debit"
    ? "Credit"
    : "Debit";
};

const getAllAccounts = () => {
  const accounts =
    getAccounts({
      status: "All",
    });

  return Array.isArray(
    accounts
  )
    ? accounts
    : [];
};

const findAccount = (
  accountIdentifier
) => {
  const identifier =
    String(
      accountIdentifier || ""
    ).trim();

  if (!identifier) {
    return null;
  }

  return (
    getAllAccounts().find(
      (
        account
      ) =>
        String(
          account.id
        ) ===
          identifier ||
        String(
          account.code
        ) ===
          identifier
    ) ||
    null
  );
};

const compareTransactionsAscending =
  (
    first,
    second
  ) => {
    const dateDifference =
      String(
        first.date || ""
      ).localeCompare(
        String(
          second.date || ""
        )
      );

    if (
      dateDifference !== 0
    ) {
      return dateDifference;
    }

    const createdDifference =
      String(
        first.createdAt ||
          ""
      ).localeCompare(
        String(
          second.createdAt ||
            ""
        )
      );

    if (
      createdDifference !== 0
    ) {
      return createdDifference;
    }

    const journalDifference =
      String(
        first.journalNumber ||
          ""
      ).localeCompare(
        String(
          second.journalNumber ||
            ""
        ),
        undefined,
        {
          numeric: true,
          sensitivity:
            "base",
        }
      );

    if (
      journalDifference !==
      0
    ) {
      return journalDifference;
    }

    const lineDifference =
      Number(
        first.lineIndex || 0
      ) -
      Number(
        second.lineIndex || 0
      );

    if (
      lineDifference !== 0
    ) {
      return lineDifference;
    }

    return String(
      first.id || ""
    ).localeCompare(
      String(
        second.id || ""
      )
    );
  };

const convertLedgerEntryToTransaction =
  (
    entry,
    account
  ) => {
    const debit =
      roundMoney(
        entry.debit
      );

    const credit =
      roundMoney(
        entry.credit
      );

    return {
      id:
        entry.id,

      lineId:
        entry.lineId ||
        null,

      journalId:
        entry.journalId,

      date:
        entry.date,

      journalNumber:
        entry.journalNumber ||
        entry.reference ||
        "—",

      journalStatus:
        entry.journalStatus ||
        "Posted",

      reference:
        entry.reference ||
        "",

      description:
        entry.lineDescription ||
        entry.journalDescription ||
        "Journal transaction",

      journalDescription:
        entry.journalDescription ||
        "",

      source:
        entry.sourceType ||
        (
          entry.isSystem
            ? "System journal"
            : "Manual journal"
        ),

      sourceType:
        entry.sourceType ||
        "",

      sourceId:
        entry.sourceId ||
        null,

      sourceNumber:
        entry.sourceNumber ||
        "",

      sourceAction:
        entry.sourceAction ||
        "",

      status:
        entry.journalStatus ||
        "Posted",

      createdAt:
        entry.journalCreatedAt ||
        "",

      isSystem:
        Boolean(
          entry.isSystem
        ),

      isReversal:
        Boolean(
          entry.isReversal
        ),

      reversesJournalId:
        entry.reversesJournalId ||
        null,

      reversedByJournalId:
        entry.reversedByJournalId ||
        null,

      isOpeningBalance:
        Boolean(
          entry.isOpeningBalance
        ),

      accountId:
        entry.accountId,

      accountCode:
        entry.accountCode,

      accountName:
        entry.accountName,

      accountType:
        entry.accountType,

      accountSubtype:
        entry.accountSubtype ||
        "",

      debit,

      credit,

      movement:
        entry.movement !==
          undefined
          ? roundMoney(
              entry.movement
            )
          : calculateSignedMovement(
              account,
              debit,
              credit
            ),

      previousBalance:
        roundMoney(
          entry.previousBalance
        ),

      runningBalance:
        roundMoney(
          entry.runningBalance
        ),

      balanceSide:
        entry.balanceSide ||
        getBalanceSide(
          account,
          entry.runningBalance
        ),

      lineIndex:
        Number(
          entry.lineIndex || 0
        ),
    };
  };

const buildAllTransactions = (
  account
) => {
  /*
  |--------------------------------------------------------------------------
  | Single accounting source of truth
  |--------------------------------------------------------------------------
  |
  | The General Ledger already:
  |
  | - resolves accountId and accountCode
  | - includes manual and system journals
  | - includes Posted and Reversed journals
  | - preserves reversal journals
  | - prevents opening-balance double counting
  | - calculates chronological running balances
  |
  | Account Transactions therefore reads from that ledger rather than
  | independently rebuilding accounting balances.
  |
  */

  const ledgerEntries =
    getGeneralLedger({
      accountId:
        account.id,

      search: "",

      dateFrom: "",

      dateTo: "",
    });

  return (
    Array.isArray(
      ledgerEntries
    )
      ? ledgerEntries
      : []
  )
    .map(
      (
        entry
      ) =>
        convertLedgerEntryToTransaction(
          entry,
          account
        )
    )
    .sort(
      compareTransactionsAscending
    );
};

const rowMatchesSearch = (
  row,
  searchValue
) => {
  if (
    !searchValue
  ) {
    return true;
  }

  return [
    row.journalNumber,
    row.reference,
    row.description,
    row.journalDescription,
    row.source,
    row.sourceType,
    row.sourceNumber,
    row.sourceAction,
    row.status,
    row.accountCode,
    row.accountName,
    row.accountType,
    row.accountSubtype,
    row.isReversal
      ? "reversal"
      : "",
    row.isOpeningBalance
      ? "opening balance"
      : "",
  ].some(
    (
      value
    ) =>
      normaliseText(
        value
      ).includes(
        searchValue
      )
  );
};

const getFallbackOpeningBalance =
  (
    account,
    allTransactions
  ) => {
    /*
    |--------------------------------------------------------------------------
    | Prefer the General Ledger's opening position
    |--------------------------------------------------------------------------
    |
    | previousBalance on the first chronological ledger entry already knows
    | whether account.openingBalance should be used or whether an Opening
    | Balance system journal is responsible for introducing the balance.
    |
    */

    if (
      allTransactions.length >
      0
    ) {
      return roundMoney(
        allTransactions[0]
          .previousBalance
      );
    }

    /*
    |--------------------------------------------------------------------------
    | No journal activity
    |--------------------------------------------------------------------------
    |
    | When the account has no ledger entries at all, there is no Opening
    | Balance journal to derive the value from, so the configured account
    | opening balance remains the correct fallback.
    |
    */

    return roundMoney(
      account.openingBalance
    );
  };

const calculatePeriodOpeningBalance =
  (
    account,
    allTransactions,
    fromDate
  ) => {
    const baseOpeningBalance =
      getFallbackOpeningBalance(
        account,
        allTransactions
      );

    if (!fromDate) {
      return baseOpeningBalance;
    }

    const transactionsBeforePeriod =
      allTransactions.filter(
        (
          transaction
        ) =>
          transaction.date &&
          transaction.date <
            fromDate
      );

    if (
      transactionsBeforePeriod.length >
      0
    ) {
      return roundMoney(
        transactionsBeforePeriod[
          transactionsBeforePeriod.length -
            1
        ].runningBalance
      );
    }

    /*
    |--------------------------------------------------------------------------
    | First transaction may itself be in the selected period
    |--------------------------------------------------------------------------
    |
    | Its previousBalance is the true ledger balance immediately before that
    | transaction, including any valid configured starting position.
    |
    */

    const firstTransactionInOrAfterPeriod =
      allTransactions.find(
        (
          transaction
        ) =>
          transaction.date &&
          transaction.date >=
            fromDate
      );

    if (
      firstTransactionInOrAfterPeriod
    ) {
      return roundMoney(
        firstTransactionInOrAfterPeriod.previousBalance
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Selected period is after all existing transactions
    |--------------------------------------------------------------------------
    */

    if (
      allTransactions.length >
      0
    ) {
      return roundMoney(
        allTransactions[
          allTransactions.length -
            1
        ].runningBalance
      );
    }

    return baseOpeningBalance;
  };

const calculatePeriodClosingBalance =
  (
    periodTransactions,
    openingBalance
  ) => {
    if (
      periodTransactions.length ===
      0
    ) {
      return roundMoney(
        openingBalance
      );
    }

    return roundMoney(
      periodTransactions[
        periodTransactions.length -
          1
      ].runningBalance
    );
  };

const escapeCsv = (
  value
) => {
  const text =
    String(
      value ?? ""
    );

  if (
    /[",\n]/.test(
      text
    )
  ) {
    return `"${text.replace(
      /"/g,
      '""'
    )}"`;
  }

  return text;
};

export const getAccountTransactionAccounts =
  () => {
    /*
    |--------------------------------------------------------------------------
    | Include archived accounts
    |--------------------------------------------------------------------------
    |
    | Historical accounting reports must remain drillable even when the
    | underlying account has subsequently been archived.
    |
    */

    return getAllAccounts()
      .sort(
        (
          first,
          second
        ) =>
          String(
            first.code || ""
          ).localeCompare(
            String(
              second.code || ""
            ),
            undefined,
            {
              numeric: true,
              sensitivity:
                "base",
            }
          )
      );
  };

export const getAccountTransactions =
  ({
    accountId,
    fromDate = "",
    toDate = "",
    search = "",
  } = {}) => {
    const account =
      findAccount(
        accountId
      );

    if (!account) {
      throw new Error(
        "Select a valid account."
      );
    }

    const resolvedFromDate =
      normaliseDate(
        fromDate
      );

    const resolvedToDate =
      normaliseDate(
        toDate
      );

    if (
      fromDate &&
      !resolvedFromDate
    ) {
      throw new Error(
        "The start date is invalid."
      );
    }

    if (
      toDate &&
      !resolvedToDate
    ) {
      throw new Error(
        "The end date is invalid."
      );
    }

    if (
      resolvedFromDate &&
      resolvedToDate &&
      resolvedFromDate >
        resolvedToDate
    ) {
      throw new Error(
        "The start date cannot be after the end date."
      );
    }

    const allTransactions =
      buildAllTransactions(
        account
      );

    /*
    |--------------------------------------------------------------------------
    | Opening balance
    |--------------------------------------------------------------------------
    |
    | Search does NOT influence opening balances.
    |
    | The opening balance represents the real ledger position immediately
    | before the selected From date.
    |
    */

    const periodOpeningBalance =
      calculatePeriodOpeningBalance(
        account,
        allTransactions,
        resolvedFromDate
      );

    /*
    |--------------------------------------------------------------------------
    | Full accounting period
    |--------------------------------------------------------------------------
    |
    | Running balances are already calculated by the General Ledger across
    | the full chronological journal stream.
    |
    | Search filtering is deliberately applied AFTER the accounting period
    | has been calculated so searching cannot corrupt running balances.
    |
    */

    const periodTransactions =
      allTransactions.filter(
        (
          transaction
        ) => {
          if (
            resolvedFromDate &&
            transaction.date <
              resolvedFromDate
          ) {
            return false;
          }

          if (
            resolvedToDate &&
            transaction.date >
              resolvedToDate
          ) {
            return false;
          }

          return true;
        }
      );

    const periodTotalDebit =
      roundMoney(
        periodTransactions.reduce(
          (
            total,
            transaction
          ) =>
            total +
            Number(
              transaction.debit ||
                0
            ),
          0
        )
      );

    const periodTotalCredit =
      roundMoney(
        periodTransactions.reduce(
          (
            total,
            transaction
          ) =>
            total +
            Number(
              transaction.credit ||
                0
            ),
          0
        )
      );

    const periodClosingBalance =
      calculatePeriodClosingBalance(
        periodTransactions,
        periodOpeningBalance
      );

    /*
    |--------------------------------------------------------------------------
    | Search filter
    |--------------------------------------------------------------------------
    |
    | Search affects the visible rows and visible totals, but never rewrites
    | the true accounting running balance.
    |
    */

    const searchValue =
      normaliseText(
        search
      );

    const visibleTransactions =
      periodTransactions.filter(
        (
          transaction
        ) =>
          rowMatchesSearch(
            transaction,
            searchValue
          )
      );

    const visibleTotalDebit =
      roundMoney(
        visibleTransactions.reduce(
          (
            total,
            transaction
          ) =>
            total +
            Number(
              transaction.debit ||
                0
            ),
          0
        )
      );

    const visibleTotalCredit =
      roundMoney(
        visibleTransactions.reduce(
          (
            total,
            transaction
          ) =>
            total +
            Number(
              transaction.credit ||
                0
            ),
          0
        )
      );

    const expectedClosingBalance =
      roundMoney(
        periodOpeningBalance +
          calculateSignedMovement(
            account,
            periodTotalDebit,
            periodTotalCredit
          )
      );

    const normalBalance =
      getNormalBalance(
        account
      );

    return {
      account,

      accountNormalBalance:
        normalBalance,

      currency:
        account.currency ||
        "GBP",

      fromDate:
        resolvedFromDate,

      toDate:
        resolvedToDate,

      /*
      |--------------------------------------------------------------------------
      | Accounting balances
      |--------------------------------------------------------------------------
      */

      openingBalance:
        periodOpeningBalance,

      openingBalanceSide:
        getBalanceSide(
          account,
          periodOpeningBalance
        ),

      closingBalance:
        periodClosingBalance,

      closingBalanceSide:
        getBalanceSide(
          account,
          periodClosingBalance
        ),

      netMovement:
        roundMoney(
          periodClosingBalance -
            periodOpeningBalance
        ),

      /*
      |--------------------------------------------------------------------------
      | Existing API fields
      |--------------------------------------------------------------------------
      |
      | totalDebit / totalCredit remain the totals for the rows currently
      | shown. This preserves existing search/export behaviour.
      |
      */

      totalDebit:
        visibleTotalDebit,

      totalCredit:
        visibleTotalCredit,

      rows:
        visibleTransactions,

      transactionCount:
        visibleTransactions.length,

      /*
      |--------------------------------------------------------------------------
      | Full-period accounting totals
      |--------------------------------------------------------------------------
      */

      periodTotalDebit,

      periodTotalCredit,

      periodTransactionCount:
        periodTransactions.length,

      visibleTotalDebit,

      visibleTotalCredit,

      visibleTransactionCount:
        visibleTransactions.length,

      searchActive:
        Boolean(
          searchValue
        ),

      /*
      |--------------------------------------------------------------------------
      | Integrity check
      |--------------------------------------------------------------------------
      */

      expectedClosingBalance,

      balanced:
        Math.abs(
          periodClosingBalance -
            expectedClosingBalance
        ) <=
        MONEY_TOLERANCE,
    };
  };

export const exportAccountTransactionsCsv =
  (
    options = {}
  ) => {
    const report =
      getAccountTransactions(
        options
      );

    const searchValue =
      String(
        options.search || ""
      ).trim();

    const rows = [
      [
        "Account Transactions",
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Account",
        `${report.account.code} — ${report.account.name}`,
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "From",
        report.fromDate ||
          "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "To",
        report.toDate ||
          "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Normal balance",
        report.accountNormalBalance,
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Opening balance",
        report.openingBalance.toFixed(
          2
        ),
        report.openingBalanceSide,
        "",
        "",
        "",
        "",
      ],

      [
        "Period debits",
        report.periodTotalDebit.toFixed(
          2
        ),
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Period credits",
        report.periodTotalCredit.toFixed(
          2
        ),
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Closing balance",
        report.closingBalance.toFixed(
          2
        ),
        report.closingBalanceSide,
        "",
        "",
        "",
        "",
      ],

      [
        "Search",
        searchValue,
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Date",
        "Journal",
        "Reference",
        "Description",
        "Source",
        "Debit",
        "Credit",
        "Running balance",
      ],

      ...report.rows.map(
        (
          row
        ) => [
          row.date,
          row.journalNumber,
          row.reference,
          row.description,
          row.source,
          row.debit.toFixed(
            2
          ),
          row.credit.toFixed(
            2
          ),
          row.runningBalance.toFixed(
            2
          ),
        ]
      ),

      [
        "",
        "",
        "",
        searchValue
          ? "Visible row totals"
          : "Period totals",
        "",
        report.visibleTotalDebit.toFixed(
          2
        ),
        report.visibleTotalCredit.toFixed(
          2
        ),
        "",
      ],

      [
        "",
        "",
        "",
        "Period closing balance",
        "",
        "",
        "",
        report.closingBalance.toFixed(
          2
        ),
      ],
    ];

    return rows
      .map(
        (
          row
        ) =>
          row
            .map(
              escapeCsv
            )
            .join(
              ","
            )
      )
      .join(
        "\n"
      );
  };