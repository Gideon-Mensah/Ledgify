import {
  getAccounts,
} from "./accountService";

import {
  getTrialBalance,
} from "./trialBalanceService";

const MONEY_TOLERANCE =
  0.005;

const CURRENT_EARNINGS_ID =
  "system-current-earnings";

const CURRENT_EARNINGS_CODE =
  "699";

const CURRENT_EARNINGS_NAME =
  "Current Earnings";

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

const enrichTrialBalanceRow = (
  row,
  accountLookup
) => {
  const account =
    accountLookup.byId.get(
      String(
        row.accountId
      )
    ) ||
    accountLookup.byCode.get(
      String(
        row.code
      )
    ) ||
    null;

  return {
    ...(account || {}),

    ...row,

    accountId:
      row.accountId ??
      account?.id,

    code:
      row.code ??
      account?.code,

    name:
      row.name ||
      account?.name ||
      "Unnamed account",

    type:
      row.type ||
      account?.type ||
      "",

    subtype:
      row.subtype ||
      account?.subtype ||
      "",

    description:
      account?.description ||
      "",

    status:
      row.status ||
      account?.status ||
      "Active",

    signedBalance:
      roundMoney(
        row.signedBalance
      ),

    debit:
      roundMoney(
        row.debit
      ),

    credit:
      roundMoney(
        row.credit
      ),
  };
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

const isAssetAccount = (
  account
) => {
  const typeText =
    getAccountTypeText(
      account
    );

  return (
    typeText ===
      "asset" ||
    typeText.includes(
      " asset"
    ) ||
    typeText.startsWith(
      "asset "
    )
  );
};

const isLiabilityAccount = (
  account
) => {
  const typeText =
    getAccountTypeText(
      account
    );

  return (
    typeText ===
      "liability" ||
    typeText.includes(
      "liability"
    )
  );
};

const isEquityAccount = (
  account
) => {
  const typeText =
    getAccountTypeText(
      account
    );

  return (
    typeText ===
      "equity" ||
    typeText.includes(
      "equity"
    ) ||
    typeText.includes(
      "capital"
    )
  );
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

const getClassificationText = (
  account
) => {
  return [
    account?.name,
    account?.type,
    account?.subtype,
    account?.description,
    account?.classification,
    account?.balanceSheetSection,
    account?.category,
    account?.group,
  ]
    .filter(Boolean)
    .map(
      normaliseText
    )
    .join(" ");
};

const isCurrentAsset = (
  account
) => {
  /*
  |--------------------------------------------------------------------------
  | Explicit account configuration takes priority
  |--------------------------------------------------------------------------
  */

  if (
    account?.isCurrent ===
    true
  ) {
    return true;
  }

  if (
    account?.isCurrent ===
    false
  ) {
    return false;
  }

  const text =
    getClassificationText(
      account
    );

  const nonCurrentKeywords = [
    "non-current",
    "non current",
    "fixed asset",
    "property plant",
    "property, plant",
    "ppe",
    "equipment",
    "vehicle",
    "motor vehicle",
    "furniture",
    "fixture",
    "intangible",
    "goodwill",
    "accumulated depreciation",
    "long-term asset",
    "long term asset",
  ];

  if (
    nonCurrentKeywords.some(
      (
        keyword
      ) =>
        text.includes(
          keyword
        )
    )
  ) {
    return false;
  }

  const currentKeywords = [
    "current asset",
    "bank",
    "cash",
    "receivable",
    "debtor",
    "inventory",
    "stock",
    "prepayment",
    "prepaid",
    "short-term deposit",
    "short term deposit",
  ];

  if (
    currentKeywords.some(
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
  | Current assets currently occupy codes such as:
  |
  | 100 Bank
  | 110 Accounts Receivable
  | 120 Inventory
  |
  | Fixed assets start around:
  |
  | 150 Fixed Assets
  | 151 Accumulated Depreciation
  |
  */

  const code =
    Number(
      account?.code
    );

  if (
    Number.isFinite(
      code
    )
  ) {
    if (
      code >= 150 &&
      code < 200
    ) {
      return false;
    }

    if (
      code >= 100 &&
      code < 150
    ) {
      return true;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Conservative default
  |--------------------------------------------------------------------------
  */

  return true;
};

const isCurrentLiability = (
  account
) => {
  if (
    account?.isCurrent ===
    true
  ) {
    return true;
  }

  if (
    account?.isCurrent ===
    false
  ) {
    return false;
  }

  const text =
    getClassificationText(
      account
    );

  const nonCurrentKeywords = [
    "non-current",
    "non current",
    "long-term",
    "long term",
    "mortgage",
    "long-term loan",
    "long term loan",
    "lease liability non-current",
    "lease liability non current",
  ];

  if (
    nonCurrentKeywords.some(
      (
        keyword
      ) =>
        text.includes(
          keyword
        )
    )
  ) {
    return false;
  }

  const currentKeywords = [
    "current liability",
    "payable",
    "creditor",
    "vat",
    "tax",
    "payroll",
    "wages",
    "accrual",
    "short-term",
    "short term",
    "credit card",
    "clearing",
  ];

  if (
    currentKeywords.some(
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

  const code =
    Number(
      account?.code
    );

  if (
    Number.isFinite(
      code
    )
  ) {
    if (
      code >= 200 &&
      code < 250
    ) {
      return true;
    }
  }

  return false;
};

const createBalanceSheetRow = (
  account,
  section
) => {
  const signedBalance =
    roundMoney(
      account.signedBalance
    );

  /*
  |--------------------------------------------------------------------------
  | Trial Balance sign convention
  |--------------------------------------------------------------------------
  |
  | Positive signedBalance = Debit
  | Negative signedBalance = Credit
  |
  | Assets are normally debit balances, so their Balance Sheet amount follows
  | the signed Trial Balance amount.
  |
  | Liabilities and Equity are normally credit balances, so their Balance
  | Sheet presentation amount is the inverse of the signed Trial Balance
  | amount.
  |
  | A balance on the opposite side remains negative rather than being hidden.
  |
  */

  const amount =
    section === "asset"
      ? signedBalance
      : roundMoney(
          -signedBalance
        );

  return {
    accountId:
      account.accountId,

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

    amount,

    signedBalance,

    debit:
      roundMoney(
        account.debit
      ),

    credit:
      roundMoney(
        account.credit
      ),

    balanceSide:
      account.balanceSide ||
      (
        signedBalance >
        MONEY_TOLERANCE
          ? "Debit"
          : signedBalance <
              -MONEY_TOLERANCE
            ? "Credit"
            : "Zero"
      ),

    isDerived:
      Boolean(
        account.isDerived
      ),

    ledgerEntryCount:
      Number(
        account.ledgerEntryCount ||
          0
      ),

    lastTransactionDate:
      account.lastTransactionDate ||
      "",
  };
};

const createCurrentEarningsRow = (
  currentEarnings
) => {
  return {
    accountId:
      CURRENT_EARNINGS_ID,

    code:
      CURRENT_EARNINGS_CODE,

    name:
      CURRENT_EARNINGS_NAME,

    type:
      "Equity",

    subtype:
      "Unclosed profit or loss",

    status:
      "System",

    amount:
      roundMoney(
        currentEarnings
      ),

    signedBalance:
      roundMoney(
        -currentEarnings
      ),

    debit:
      currentEarnings <
      -MONEY_TOLERANCE
        ? Math.abs(
            roundMoney(
              currentEarnings
            )
          )
        : 0,

    credit:
      currentEarnings >
      MONEY_TOLERANCE
        ? roundMoney(
            currentEarnings
          )
        : 0,

    balanceSide:
      currentEarnings >
      MONEY_TOLERANCE
        ? "Credit"
        : currentEarnings <
            -MONEY_TOLERANCE
          ? "Debit"
          : "Zero",

    isDerived: true,

    ledgerEntryCount: 0,

    lastTransactionDate:
      "",
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

export const getBalanceSheet =
  ({
    asOfDate = "",
    search = "",
    includeZeroBalances =
      false,
  } = {}) => {
    const resolvedAsOfDate =
      normaliseDate(
        asOfDate
      );

    if (
      asOfDate &&
      !resolvedAsOfDate
    ) {
      throw new Error(
        "The Balance Sheet reporting date is invalid."
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Trial Balance is the Balance Sheet source of truth
    |--------------------------------------------------------------------------
    |
    | Trial Balance already obtains its balances from the General Ledger.
    |
    | We deliberately request:
    |
    | - no search
    | - all zero balances
    |
    | so presentation filters cannot affect accounting totals.
    |
    */

    const trialBalance =
      getTrialBalance({
        asOfDate:
          resolvedAsOfDate,

        search: "",

        includeZeroBalances:
          true,
      });

    const accounts =
      getAllAccounts();

    const accountLookup =
      getAccountLookup(
        accounts
      );

    const trialBalanceRows =
      (
        Array.isArray(
          trialBalance.rows
        )
          ? trialBalance.rows
          : []
      ).map(
        (
          row
        ) =>
          enrichTrialBalanceRow(
            row,
            accountLookup
          )
      );

    /*
    |--------------------------------------------------------------------------
    | Balance Sheet classifications
    |--------------------------------------------------------------------------
    */

    const assetAccounts =
      trialBalanceRows.filter(
        isAssetAccount
      );

    const liabilityAccounts =
      trialBalanceRows.filter(
        isLiabilityAccount
      );

    const equityAccounts =
      trialBalanceRows.filter(
        isEquityAccount
      );

    const revenueAccounts =
      trialBalanceRows.filter(
        isRevenueAccount
      );

    const expenseAccounts =
      trialBalanceRows.filter(
        isExpenseAccount
      );

    const currentAssetRows =
      sortRowsByCode(
        assetAccounts
          .filter(
            isCurrentAsset
          )
          .map(
            (
              account
            ) =>
              createBalanceSheetRow(
                account,
                "asset"
              )
          )
      );

    const nonCurrentAssetRows =
      sortRowsByCode(
        assetAccounts
          .filter(
            (
              account
            ) =>
              !isCurrentAsset(
                account
              )
          )
          .map(
            (
              account
            ) =>
              createBalanceSheetRow(
                account,
                "asset"
              )
          )
      );

    const currentLiabilityRows =
      sortRowsByCode(
        liabilityAccounts
          .filter(
            isCurrentLiability
          )
          .map(
            (
              account
            ) =>
              createBalanceSheetRow(
                account,
                "liability"
              )
          )
      );

    const nonCurrentLiabilityRows =
      sortRowsByCode(
        liabilityAccounts
          .filter(
            (
              account
            ) =>
              !isCurrentLiability(
                account
              )
          )
          .map(
            (
              account
            ) =>
              createBalanceSheetRow(
                account,
                "liability"
              )
          )
      );

    let equityRows =
      equityAccounts.map(
        (
          account
        ) =>
          createBalanceSheetRow(
            account,
            "equity"
          )
      );

    /*
    |--------------------------------------------------------------------------
    | Current earnings
    |--------------------------------------------------------------------------
    |
    | Revenue and expense accounts belong to the Profit & Loss statement,
    | not directly to the Balance Sheet.
    |
    | Before a year-end closing journal is posted, their cumulative net
    | balance must nevertheless appear within Equity so:
    |
    |   Assets = Liabilities + Equity
    |
    | Trial Balance signed convention:
    |
    |   Debit  = positive
    |   Credit = negative
    |
    | Therefore:
    |
    |   current earnings = -(Revenue + Expense signed balances)
    |
    | Examples:
    |
    | Revenue credit £10,000  = -10,000
    | Expense debit £4,000    = +4,000
    |
    | Signed P&L total        = -6,000
    | Current Earnings        = +6,000
    |
    | Once the year-end journal zeros revenue and expense and moves the
    | result into Retained Earnings, Current Earnings naturally becomes zero.
    |
    */

    const profitAndLossSignedBalance =
      roundMoney(
        [
          ...revenueAccounts,
          ...expenseAccounts,
        ].reduce(
          (
            total,
            account
          ) =>
            total +
            Number(
              account.signedBalance ||
                0
            ),
          0
        )
      );

    const currentEarnings =
      roundMoney(
        -profitAndLossSignedBalance
      );

    const currentEarningsRow =
      createCurrentEarningsRow(
        currentEarnings
      );

    equityRows.push(
      currentEarningsRow
    );

    equityRows =
      sortRowsByCode(
        equityRows
      );

    /*
    |--------------------------------------------------------------------------
    | Revenue / expense diagnostics
    |--------------------------------------------------------------------------
    */

    const totalRevenue =
      roundMoney(
        revenueAccounts.reduce(
          (
            total,
            account
          ) =>
            total -
            Number(
              account.signedBalance ||
                0
            ),
          0
        )
      );

    const totalExpenses =
      roundMoney(
        expenseAccounts.reduce(
          (
            total,
            account
          ) =>
            total +
            Number(
              account.signedBalance ||
                0
            ),
          0
        )
      );

    /*
    |--------------------------------------------------------------------------
    | Full accounting totals
    |--------------------------------------------------------------------------
    |
    | These totals are calculated BEFORE search and zero-balance filters.
    |
    */

    const totalCurrentAssets =
      sumRows(
        currentAssetRows
      );

    const totalNonCurrentAssets =
      sumRows(
        nonCurrentAssetRows
      );

    const totalAssets =
      roundMoney(
        totalCurrentAssets +
          totalNonCurrentAssets
      );

    const totalCurrentLiabilities =
      sumRows(
        currentLiabilityRows
      );

    const totalNonCurrentLiabilities =
      sumRows(
        nonCurrentLiabilityRows
      );

    const totalLiabilities =
      roundMoney(
        totalCurrentLiabilities +
          totalNonCurrentLiabilities
      );

    const totalEquity =
      sumRows(
        equityRows
      );

    const totalLiabilitiesAndEquity =
      roundMoney(
        totalLiabilities +
          totalEquity
      );

    const difference =
      roundMoney(
        totalAssets -
          totalLiabilitiesAndEquity
      );

    /*
    |--------------------------------------------------------------------------
    | Unclassified non-zero accounts
    |--------------------------------------------------------------------------
    |
    | Never silently discard a non-zero account whose Chart of Accounts type
    | is unknown.
    |
    | These rows are returned for diagnostics. Their existence will normally
    | also cause the Balance Sheet not to reconcile.
    |
    */

    const classifiedIds =
      new Set(
        [
          ...assetAccounts,
          ...liabilityAccounts,
          ...equityAccounts,
          ...revenueAccounts,
          ...expenseAccounts,
        ].map(
          (
            account
          ) =>
            String(
              account.accountId ??
                account.code
            )
        )
      );

    const unclassifiedRows =
      trialBalanceRows.filter(
        (
          account
        ) => {
          const key =
            String(
              account.accountId ??
                account.code
            );

          return (
            !classifiedIds.has(
              key
            ) &&
            Math.abs(
              Number(
                account.signedBalance ||
                  0
              )
            ) >
              MONEY_TOLERANCE
          );
        }
      );

    const unclassifiedSignedBalance =
      roundMoney(
        unclassifiedRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.signedBalance ||
                0
            ),
          0
        )
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

    const visibleCurrentAssetRows =
      filterVisibleRows(
        currentAssetRows,
        searchValue,
        includeZeroBalances
      );

    const visibleNonCurrentAssetRows =
      filterVisibleRows(
        nonCurrentAssetRows,
        searchValue,
        includeZeroBalances
      );

    const visibleCurrentLiabilityRows =
      filterVisibleRows(
        currentLiabilityRows,
        searchValue,
        includeZeroBalances
      );

    const visibleNonCurrentLiabilityRows =
      filterVisibleRows(
        nonCurrentLiabilityRows,
        searchValue,
        includeZeroBalances
      );

    const visibleEquityRows =
      filterVisibleRows(
        equityRows,
        searchValue,
        includeZeroBalances
      );

    const visibleUnclassifiedRows =
      filterVisibleRows(
        unclassifiedRows.map(
          (
            row
          ) => ({
            ...row,

            amount:
              roundMoney(
                row.signedBalance
              ),
          })
        ),
        searchValue,
        includeZeroBalances
      );

    return {
      asOfDate:
        resolvedAsOfDate,

      /*
      |--------------------------------------------------------------------------
      | Visible report rows
      |--------------------------------------------------------------------------
      */

      currentAssetRows:
        visibleCurrentAssetRows,

      nonCurrentAssetRows:
        visibleNonCurrentAssetRows,

      currentLiabilityRows:
        visibleCurrentLiabilityRows,

      nonCurrentLiabilityRows:
        visibleNonCurrentLiabilityRows,

      equityRows:
        visibleEquityRows,

      /*
      |--------------------------------------------------------------------------
      | Full accounting totals
      |--------------------------------------------------------------------------
      */

      totalCurrentAssets,

      totalNonCurrentAssets,

      totalAssets,

      totalCurrentLiabilities,

      totalNonCurrentLiabilities,

      totalLiabilities,

      totalRevenue,

      totalExpenses,

      currentEarnings,

      totalEquity,

      totalLiabilitiesAndEquity,

      difference,

      isBalanced:
        Math.abs(
          difference
        ) <=
          MONEY_TOLERANCE &&
        Boolean(
          trialBalance.isBalanced
        ) &&
        unclassifiedRows.length ===
          0,

      /*
      |--------------------------------------------------------------------------
      | Trial Balance integrity
      |--------------------------------------------------------------------------
      */

      trialBalanceDebit:
        roundMoney(
          trialBalance.totalDebit
        ),

      trialBalanceCredit:
        roundMoney(
          trialBalance.totalCredit
        ),

      trialBalanceDifference:
        roundMoney(
          trialBalance.difference
        ),

      trialBalanceIsBalanced:
        Boolean(
          trialBalance.isBalanced
        ),

      openingBalanceAdjustment:
        roundMoney(
          trialBalance.openingBalanceAdjustment
        ),

      hasOpeningBalanceAdjustment:
        Boolean(
          trialBalance.hasOpeningBalanceAdjustment
        ),

      /*
      |--------------------------------------------------------------------------
      | Filter information
      |--------------------------------------------------------------------------
      */

      searchActive:
        Boolean(
          searchValue
        ),

      includeZeroBalances:
        Boolean(
          includeZeroBalances
        ),

      visibleAccountCount:
        visibleCurrentAssetRows.length +
        visibleNonCurrentAssetRows.length +
        visibleCurrentLiabilityRows.length +
        visibleNonCurrentLiabilityRows.length +
        visibleEquityRows.length,

      /*
      |--------------------------------------------------------------------------
      | Diagnostic information
      |--------------------------------------------------------------------------
      */

      unclassifiedRows:
        visibleUnclassifiedRows,

      unclassifiedAccountCount:
        unclassifiedRows.length,

      unclassifiedSignedBalance,

      hasUnclassifiedBalances:
        unclassifiedRows.length >
        0,
    };
  };

export const exportBalanceSheetCsv =
  (
    options = {}
  ) => {
    const report =
      getBalanceSheet(
        options
      );

    const searchValue =
      String(
        options.search || ""
      ).trim();

    const createRows = (
      title,
      rows,
      totalLabel,
      totalAmount
    ) => {
      return [
        [
          title,
          "",
          "",
        ],

        ...rows.map(
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
          totalLabel,
          totalAmount.toFixed(
            2
          ),
        ],

        [
          "",
          "",
          "",
        ],
      ];
    };

    const rows = [
      [
        "Balance Sheet",
        "",
        "",
      ],

      [
        "As at",
        report.asOfDate ||
          "",
        "",
      ],

      [
        "Status",
        report.isBalanced
          ? "Balanced"
          : "Out of balance",
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

      ...createRows(
        "Current Assets",
        report.currentAssetRows,
        "Total Current Assets",
        report.totalCurrentAssets
      ),

      ...createRows(
        "Non-current Assets",
        report.nonCurrentAssetRows,
        "Total Non-current Assets",
        report.totalNonCurrentAssets
      ),

      [
        "",
        "Total Assets",
        report.totalAssets.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
      ],

      ...createRows(
        "Current Liabilities",
        report.currentLiabilityRows,
        "Total Current Liabilities",
        report.totalCurrentLiabilities
      ),

      ...createRows(
        "Non-current Liabilities",
        report.nonCurrentLiabilityRows,
        "Total Non-current Liabilities",
        report.totalNonCurrentLiabilities
      ),

      [
        "",
        "Total Liabilities",
        report.totalLiabilities.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
      ],

      ...createRows(
        "Equity",
        report.equityRows,
        "Total Equity",
        report.totalEquity
      ),

      [
        "",
        "Current Earnings",
        report.currentEarnings.toFixed(
          2
        ),
      ],

      [
        "",
        "Total Liabilities and Equity",
        report.totalLiabilitiesAndEquity.toFixed(
          2
        ),
      ],

      [
        "",
        "Balance Sheet Difference",
        report.difference.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
      ],

      [
        "Trial Balance control",
        "",
        "",
      ],

      [
        "",
        "Trial Balance debits",
        report.trialBalanceDebit.toFixed(
          2
        ),
      ],

      [
        "",
        "Trial Balance credits",
        report.trialBalanceCredit.toFixed(
          2
        ),
      ],

      [
        "",
        "Trial Balance difference",
        report.trialBalanceDifference.toFixed(
          2
        ),
      ],
    ];

    if (
      report.hasUnclassifiedBalances
    ) {
      rows.push(
        [
          "",
          "",
          "",
        ],

        [
          "Unclassified accounts",
          "",
          "",
        ],

        ...report.unclassifiedRows.map(
          (
            row
          ) => [
            row.code,
            row.name,
            Number(
              row.signedBalance ||
                0
            ).toFixed(
              2
            ),
          ]
        ),

        [
          "",
          "Unclassified signed balance",
          report.unclassifiedSignedBalance.toFixed(
            2
          ),
        ]
      );
    }

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