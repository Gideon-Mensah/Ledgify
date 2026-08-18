import {
  getAccounts,
} from "./accountService";

import {
  getGeneralLedger,
} from "./generalLedgerService";

const MONEY_TOLERANCE =
  0.005;

const OPENING_BALANCE_EQUITY_ID =
  "system-opening-balance-equity";

const OPENING_BALANCE_EQUITY_CODE =
  "390";

const OPENING_BALANCE_EQUITY_NAME =
  "Opening Balance Equity";

const roundMoney = (
  value
) => {
  return (
    Math.round(
      ((Number(value) || 0) +
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

  const displayDateMatch =
    text.match(
      /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
    );

  if (
    displayDateMatch
  ) {
    const monthNumbers = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };

    const month =
      monthNumbers[
        displayDateMatch[2]
          .toLowerCase()
      ];

    if (
      month
    ) {
      return `${displayDateMatch[3]}-${String(
        month
      ).padStart(
        2,
        "0"
      )}-${String(
        displayDateMatch[1]
      ).padStart(
        2,
        "0"
      )}`;
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
    [
      account?.type,
      account?.accountType,
      account?.category,
      account?.group,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

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

const normalBalanceToTrialBalanceSigned =
  (
    account,
    normalBalanceAmount
  ) => {
    const amount =
      roundMoney(
        normalBalanceAmount
      );

    /*
    |--------------------------------------------------------------------------
    | Trial Balance sign convention
    |--------------------------------------------------------------------------
    |
    | Positive = Debit
    | Negative = Credit
    |
    | General Ledger running balances use the account's normal-balance
    | convention instead:
    |
    | Debit-normal account:
    |   positive ledger balance = Debit
    |
    | Credit-normal account:
    |   positive ledger balance = Credit
    |
    | Therefore credit-normal ledger balances must be inverted when
    | converted into Trial Balance signed amounts.
    |
    */

    return getNormalBalance(
      account
    ) === "Credit"
      ? roundMoney(
          -amount
        )
      : amount;
  };

const getBalanceSide = (
  signedBalance
) => {
  const amount =
    roundMoney(
      signedBalance
    );

  if (
    Math.abs(
      amount
    ) <= MONEY_TOLERANCE
  ) {
    return "Zero";
  }

  return amount > 0
    ? "Debit"
    : "Credit";
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

const findOpeningBalanceEquityAccount =
  (
    accounts
  ) => {
    return (
      accounts.find(
        (
          account
        ) =>
          String(
            account.code ||
              ""
          ) ===
            OPENING_BALANCE_EQUITY_CODE ||
          normaliseText(
            account.name
          ) ===
            normaliseText(
              OPENING_BALANCE_EQUITY_NAME
            )
      ) ||
      null
    );
  };

const createTrialBalanceRow =
  (
    account,
    signedBalance,
    extra = {}
  ) => {
    const roundedBalance =
      roundMoney(
        signedBalance
      );

    return {
      accountId:
        account.id,

      code:
        account.code,

      name:
        account.name,

      type:
        account.type,

      subtype:
        account.subtype ||
        "",

      status:
        account.status ||
        "Active",

      normalBalance:
        getNormalBalance(
          account
        ),

      balanceSide:
        getBalanceSide(
          roundedBalance
        ),

      signedBalance:
        roundedBalance,

      debit:
        roundedBalance >
        MONEY_TOLERANCE
          ? roundedBalance
          : 0,

      credit:
        roundedBalance <
        -MONEY_TOLERANCE
          ? Math.abs(
              roundedBalance
            )
          : 0,

      isDerived:
        Boolean(
          account.isDerived
        ),

      ...extra,
    };
  };

const sortTrialBalanceRows =
  (
    rows
  ) => {
    return [
      ...rows,
    ].sort(
      (
        first,
        second
      ) =>
        String(
          first.code || ""
        ).localeCompare(
          String(
            second.code ||
              ""
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

const compareEntriesAscending =
  (
    first,
    second
  ) => {
    const dateComparison =
      String(
        first.date || ""
      ).localeCompare(
        String(
          second.date || ""
        )
      );

    if (
      dateComparison !== 0
    ) {
      return dateComparison;
    }

    const createdComparison =
      String(
        first.journalCreatedAt ||
          ""
      ).localeCompare(
        String(
          second.journalCreatedAt ||
            ""
        )
      );

    if (
      createdComparison !==
      0
    ) {
      return createdComparison;
    }

    const journalComparison =
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
      journalComparison !==
      0
    ) {
      return journalComparison;
    }

    return (
      Number(
        first.lineIndex || 0
      ) -
      Number(
        second.lineIndex ||
          0
      )
    );
  };

const groupLedgerEntriesByAccount =
  (
    ledgerEntries
  ) => {
    const grouped =
      new Map();

    ledgerEntries.forEach(
      (
        entry
      ) => {
        const accountKey =
          String(
            entry.accountId ||
              entry.accountCode ||
              ""
          );

        if (
          !accountKey
        ) {
          return;
        }

        const existing =
          grouped.get(
            accountKey
          ) || [];

        existing.push(
          entry
        );

        grouped.set(
          accountKey,
          existing
        );
      }
    );

    grouped.forEach(
      (
        entries,
        key
      ) => {
        grouped.set(
          key,
          [
            ...entries,
          ].sort(
            compareEntriesAscending
          )
        );
      }
    );

    return grouped;
  };

const getAccountLedgerEntries =
  (
    account,
    groupedEntries
  ) => {
    const byId =
      groupedEntries.get(
        String(
          account.id
        )
      );

    if (
      byId
    ) {
      return byId;
    }

    /*
    |--------------------------------------------------------------------------
    | Defensive fallback
    |--------------------------------------------------------------------------
    |
    | General Ledger normally resolves every entry to the Chart of Accounts
    | account ID, but we also support account-code matching for compatibility
    | with older data.
    |
    */

    const accountCode =
      String(
        account.code ||
          ""
      );

    if (
      !accountCode
    ) {
      return [];
    }

    const matches = [];

    groupedEntries.forEach(
      (
        entries
      ) => {
        entries.forEach(
          (
            entry
          ) => {
            if (
              String(
                entry.accountCode ||
                  ""
              ) ===
              accountCode
            ) {
              matches.push(
                entry
              );
            }
          }
        );
      }
    );

    return matches.sort(
      compareEntriesAscending
    );
  };

const getInitialLedgerBalance =
  (
    account,
    entries
  ) => {
    /*
    |--------------------------------------------------------------------------
    | Use General Ledger's own opening position
    |--------------------------------------------------------------------------
    |
    | The first ledger entry contains previousBalance, which already knows
    | whether:
    |
    | - account.openingBalance should be used, or
    | - an Opening Balance system journal should introduce that balance.
    |
    | This prevents Trial Balance from independently applying an opening
    | balance a second time.
    |
    */

    if (
      entries.length > 0 &&
      entries[0]
        .previousBalance !==
        undefined
    ) {
      return roundMoney(
        entries[0]
          .previousBalance
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Account with no journal entries
    |--------------------------------------------------------------------------
    |
    | General Ledger also uses account.openingBalance as the initial position
    | when no Opening Balance system journal exists.
    |
    */

    return roundMoney(
      account.openingBalance
    );
  };

const getAccountBalanceAsOf =
  (
    account,
    entries,
    asOfDate
  ) => {
    const initialBalance =
      getInitialLedgerBalance(
        account,
        entries
      );

    if (
      entries.length ===
      0
    ) {
      return {
        initialBalance,

        ledgerBalance:
          initialBalance,

        entryCount: 0,

        lastTransactionDate:
          "",
      };
    }

    let lastEntry =
      null;

    if (
      asOfDate
    ) {
      for (
        let index =
          entries.length - 1;
        index >= 0;
        index -= 1
      ) {
        const entry =
          entries[index];

        if (
          entry.date &&
          entry.date <=
            asOfDate
        ) {
          lastEntry =
            entry;

          break;
        }
      }
    } else {
      lastEntry =
        entries[
          entries.length - 1
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | As-of date precedes the first ledger transaction
    |--------------------------------------------------------------------------
    |
    | Use the true General Ledger position immediately before the first
    | transaction.
    |
    | For accounts with an Opening Balance system journal this will normally
    | be zero.
    |
    */

    if (
      !lastEntry
    ) {
      return {
        initialBalance,

        ledgerBalance:
          initialBalance,

        entryCount: 0,

        lastTransactionDate:
          "",
      };
    }

    const includedEntries =
      asOfDate
        ? entries.filter(
            (
              entry
            ) =>
              entry.date &&
              entry.date <=
                asOfDate
          )
        : entries;

    return {
      initialBalance,

      ledgerBalance:
        roundMoney(
          lastEntry.runningBalance
        ),

      entryCount:
        includedEntries.length,

      lastTransactionDate:
        lastEntry.date ||
        "",
    };
  };

const createDerivedOpeningEquityAccount =
  () => {
    return {
      id:
        OPENING_BALANCE_EQUITY_ID,

      code:
        OPENING_BALANCE_EQUITY_CODE,

      name:
        OPENING_BALANCE_EQUITY_NAME,

      type:
        "Equity",

      subtype:
        "Legacy opening balances",

      normalBalance:
        "Credit",

      status:
        "System",

      isDerived:
        true,
    };
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

export const getTrialBalance =
  ({
    asOfDate = "",
    search = "",
    includeZeroBalances =
      false,
  } = {}) => {
    const accounts =
      getAllAccounts();

    const resolvedAsOfDate =
      normaliseDate(
        asOfDate
      );

    if (
      asOfDate &&
      !resolvedAsOfDate
    ) {
      throw new Error(
        "The Trial Balance reporting date is invalid."
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Read the complete General Ledger
    |--------------------------------------------------------------------------
    |
    | Do not ask the ledger for only the as-of period because we need each
    | account's true previousBalance before its first transaction.
    |
    */

    const ledgerEntries =
      getGeneralLedger({
        search: "",

        accountId:
          "All",

        dateFrom: "",

        dateTo: "",
      });

    const groupedEntries =
      groupLedgerEntriesByAccount(
        Array.isArray(
          ledgerEntries
        )
          ? ledgerEntries
          : []
      );

    let implicitOpeningSignedTotal =
      0;

    const accountRows =
      accounts.map(
        (
          account
        ) => {
          const entries =
            getAccountLedgerEntries(
              account,
              groupedEntries
            );

          const balanceState =
            getAccountBalanceAsOf(
              account,
              entries,
              resolvedAsOfDate
            );

          const signedBalance =
            normalBalanceToTrialBalanceSigned(
              account,
              balanceState.ledgerBalance
            );

          const initialSignedBalance =
            normalBalanceToTrialBalanceSigned(
              account,
              balanceState.initialBalance
            );

          implicitOpeningSignedTotal =
            roundMoney(
              implicitOpeningSignedTotal +
                initialSignedBalance
            );

          return createTrialBalanceRow(
            account,
            signedBalance,
            {
              ledgerBalance:
                balanceState.ledgerBalance,

              initialLedgerBalance:
                balanceState.initialBalance,

              ledgerEntryCount:
                balanceState.entryCount,

              lastTransactionDate:
                balanceState.lastTransactionDate,
            }
          );
        }
      );

    /*
    |--------------------------------------------------------------------------
    | Legacy Opening Balance Equity compatibility
    |--------------------------------------------------------------------------
    |
    | Older Ledgify records may contain account.openingBalance values without
    | having been posted through the balanced Opening Balances system journal.
    |
    | General Ledger preserves those historic opening values for backwards
    | compatibility.
    |
    | To keep the Trial Balance balanced in the same way as the previous
    | service, the net implicit legacy opening position is offset to Opening
    | Balance Equity.
    |
    | Accounts using the proper Opening Balance system journal have an initial
    | ledger balance of zero, so they do NOT contribute to this adjustment.
    |
    */

    const openingBalanceAdjustment =
      Math.abs(
        implicitOpeningSignedTotal
      ) >
      MONEY_TOLERANCE
        ? roundMoney(
            -implicitOpeningSignedTotal
          )
        : 0;

    if (
      Math.abs(
        openingBalanceAdjustment
      ) >
      MONEY_TOLERANCE
    ) {
      const openingEquityAccount =
        findOpeningBalanceEquityAccount(
          accounts
        );

      if (
        openingEquityAccount
      ) {
        const existingRow =
          accountRows.find(
            (
              row
            ) =>
              String(
                row.accountId
              ) ===
              String(
                openingEquityAccount.id
              )
          );

        if (
          existingRow
        ) {
          const adjustedBalance =
            roundMoney(
              existingRow.signedBalance +
                openingBalanceAdjustment
            );

          existingRow.signedBalance =
            adjustedBalance;

          existingRow.debit =
            adjustedBalance >
            MONEY_TOLERANCE
              ? adjustedBalance
              : 0;

          existingRow.credit =
            adjustedBalance <
            -MONEY_TOLERANCE
              ? Math.abs(
                  adjustedBalance
                )
              : 0;

          existingRow.balanceSide =
            getBalanceSide(
              adjustedBalance
            );

          existingRow.openingBalanceAdjustment =
            openingBalanceAdjustment;

          existingRow.hasDerivedOpeningBalanceAdjustment =
            true;
        }
      } else {
        accountRows.push(
          createTrialBalanceRow(
            createDerivedOpeningEquityAccount(),
            openingBalanceAdjustment,
            {
              openingBalanceAdjustment,

              hasDerivedOpeningBalanceAdjustment:
                true,
            }
          )
        );
      }
    }

    const allRows =
      sortTrialBalanceRows(
        accountRows
      );

    /*
    |--------------------------------------------------------------------------
    | Full Trial Balance totals
    |--------------------------------------------------------------------------
    |
    | Search and "include zero balances" only alter row visibility.
    | They must never change the accounting totals of the Trial Balance.
    |
    */

    const totalDebit =
      roundMoney(
        allRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.debit ||
                0
            ),
          0
        )
      );

    const totalCredit =
      roundMoney(
        allRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.credit ||
                0
            ),
          0
        )
      );

    const difference =
      roundMoney(
        totalDebit -
          totalCredit
      );

    const searchValue =
      normaliseText(
        search
      );

    const visibleRows =
      allRows.filter(
        (
          row
        ) => {
          if (
            !includeZeroBalances &&
            Math.abs(
              row.signedBalance
            ) <=
              MONEY_TOLERANCE
          ) {
            return false;
          }

          if (
            !searchValue
          ) {
            return true;
          }

          return [
            row.code,
            row.name,
            row.type,
            row.subtype,
            row.status,
            row.balanceSide,
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
        }
      );

    const visibleTotalDebit =
      roundMoney(
        visibleRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.debit ||
                0
            ),
          0
        )
      );

    const visibleTotalCredit =
      roundMoney(
        visibleRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.credit ||
                0
            ),
          0
        )
      );

    return {
      asOfDate:
        resolvedAsOfDate,

      rows:
        visibleRows,

      /*
      |--------------------------------------------------------------------------
      | Full accounting totals
      |--------------------------------------------------------------------------
      */

      totalDebit,

      totalCredit,

      difference,

      isBalanced:
        Math.abs(
          difference
        ) <=
        MONEY_TOLERANCE,

      /*
      |--------------------------------------------------------------------------
      | Visible/filter totals
      |--------------------------------------------------------------------------
      */

      visibleTotalDebit,

      visibleTotalCredit,

      visibleDifference:
        roundMoney(
          visibleTotalDebit -
            visibleTotalCredit
        ),

      accountCount:
        visibleRows.length,

      visibleAccountCount:
        visibleRows.length,

      totalAccountCount:
        allRows.length,

      nonZeroAccountCount:
        allRows.filter(
          (
            row
          ) =>
            Math.abs(
              row.signedBalance
            ) >
            MONEY_TOLERANCE
        ).length,

      searchActive:
        Boolean(
          searchValue
        ),

      includeZeroBalances:
        Boolean(
          includeZeroBalances
        ),

      /*
      |--------------------------------------------------------------------------
      | Opening-balance compatibility
      |--------------------------------------------------------------------------
      */

      openingBalanceAdjustment,

      hasOpeningBalanceAdjustment:
        Math.abs(
          openingBalanceAdjustment
        ) >
        MONEY_TOLERANCE,
    };
  };

export const exportTrialBalanceCsv =
  (
    options = {}
  ) => {
    const trialBalance =
      getTrialBalance(
        options
      );

    const searchValue =
      String(
        options.search || ""
      ).trim();

    const rows = [
      [
        "Trial Balance",
        "",
        "",
        "",
        "",
      ],

      [
        "As at",
        trialBalance.asOfDate ||
          "",
        "",
        "",
        "",
      ],

      [
        "Status",
        trialBalance.isBalanced
          ? "Balanced"
          : "Out of balance",
        "",
        "",
        "",
      ],

      [
        "Difference",
        trialBalance.difference.toFixed(
          2
        ),
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
      ],

      [
        "Include zero balances",
        trialBalance.includeZeroBalances
          ? "Yes"
          : "No",
        "",
        "",
        "",
      ],

      [
        "Opening balance adjustment",
        trialBalance.openingBalanceAdjustment.toFixed(
          2
        ),
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
      ],

      [
        "Account Code",
        "Account Name",
        "Type",
        "Debit",
        "Credit",
      ],

      ...trialBalance.rows.map(
        (
          row
        ) => [
          row.code,
          row.name,
          row.type,
          row.debit.toFixed(
            2
          ),
          row.credit.toFixed(
            2
          ),
        ]
      ),
    ];

    if (
      trialBalance.searchActive ||
      !trialBalance.includeZeroBalances
    ) {
      rows.push(
        [
          "",
          "Visible rows total",
          "",
          trialBalance.visibleTotalDebit.toFixed(
            2
          ),
          trialBalance.visibleTotalCredit.toFixed(
            2
          ),
        ]
      );
    }

    rows.push(
      [
        "",
        "Full Trial Balance",
        "",
        trialBalance.totalDebit.toFixed(
          2
        ),
        trialBalance.totalCredit.toFixed(
          2
        ),
      ],

      [
        "",
        "Difference",
        "",
        trialBalance.difference.toFixed(
          2
        ),
        "",
      ]
    );

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