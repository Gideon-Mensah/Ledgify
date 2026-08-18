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
    .map(
      normaliseText
    )
    .join(" ");
};

const getClassificationText = (
  account
) => {
  return [
    account?.name,
    account?.type,
    account?.subtype,
    account?.description,
    account?.classification,
    account?.category,
    account?.group,
  ]
    .filter(Boolean)
    .map(
      normaliseText
    )
    .join(" ");
};

const isRevenueAccount = (
  account
) => {
  const typeText =
    getAccountTypeText(
      account
    );

  return [
    "revenue",
    "income",
    "sales",
  ].some(
    (
      keyword
    ) =>
      typeText.includes(
        keyword
      )
  );
};

const isExpenseAccount = (
  account
) => {
  const typeText =
    getAccountTypeText(
      account
    );

  return [
    "expense",
    "cost of sales",
    "cost of goods",
    "cost of revenue",
    "direct cost",
    "cogs",
  ].some(
    (
      keyword
    ) =>
      typeText.includes(
        keyword
      )
  );
};

const isCostOfSalesAccount = (
  account
) => {
  if (
    !isExpenseAccount(
      account
    )
  ) {
    return false;
  }

  const text =
    getClassificationText(
      account
    );

  const directCostKeywords = [
    "cost of sales",
    "cost of goods sold",
    "cost of goods",
    "cost of revenue",
    "direct cost",
    "direct costs",
    "cogs",
    "materials consumed",
    "direct materials",
    "direct labour",
    "direct labor",
  ];

  if (
    directCostKeywords.some(
      (
        keyword
      ) =>
        text.includes(
          keyword
        )
    )
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Ledgify Chart of Accounts fallback
  |--------------------------------------------------------------------------
  |
  | Ledgify currently uses account 300 for Cost of Goods Sold.
  |
  | We only apply the code fallback AFTER confirming that the account is
  | expense-like. Therefore account 390 Opening Balance Equity will never be
  | incorrectly classified as Cost of Sales.
  |
  */

  const code =
    Number(
      account?.code
    );

  return (
    Number.isFinite(
      code
    ) &&
    code >= 300 &&
    code < 400
  );
};

const isOtherIncomeAccount = (
  account
) => {
  if (
    !isRevenueAccount(
      account
    )
  ) {
    return false;
  }

  const text =
    getClassificationText(
      account
    );

  return [
    "other income",
    "other revenue",
    "interest income",
    "interest received",
    "gain on disposal",
    "disposal gain",
    "foreign exchange gain",
    "fx gain",
  ].some(
    (
      keyword
    ) =>
      text.includes(
        keyword
      )
  );
};

const isYearEndCloseEntry = (
  entry
) => {
  /*
  |--------------------------------------------------------------------------
  | Year-end closing journals must not erase historical P&L performance
  |--------------------------------------------------------------------------
  |
  | The General Ledger correctly contains the year-end close because the
  | ledger must show the actual transfer from temporary accounts into
  | Retained Earnings.
  |
  | A Profit & Loss report is different. It reports economic activity for
  | the selected period. Including the closing journal would zero Revenue and
  | Expense accounts and could make a completed financial year show £0.
  |
  */

  const sourceType =
    normaliseText(
      entry?.sourceType
    );

  if (
    sourceType.includes(
      "year-end close"
    ) ||
    sourceType.includes(
      "year end close"
    )
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Defensive reversal detection
  |--------------------------------------------------------------------------
  |
  | A reversal of a year-end close may have a more generic source type.
  | Only inspect the description/reference when the entry is itself marked
  | as a reversal, reducing the chance of excluding an ordinary adjustment.
  |
  */

  if (
    entry?.isReversal
  ) {
    const reversalText =
      [
        entry?.journalDescription,
        entry?.reference,
        entry?.sourceNumber,
      ]
        .filter(Boolean)
        .map(
          normaliseText
        )
        .join(" ");

    if (
      reversalText.includes(
        "year-end close"
      ) ||
      reversalText.includes(
        "year end close"
      )
    ) {
      return true;
    }
  }

  return false;
};

const getAccountLookup = (
  accounts
) => {
  const byId =
    new Map();

  const byCode =
    new Map();

  accounts.forEach(
    (
      account
    ) => {
      if (
        account?.id !==
          undefined &&
        account?.id !==
          null
      ) {
        byId.set(
          String(
            account.id
          ),
          account
        );
      }

      if (
        account?.code !==
          undefined &&
        account?.code !==
          null
      ) {
        byCode.set(
          String(
            account.code
          ),
          account
        );
      }
    }
  );

  return {
    byId,
    byCode,
  };
};

const resolveEntryAccount = (
  entry,
  accountLookup
) => {
  if (
    entry?.accountId !==
      undefined &&
    entry?.accountId !==
      null
  ) {
    const byId =
      accountLookup.byId.get(
        String(
          entry.accountId
        )
      );

    if (
      byId
    ) {
      return byId;
    }
  }

  if (
    entry?.accountCode !==
      undefined &&
    entry?.accountCode !==
      null
  ) {
    return (
      accountLookup.byCode.get(
        String(
          entry.accountCode
        )
      ) ||
      null
    );
  }

  return null;
};

const calculateEntryAmount = (
  account,
  entry
) => {
  const debit =
    roundMoney(
      entry?.debit
    );

  const credit =
    roundMoney(
      entry?.credit
    );

  /*
  |--------------------------------------------------------------------------
  | P&L presentation convention
  |--------------------------------------------------------------------------
  |
  | Revenue:
  |   Credit - Debit = positive income
  |
  | Expenses:
  |   Debit - Credit = positive expense
  |
  | Contra balances naturally become negative.
  |
  */

  if (
    isRevenueAccount(
      account
    )
  ) {
    return roundMoney(
      credit - debit
    );
  }

  if (
    isExpenseAccount(
      account
    )
  ) {
    return roundMoney(
      debit - credit
    );
  }

  return 0;
};

const buildMovementMap = (
  ledgerEntries,
  accountLookup
) => {
  const movements =
    new Map();

  let excludedYearEndCloseEntries =
    0;

  let excludedYearEndCloseDebit =
    0;

  let excludedYearEndCloseCredit =
    0;

  ledgerEntries.forEach(
    (
      entry
    ) => {
      if (
        isYearEndCloseEntry(
          entry
        )
      ) {
        excludedYearEndCloseEntries +=
          1;

        excludedYearEndCloseDebit =
          roundMoney(
            excludedYearEndCloseDebit +
              Number(
                entry.debit ||
                  0
              )
          );

        excludedYearEndCloseCredit =
          roundMoney(
            excludedYearEndCloseCredit +
              Number(
                entry.credit ||
                  0
              )
          );

        return;
      }

      const account =
        resolveEntryAccount(
          entry,
          accountLookup
        );

      if (
        !account ||
        (
          !isRevenueAccount(
            account
          ) &&
          !isExpenseAccount(
            account
          )
        )
      ) {
        return;
      }

      const key =
        String(
          account.id
        );

      const current =
        movements.get(
          key
        ) || {
          amount: 0,
          debit: 0,
          credit: 0,
          entryCount: 0,
          lastTransactionDate:
            "",
        };

      const entryAmount =
        calculateEntryAmount(
          account,
          entry
        );

      current.amount =
        roundMoney(
          current.amount +
            entryAmount
        );

      current.debit =
        roundMoney(
          current.debit +
            Number(
              entry.debit ||
                0
            )
        );

      current.credit =
        roundMoney(
          current.credit +
            Number(
              entry.credit ||
                0
            )
        );

      current.entryCount +=
        1;

      if (
        entry.date &&
        (
          !current.lastTransactionDate ||
          entry.date >
            current.lastTransactionDate
        )
      ) {
        current.lastTransactionDate =
          entry.date;
      }

      movements.set(
        key,
        current
      );
    }
  );

  return {
    movements,

    excludedYearEndCloseEntries,

    excludedYearEndCloseDebit:
      roundMoney(
        excludedYearEndCloseDebit
      ),

    excludedYearEndCloseCredit:
      roundMoney(
        excludedYearEndCloseCredit
      ),
  };
};

const createAccountRow = (
  account,
  movement = {}
) => {
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

    amount:
      roundMoney(
        movement.amount
      ),

    debit:
      roundMoney(
        movement.debit
      ),

    credit:
      roundMoney(
        movement.credit
      ),

    entryCount:
      Number(
        movement.entryCount ||
          0
      ),

    lastTransactionDate:
      movement.lastTransactionDate ||
      "",

    isOtherIncome:
      isOtherIncomeAccount(
        account
      ),

    isCostOfSales:
      isCostOfSalesAccount(
        account
      ),
  };
};

const sortRowsByCode = (
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
        first.code ||
          ""
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

const sumRows = (
  rows
) => {
  return roundMoney(
    rows.reduce(
      (
        total,
        row
      ) =>
        total +
        Number(
          row.amount || 0
        ),
      0
    )
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
    row.code,
    row.name,
    row.type,
    row.subtype,
    row.status,
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

const filterVisibleRows = (
  rows,
  searchValue,
  includeZeroBalances
) => {
  return rows.filter(
    (
      row
    ) => {
      if (
        !includeZeroBalances &&
        Math.abs(
          Number(
            row.amount || 0
          )
        ) <=
          MONEY_TOLERANCE
      ) {
        return false;
      }

      return rowMatchesSearch(
        row,
        searchValue
      );
    }
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

export const getProfitAndLoss =
  ({
    fromDate = "",
    toDate = "",
    search = "",
    includeZeroBalances =
      false,
  } = {}) => {
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
        "The Profit & Loss start date is invalid."
      );
    }

    if (
      toDate &&
      !resolvedToDate
    ) {
      throw new Error(
        "The Profit & Loss end date is invalid."
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

    const accounts =
      getAllAccounts();

    const accountLookup =
      getAccountLookup(
        accounts
      );

    /*
    |--------------------------------------------------------------------------
    | General Ledger is the accounting source of truth
    |--------------------------------------------------------------------------
    |
    | getGeneralLedger already handles:
    |
    | - manual journals
    | - system journals
    | - accountId / accountCode resolution
    | - reversals
    | - imported journals
    | - recurring journals
    | - invoices
    | - bills
    | - payments
    | - inventory
    | - fixed assets
    | - depreciation
    | - opening balances
    |
    | The P&L therefore only classifies ledger movements. It does not rebuild
    | accounting history directly from raw journal storage.
    |
    */

    const ledgerEntries =
      getGeneralLedger({
        search: "",

        accountId:
          "All",

        dateFrom:
          resolvedFromDate,

        dateTo:
          resolvedToDate,
      });

    const movementState =
      buildMovementMap(
        Array.isArray(
          ledgerEntries
        )
          ? ledgerEntries
          : [],
        accountLookup
      );

    const {
      movements,
    } = movementState;

    /*
    |--------------------------------------------------------------------------
    | Revenue / Income
    |--------------------------------------------------------------------------
    */

    const revenueRows =
      sortRowsByCode(
        accounts
          .filter(
            isRevenueAccount
          )
          .map(
            (
              account
            ) =>
              createAccountRow(
                account,
                movements.get(
                  String(
                    account.id
                  )
                )
              )
          )
      );

    /*
    |--------------------------------------------------------------------------
    | Cost of Sales
    |--------------------------------------------------------------------------
    */

    const costOfSalesRows =
      sortRowsByCode(
        accounts
          .filter(
            (
              account
            ) =>
              isExpenseAccount(
                account
              ) &&
              isCostOfSalesAccount(
                account
              )
          )
          .map(
            (
              account
            ) =>
              createAccountRow(
                account,
                movements.get(
                  String(
                    account.id
                  )
                )
              )
          )
      );

    /*
    |--------------------------------------------------------------------------
    | Operating Expenses
    |--------------------------------------------------------------------------
    */

    const operatingExpenseRows =
      sortRowsByCode(
        accounts
          .filter(
            (
              account
            ) =>
              isExpenseAccount(
                account
              ) &&
              !isCostOfSalesAccount(
                account
              )
          )
          .map(
            (
              account
            ) =>
              createAccountRow(
                account,
                movements.get(
                  String(
                    account.id
                  )
                )
              )
          )
      );

    /*
    |--------------------------------------------------------------------------
    | Informational Other Income subset
    |--------------------------------------------------------------------------
    |
    | revenueRows remains the complete Revenue/Income collection so the
    | existing Profit & Loss page remains fully compatible.
    |
    */

    const otherIncomeRows =
      revenueRows.filter(
        (
          row
        ) =>
          row.isOtherIncome
      );

    const operatingRevenueRows =
      revenueRows.filter(
        (
          row
        ) =>
          !row.isOtherIncome
      );

    /*
    |--------------------------------------------------------------------------
    | Full accounting totals
    |--------------------------------------------------------------------------
    |
    | These are calculated BEFORE search and zero-balance filters.
    |
    */

    const totalRevenue =
      sumRows(
        revenueRows
      );

    const totalOperatingRevenue =
      sumRows(
        operatingRevenueRows
      );

    const totalOtherIncome =
      sumRows(
        otherIncomeRows
      );

    const totalCostOfSales =
      sumRows(
        costOfSalesRows
      );

    const grossProfit =
      roundMoney(
        totalRevenue -
          totalCostOfSales
      );

    const totalOperatingExpenses =
      sumRows(
        operatingExpenseRows
      );

    const operatingProfit =
      roundMoney(
        grossProfit -
          totalOperatingExpenses
      );

    /*
    |--------------------------------------------------------------------------
    | Net Profit
    |--------------------------------------------------------------------------
    |
    | At the current Ledgify account structure, all Revenue/Income accounts
    | are included in totalRevenue and all non-Cost-of-Sales Expense accounts
    | are included in operating expenses.
    |
    | Therefore operatingProfit and netProfit are currently the same figure.
    | Keeping both fields makes the service ready for separate finance costs,
    | tax expense and exceptional sections later.
    |
    */

    const netProfit =
      operatingProfit;

    /*
    |--------------------------------------------------------------------------
    | Current Earnings reconciliation
    |--------------------------------------------------------------------------
    |
    | A positive P&L profit contributes positively to Balance Sheet Current
    | Earnings before a year-end close transfers it to Retained Earnings.
    |
    | A loss contributes negatively.
    |
    */

    const currentEarningsContribution =
      roundMoney(
        netProfit
      );

    const currentEarningsSignedBalance =
      roundMoney(
        -netProfit
      );

    /*
    |--------------------------------------------------------------------------
    | Presentation filters
    |--------------------------------------------------------------------------
    */

    const searchValue =
      normaliseText(
        search
      );

    const visibleRevenueRows =
      filterVisibleRows(
        revenueRows,
        searchValue,
        includeZeroBalances
      );

    const visibleCostOfSalesRows =
      filterVisibleRows(
        costOfSalesRows,
        searchValue,
        includeZeroBalances
      );

    const visibleOperatingExpenseRows =
      filterVisibleRows(
        operatingExpenseRows,
        searchValue,
        includeZeroBalances
      );

    /*
    |--------------------------------------------------------------------------
    | Visible totals
    |--------------------------------------------------------------------------
    |
    | These are informational only. Search must never alter the real P&L
    | totals displayed by the accounting report.
    |
    */

    const visibleTotalRevenue =
      sumRows(
        visibleRevenueRows
      );

    const visibleTotalCostOfSales =
      sumRows(
        visibleCostOfSalesRows
      );

    const visibleGrossProfit =
      roundMoney(
        visibleTotalRevenue -
          visibleTotalCostOfSales
      );

    const visibleTotalOperatingExpenses =
      sumRows(
        visibleOperatingExpenseRows
      );

    const visibleNetProfit =
      roundMoney(
        visibleGrossProfit -
          visibleTotalOperatingExpenses
      );

    return {
      fromDate:
        resolvedFromDate,

      toDate:
        resolvedToDate,

      /*
      |--------------------------------------------------------------------------
      | Existing row API
      |--------------------------------------------------------------------------
      */

      revenueRows:
        visibleRevenueRows,

      costOfSalesRows:
        visibleCostOfSalesRows,

      operatingExpenseRows:
        visibleOperatingExpenseRows,

      /*
      |--------------------------------------------------------------------------
      | Optional revenue detail
      |--------------------------------------------------------------------------
      */

      operatingRevenueRows:
        filterVisibleRows(
          operatingRevenueRows,
          searchValue,
          includeZeroBalances
        ),

      otherIncomeRows:
        filterVisibleRows(
          otherIncomeRows,
          searchValue,
          includeZeroBalances
        ),

      /*
      |--------------------------------------------------------------------------
      | Full accounting totals
      |--------------------------------------------------------------------------
      */

      totalRevenue,

      totalOperatingRevenue,

      totalOtherIncome,

      totalCostOfSales,

      grossProfit,

      totalOperatingExpenses,

      operatingProfit,

      netProfit,

      profitBeforeTax:
        netProfit,

      isProfitable:
        netProfit >= 0,

      /*
      |--------------------------------------------------------------------------
      | Balance Sheet / Current Earnings control
      |--------------------------------------------------------------------------
      */

      currentEarningsContribution,

      currentEarningsSignedBalance,

      /*
      |--------------------------------------------------------------------------
      | Visible/filter totals
      |--------------------------------------------------------------------------
      */

      visibleTotalRevenue,

      visibleTotalCostOfSales,

      visibleGrossProfit,

      visibleTotalOperatingExpenses,

      visibleNetProfit,

      searchActive:
        Boolean(
          searchValue
        ),

      includeZeroBalances:
        Boolean(
          includeZeroBalances
        ),

      accountCount:
        visibleRevenueRows.length +
        visibleCostOfSalesRows.length +
        visibleOperatingExpenseRows.length,

      totalAccountCount:
        revenueRows.length +
        costOfSalesRows.length +
        operatingExpenseRows.length,

      /*
      |--------------------------------------------------------------------------
      | Year-end close diagnostics
      |--------------------------------------------------------------------------
      */

      excludedYearEndCloseEntries:
        movementState.excludedYearEndCloseEntries,

      excludedYearEndCloseDebit:
        movementState.excludedYearEndCloseDebit,

      excludedYearEndCloseCredit:
        movementState.excludedYearEndCloseCredit,

      yearEndCloseExcluded:
        movementState.excludedYearEndCloseEntries >
        0,
    };
  };

export const exportProfitAndLossCsv =
  (
    options = {}
  ) => {
    const report =
      getProfitAndLoss(
        options
      );

    const searchValue =
      String(
        options.search || ""
      ).trim();

    const rows = [
      [
        "Profit and Loss",
        "",
        "",
      ],

      [
        "From",
        report.fromDate ||
          "",
        "",
      ],

      [
        "To",
        report.toDate ||
          "",
        "",
      ],

      [
        "Search",
        searchValue,
        "",
      ],

      [
        "Include zero balances",
        report.includeZeroBalances
          ? "Yes"
          : "No",
        "",
      ],

      [
        "",
        "",
        "",
      ],

      [
        "Revenue and Income",
        "",
        "",
      ],

      ...report.revenueRows.map(
        (
          row
        ) => [
          row.code,
          row.name,
          row.amount.toFixed(
            2
          ),
        ]
      ),

      [
        "",
        "Total Revenue and Income",
        report.totalRevenue.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
      ],

      [
        "Cost of Sales",
        "",
        "",
      ],

      ...report.costOfSalesRows.map(
        (
          row
        ) => [
          row.code,
          row.name,
          row.amount.toFixed(
            2
          ),
        ]
      ),

      [
        "",
        "Total Cost of Sales",
        report.totalCostOfSales.toFixed(
          2
        ),
      ],

      [
        "",
        "Gross Profit",
        report.grossProfit.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
      ],

      [
        "Operating Expenses",
        "",
        "",
      ],

      ...report.operatingExpenseRows.map(
        (
          row
        ) => [
          row.code,
          row.name,
          row.amount.toFixed(
            2
          ),
        ]
      ),

      [
        "",
        "Total Operating Expenses",
        report.totalOperatingExpenses.toFixed(
          2
        ),
      ],

      [
        "",
        "Operating Profit",
        report.operatingProfit.toFixed(
          2
        ),
      ],

      [
        "",
        "Net Profit / (Loss)",
        report.netProfit.toFixed(
          2
        ),
      ],
    ];

    if (
      report.searchActive
    ) {
      rows.push(
        [
          "",
          "",
          "",
        ],

        [
          "Visible search results",
          "",
          "",
        ],

        [
          "",
          "Visible Revenue",
          report.visibleTotalRevenue.toFixed(
            2
          ),
        ],

        [
          "",
          "Visible Cost of Sales",
          report.visibleTotalCostOfSales.toFixed(
            2
          ),
        ],

        [
          "",
          "Visible Operating Expenses",
          report.visibleTotalOperatingExpenses.toFixed(
            2
          ),
        ],

        [
          "",
          "Visible Net Profit / (Loss)",
          report.visibleNetProfit.toFixed(
            2
          ),
        ]
      );
    }

    rows.push(
      [
        "",
        "",
        "",
      ],

      [
        "Accounting Controls",
        "",
        "",
      ],

      [
        "",
        "Current Earnings contribution",
        report.currentEarningsContribution.toFixed(
          2
        ),
      ],

      [
        "",
        "Year-end closing entries excluded",
        String(
          report.excludedYearEndCloseEntries
        ),
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