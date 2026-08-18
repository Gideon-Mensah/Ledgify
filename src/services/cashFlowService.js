import {
  getAccounts,
} from "./accountService";

import {
  getGeneralLedger,
} from "./generalLedgerService";

const MONEY_TOLERANCE =
  0.005;

/*
|--------------------------------------------------------------------------
| General helpers
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Account lookup
|--------------------------------------------------------------------------
*/

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
    const account =
      accountLookup.byId.get(
        String(
          entry.accountId
        )
      );

    if (
      account
    ) {
      return account;
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

const getAccountText = (
  account
) => {
  return [
    account?.name,
    account?.type,
    account?.accountType,
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

/*
|--------------------------------------------------------------------------
| Cash / bank account detection
|--------------------------------------------------------------------------
*/

const isCashAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  if (
    account.isCashAccount ===
      true ||
    account.isBankAccount ===
      true
  ) {
    return true;
  }

  if (
    account.bankAccountId ||
    account.linkedBankAccountId ||
    account.bankFeedAccountId
  ) {
    return true;
  }

  const code =
    String(
      account.code ||
        ""
    ).trim();

  /*
  |--------------------------------------------------------------------------
  | Ledgify bank account range
  |--------------------------------------------------------------------------
  |
  | 100 = default Bank
  | 101–109 = additional bank/cash accounts
  | 110 = Accounts Receivable
  |
  */

  const numericCode =
    Number(code);

  if (
    Number.isInteger(
      numericCode
    ) &&
    numericCode >= 100 &&
    numericCode < 110
  ) {
    return true;
  }

  const typeValues =
    [
      account.type,
      account.accountType,
      account.subtype,
      account.classification,
      account.category,
      account.group,
    ]
      .filter(Boolean)
      .map(
        normaliseText
      );

  const directCashTypes = [
    "bank",
    "bank account",
    "cash",
    "cash account",
    "cash and cash equivalents",
    "cash equivalent",
    "petty cash",
    "current account",
    "savings account",
  ];

  if (
    typeValues.some(
      (
        value
      ) =>
        directCashTypes.includes(
          value
        )
    )
  ) {
    return true;
  }

  const text =
    getAccountText(
      account
    );

  /*
  |--------------------------------------------------------------------------
  | False-positive protection
  |--------------------------------------------------------------------------
  */

  const clearlyNonCashType =
    typeValues.some(
      (
        value
      ) =>
        [
          "expense",
          "expenses",
          "liability",
          "liabilities",
          "equity",
          "revenue",
          "income",
          "sales",
          "cost of sales",
          "cost of goods sold",
          "cogs",
        ].includes(
          value
        )
    );

  if (
    clearlyNonCashType
  ) {
    return false;
  }

  const assetLike =
    typeValues.some(
      (
        value
      ) =>
        value === "asset" ||
        value === "assets" ||
        value ===
          "current asset" ||
        value ===
          "current assets" ||
        value.includes(
          "current asset"
        ) ||
        value.includes(
          "cash equivalent"
        )
    );

  if (
    !assetLike
  ) {
    return false;
  }

  const cashKeywords = [
    "bank account",
    "business bank",
    "business current account",
    "current account",
    "savings account",
    "deposit account",
    "cash account",
    "cash at bank",
    "cash in bank",
    "cash in hand",
    "petty cash",
    "cash and cash equivalents",
    "cash equivalent",
    "checking account",
    "cheque account",
  ];

  if (
    cashKeywords.some(
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
  | Generic bank-name fallback
  |--------------------------------------------------------------------------
  |
  | At this point the account is already asset-like.
  |
  */

  return text.includes(
    "bank"
  );
};

/*
|--------------------------------------------------------------------------
| Investing account classification
|--------------------------------------------------------------------------
*/

const isInvestingAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  if (
    isCashAccount(
      account
    )
  ) {
    return false;
  }

  const text =
    getAccountText(
      account
    );

  const exclusions = [
    "inventory",
    "stock",
    "receivable",
    "debtor",
    "prepayment",
    "prepaid",
    "vat",
  ];

  if (
    exclusions.some(
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

  const keywords = [
    "fixed asset",
    "non-current asset",
    "non current asset",
    "property",
    "building",
    "plant",
    "equipment",
    "machinery",
    "vehicle",
    "motor vehicle",
    "computer",
    "furniture",
    "fixture",
    "investment",
    "intangible",
    "goodwill",
    "leasehold improvement",
  ];

  if (
    keywords.some(
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
  | Ledgify fixed asset account range
  |--------------------------------------------------------------------------
  */

  const code =
    Number(
      account.code
    );

  return (
    Number.isFinite(
      code
    ) &&
    code >= 150 &&
    code < 200
  );
};

/*
|--------------------------------------------------------------------------
| Financing account classification
|--------------------------------------------------------------------------
*/

const isFinancingAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  const typeValues =
    [
      account.type,
      account.accountType,
      account.category,
      account.group,
      account.classification,
    ]
      .filter(Boolean)
      .map(
        normaliseText
      );

  const text =
    getAccountText(
      account
    );

  /*
  |--------------------------------------------------------------------------
  | Equity
  |--------------------------------------------------------------------------
  */

  if (
    typeValues.some(
      (
        value
      ) =>
        value ===
          "equity" ||
        value ===
          "capital"
    )
  ) {
    return true;
  }

  const keywords = [
    "loan",
    "borrowing",
    "mortgage",
    "finance lease",
    "hire purchase",
    "lease liability",
    "share capital",
    "share premium",
    "owner capital",
    "owner contribution",
    "director loan",
    "shareholder loan",
    "dividend",
    "drawings",
    "capital introduced",
  ];

  if (
    keywords.some(
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
  | Ledgify long-term financing range
  |--------------------------------------------------------------------------
  */

  const liabilityLike =
    typeValues.some(
      (
        value
      ) =>
        value ===
          "liability" ||
        value ===
          "liabilities" ||
        value.includes(
          "non-current liability"
        ) ||
        value.includes(
          "non current liability"
        ) ||
        value.includes(
          "long-term liability"
        ) ||
        value.includes(
          "long term liability"
        )
    );

  if (
    liabilityLike
  ) {
    const code =
      Number(
        account.code
      );

    return (
      Number.isFinite(
        code
      ) &&
      code >= 250 &&
      code < 300
    );
  }

  return false;
};

const classifyAccountForCashFlow =
  (
    account
  ) => {
    if (
      isInvestingAccount(
        account
      )
    ) {
      return "investing";
    }

    if (
      isFinancingAccount(
        account
      )
    ) {
      return "financing";
    }

    return "operating";
  };

/*
|--------------------------------------------------------------------------
| Mixed-journal cash allocation
|--------------------------------------------------------------------------
*/

const allocateCashMovement = ({
  counterpartEntries,
  accountLookup,
  netCashAmount,
}) => {
  const absoluteCashAmount =
    Math.abs(
      roundMoney(
        netCashAmount
      )
    );

  if (
    absoluteCashAmount <=
    MONEY_TOLERANCE
  ) {
    return [];
  }

  /*
  |--------------------------------------------------------------------------
  | Which counterpart side explains the external cash movement?
  |--------------------------------------------------------------------------
  |
  | Cash inflow:
  |
  |   Dr Bank
  |      Cr Revenue / Loan / Asset disposal
  |
  | Therefore credits explain the cash inflow.
  |
  | Cash outflow:
  |
  |   Dr Expense / Asset / Loan
  |      Cr Bank
  |
  | Therefore debits explain the cash outflow.
  |
  | Looking only at this opposing side prevents non-cash funding legs from
  | being incorrectly reported as cash flows.
  |
  */

  const relevantSide =
    netCashAmount > 0
      ? "credit"
      : "debit";

  const scores = {
    operating: 0,
    investing: 0,
    financing: 0,
  };

  const categoryAccounts = {
    operating:
      new Map(),

    investing:
      new Map(),

    financing:
      new Map(),
  };

  counterpartEntries.forEach(
    (
      entry
    ) => {
      const relevantAmount =
        roundMoney(
          Number(
            entry[
              relevantSide
            ] || 0
          )
        );

      if (
        relevantAmount <=
        MONEY_TOLERANCE
      ) {
        return;
      }

      const account =
        resolveEntryAccount(
          entry,
          accountLookup
        );

      /*
      |--------------------------------------------------------------------------
      | Unresolved counterpart account
      |--------------------------------------------------------------------------
      |
      | Preserve existing Ledgify behaviour by treating an unresolved
      | counterpart as operating rather than dropping part of the cash flow.
      |
      */

      const category =
        account
          ? classifyAccountForCashFlow(
              account
            )
          : "operating";

      scores[
        category
      ] =
        roundMoney(
          scores[
            category
          ] +
            relevantAmount
        );

      const accountKey =
        String(
          account?.id ||
            entry.accountId ||
            account?.code ||
            entry.accountCode ||
            "unresolved"
        );

      const existing =
        categoryAccounts[
          category
        ].get(
          accountKey
        ) || {
          id:
            account?.id ||
            entry.accountId ||
            null,

          code:
            account?.code ||
            entry.accountCode ||
            "",

          name:
            account?.name ||
            entry.accountName ||
            "Unresolved account",

          amount: 0,
        };

      existing.amount =
        roundMoney(
          existing.amount +
            relevantAmount
        );

      categoryAccounts[
        category
      ].set(
        accountKey,
        existing
      );
    }
  );

  const weightedCategories =
    Object.entries(
      scores
    ).filter(
      (
        [
          ,
          weight,
        ]
      ) =>
        weight >
        MONEY_TOLERANCE
    );

  const totalWeight =
    roundMoney(
      weightedCategories.reduce(
        (
          total,
          [
            ,
            weight,
          ]
        ) =>
          total +
          weight,
        0
      )
    );

  /*
  |--------------------------------------------------------------------------
  | Fallback
  |--------------------------------------------------------------------------
  |
  | A balanced journal with a non-zero cash movement should normally have
  | counterpart entries on the opposing side. If legacy/corrupt data does
  | not, keep the cash movement visible as Operating rather than losing it.
  |
  */

  if (
    totalWeight <=
    MONEY_TOLERANCE
  ) {
    return [
      {
        category:
          "operating",

        amount:
          roundMoney(
            netCashAmount
          ),

        weight:
          absoluteCashAmount,

        percentage:
          100,

        classificationScores:
          scores,

        counterpartAccounts:
          [],
      },
    ];
  }

  const direction =
    netCashAmount >
    0
      ? 1
      : -1;

  let allocatedSoFar =
    0;

  return weightedCategories.map(
    (
      [
        category,
        weight,
      ],
      index
    ) => {
      const isLast =
        index ===
        weightedCategories.length -
          1;

      let allocatedAmount;

      if (
        isLast
      ) {
        /*
        |--------------------------------------------------------------------------
        | Rounding remainder
        |--------------------------------------------------------------------------
        |
        | Always force the final allocation to make the journal's allocated
        | cash movement equal the actual GL cash movement exactly.
        |
        */

        allocatedAmount =
          roundMoney(
            netCashAmount -
              allocatedSoFar
          );
      } else {
        allocatedAmount =
          roundMoney(
            direction *
              absoluteCashAmount *
              (
                weight /
                totalWeight
              )
          );

        allocatedSoFar =
          roundMoney(
            allocatedSoFar +
              allocatedAmount
          );
      }

      return {
        category,

        amount:
          allocatedAmount,

        weight:
          roundMoney(
            weight
          ),

        percentage:
          roundMoney(
            (
              weight /
              totalWeight
            ) *
              100
          ),

        classificationScores: {
          ...scores,
        },

        counterpartAccounts:
          [
            ...categoryAccounts[
              category
            ].values(),
          ],
      };
    }
  );
};

/*
|--------------------------------------------------------------------------
| Opening balance identification
|--------------------------------------------------------------------------
*/

const isOpeningBalanceEntry = (
  entry
) => {
  if (
    entry?.isOpeningBalance
  ) {
    return true;
  }

  const text =
    [
      entry?.sourceType,
      entry?.journalDescription,
      entry?.reference,
    ]
      .filter(Boolean)
      .map(
        normaliseText
      )
      .join(" ");

  return (
    text.includes(
      "opening balance"
    ) ||
    text.includes(
      "opening balances"
    )
  );
};

/*
|--------------------------------------------------------------------------
| General Ledger grouping
|--------------------------------------------------------------------------
*/

const compareEntriesAscending = (
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
      first.journalCreatedAt ||
        ""
    ).localeCompare(
      String(
        second.journalCreatedAt ||
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

  return (
    Number(
      first.lineIndex || 0
    ) -
    Number(
      second.lineIndex || 0
    )
  );
};

const groupEntriesByJournal = (
  entries
) => {
  const grouped =
    new Map();

  entries.forEach(
    (
      entry
    ) => {
      const key =
        String(
          entry.journalId ||
            entry.journalNumber ||
            entry.id
        );

      const existing =
        grouped.get(
          key
        ) || [];

      existing.push(
        entry
      );

      grouped.set(
        key,
        existing
      );
    }
  );

  return grouped;
};

const groupEntriesByAccount = (
  entries
) => {
  const grouped =
    new Map();

  entries.forEach(
    (
      entry
    ) => {
      const key =
        String(
          entry.accountId ||
            entry.accountCode ||
            ""
        );

      if (
        !key
      ) {
        return;
      }

      const existing =
        grouped.get(
          key
        ) || [];

      existing.push(
        entry
      );

      grouped.set(
        key,
        existing
      );
    }
  );

  grouped.forEach(
    (
      accountEntries,
      key
    ) => {
      grouped.set(
        key,
        [
          ...accountEntries,
        ].sort(
          compareEntriesAscending
        )
      );
    }
  );

  return grouped;
};

const getCashAccountEntries = (
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

/*
|--------------------------------------------------------------------------
| Historical cash balances
|--------------------------------------------------------------------------
*/

const getInitialAccountBalance = (
  account,
  entries
) => {
  if (
    entries.length >
      0 &&
    entries[0]
      .previousBalance !==
      undefined
  ) {
    return roundMoney(
      entries[0]
        .previousBalance
    );
  }

  return roundMoney(
    account.openingBalance
  );
};

const getAccountBalanceBeforeDate = (
  account,
  entries,
  fromDate
) => {
  const initialBalance =
    getInitialAccountBalance(
      account,
      entries
    );

  if (
    !fromDate
  ) {
    return initialBalance;
  }

  let previousEntry =
    null;

  for (
    let index =
      entries.length - 1;
    index >= 0;
    index -= 1
  ) {
    const entry =
      entries[
        index
      ];

    if (
      entry.date &&
      entry.date <
        fromDate
    ) {
      previousEntry =
        entry;

      break;
    }
  }

  if (
    previousEntry
  ) {
    return roundMoney(
      previousEntry.runningBalance
    );
  }

  const firstEntry =
    entries[0];

  if (
    firstEntry?.previousBalance !==
      undefined
  ) {
    return roundMoney(
      firstEntry.previousBalance
    );
  }

  return initialBalance;
};

const getAccountBalanceAsOfDate = (
  account,
  entries,
  toDate
) => {
  const initialBalance =
    getInitialAccountBalance(
      account,
      entries
    );

  if (
    entries.length ===
    0
  ) {
    return initialBalance;
  }

  if (
    !toDate
  ) {
    return roundMoney(
      entries[
        entries.length -
          1
      ].runningBalance
    );
  }

  for (
    let index =
      entries.length - 1;
    index >= 0;
    index -= 1
  ) {
    const entry =
      entries[
        index
      ];

    if (
      entry.date &&
      entry.date <=
        toDate
    ) {
      return roundMoney(
        entry.runningBalance
      );
    }
  }

  return initialBalance;
};

/*
|--------------------------------------------------------------------------
| Movement rows
|--------------------------------------------------------------------------
*/

const createMovementRow = ({
  entries,
  cashEntries,
  amount,
  category,
  classificationScores,
  allocationIndex = 0,
  allocationCount = 1,
  allocationWeight = 0,
  allocationPercentage = 100,
  counterpartAccounts = [],
}) => {
  const firstEntry =
    entries[0] || {};

  const journalKey =
    String(
      firstEntry.journalId ||
        firstEntry.journalNumber ||
        firstEntry.id ||
        "journal"
    );

  const cashAccountCodes =
    [
      ...new Set(
        cashEntries
          .map(
            (
              entry
            ) =>
              entry.accountCode
          )
          .filter(Boolean)
      ),
    ];

  const cashAccountNames =
    [
      ...new Set(
        cashEntries
          .map(
            (
              entry
            ) =>
              entry.accountName
          )
          .filter(Boolean)
      ),
    ];

  const cashAccountIds =
    [
      ...new Set(
        cashEntries
          .map(
            (
              entry
            ) =>
              entry.accountId
          )
          .filter(
            (
              value
            ) =>
              value !==
                undefined &&
              value !==
                null
          )
      ),
    ];

  const resolvedAmount =
    roundMoney(
      amount
    );

  return {
    id:
      `cash-flow-${journalKey}-${category}-${allocationIndex}`,

    journalKey,

    journalId:
      firstEntry.journalId ||
      "",

    journalNumber:
      firstEntry.journalNumber ||
      "",

    journalStatus:
      firstEntry.journalStatus ||
      "Posted",

    date:
      firstEntry.date ||
      "",

    reference:
      firstEntry.reference ||
      "",

    description:
      firstEntry.journalDescription ||
      firstEntry.lineDescription ||
      firstEntry.sourceType ||
      "Cash movement",

    sourceType:
      firstEntry.sourceType ||
      (
        firstEntry.isSystem
          ? "System journal"
          : "Manual journal"
      ),

    sourceNumber:
      firstEntry.sourceNumber ||
      "",

    isSystem:
      Boolean(
        firstEntry.isSystem
      ),

    isReversal:
      Boolean(
        firstEntry.isReversal
      ),

    reversesJournalId:
      firstEntry.reversesJournalId ||
      null,

    reversedByJournalId:
      firstEntry.reversedByJournalId ||
      null,

    cashAccountId:
      cashAccountIds.length ===
      1
        ? cashAccountIds[0]
        : "",

    cashAccountIds,

    cashAccountCode:
      cashAccountCodes.join(
        ", "
      ),

    cashAccountCodes,

    cashAccountName:
      cashAccountNames.join(
        ", "
      ),

    cashAccountNames,

    category,

    classificationScores:
      classificationScores || {
        operating: 0,
        investing: 0,
        financing: 0,
      },

    amount:
      resolvedAmount,

    cashIn:
      resolvedAmount >
      MONEY_TOLERANCE
        ? resolvedAmount
        : 0,

    cashOut:
      resolvedAmount <
      -MONEY_TOLERANCE
        ? Math.abs(
            resolvedAmount
          )
        : 0,

    /*
    |--------------------------------------------------------------------------
    | Allocation metadata
    |--------------------------------------------------------------------------
    */

    isAllocatedJournal:
      allocationCount >
      1,

    allocationIndex,

    allocationCount,

    allocationWeight:
      roundMoney(
        allocationWeight
      ),

    allocationPercentage:
      roundMoney(
        allocationPercentage
      ),

    counterpartAccounts:
      counterpartAccounts.map(
        (
          account
        ) => ({
          ...account,

          amount:
            roundMoney(
              account.amount
            ),
        })
      ),
  };
};

const sortRows = (
  rows
) => {
  return [
    ...rows,
  ].sort(
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

      const journalDifference =
        String(
          first.journalNumber ||
            first.description ||
            ""
        ).localeCompare(
          String(
            second.journalNumber ||
              second.description ||
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

      const categoryOrder = {
        operating: 1,
        investing: 2,
        financing: 3,
        "opening-balance-adjustment":
          4,
      };

      return (
        (
          categoryOrder[
            first.category
          ] || 99
        ) -
        (
          categoryOrder[
            second.category
          ] || 99
        )
      );
    }
  );
};

const sumAmounts = (
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
          row.amount ||
            0
        ),
      0
    )
  );
};

const countUniqueJournals = (
  rows
) => {
  return new Set(
    rows.map(
      (
        row
      ) =>
        row.journalKey ||
        row.journalId ||
        row.id
    )
  ).size;
};

/*
|--------------------------------------------------------------------------
| Search
|--------------------------------------------------------------------------
*/

const rowMatchesSearch = (
  row,
  searchValue
) => {
  if (
    !searchValue
  ) {
    return true;
  }

  const counterpartText =
    (
      row.counterpartAccounts ||
      []
    )
      .flatMap(
        (
          account
        ) => [
          account.code,
          account.name,
        ]
      )
      .join(" ");

  return [
    row.journalNumber,
    row.reference,
    row.description,
    row.sourceType,
    row.sourceNumber,
    row.cashAccountCode,
    row.cashAccountName,
    row.category,
    counterpartText,
    row.isReversal
      ? "reversal"
      : "",
    row.isAllocatedJournal
      ? "allocated split mixed journal"
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

/*
|--------------------------------------------------------------------------
| Cash Flow Statement
|--------------------------------------------------------------------------
*/

export const getCashFlowStatement =
  ({
    fromDate = "",
    toDate = "",
    search = "",
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
        "The Cash Flow start date is invalid."
      );
    }

    if (
      toDate &&
      !resolvedToDate
    ) {
      throw new Error(
        "The Cash Flow end date is invalid."
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

    const cashAccounts =
      accounts.filter(
        isCashAccount
      );

    const cashAccountIds =
      new Set(
        cashAccounts
          .map(
            (
              account
            ) =>
              account.id !==
                undefined &&
              account.id !==
                null
                ? String(
                    account.id
                  )
                : ""
          )
          .filter(Boolean)
      );

    const cashAccountCodes =
      new Set(
        cashAccounts
          .map(
            (
              account
            ) =>
              String(
                account.code ||
                  ""
              )
          )
          .filter(Boolean)
      );

    /*
    |--------------------------------------------------------------------------
    | General Ledger source of truth
    |--------------------------------------------------------------------------
    */

    const ledgerEntries =
      getGeneralLedger({
        accountId:
          "All",

        search: "",

        dateFrom: "",

        dateTo: "",
      });

    const allEntries =
      Array.isArray(
        ledgerEntries
      )
        ? ledgerEntries
        : [];

    const entriesByAccount =
      groupEntriesByAccount(
        allEntries
      );

    /*
    |--------------------------------------------------------------------------
    | Opening cash
    |--------------------------------------------------------------------------
    */

    const openingCashBalance =
      roundMoney(
        cashAccounts.reduce(
          (
            total,
            account
          ) => {
            const entries =
              getCashAccountEntries(
                account,
                entriesByAccount
              );

            return (
              total +
              getAccountBalanceBeforeDate(
                account,
                entries,
                resolvedFromDate
              )
            );
          },
          0
        )
      );

    /*
    |--------------------------------------------------------------------------
    | Actual closing cash
    |--------------------------------------------------------------------------
    */

    const closingCashBalance =
      roundMoney(
        cashAccounts.reduce(
          (
            total,
            account
          ) => {
            const entries =
              getCashAccountEntries(
                account,
                entriesByAccount
              );

            return (
              total +
              getAccountBalanceAsOfDate(
                account,
                entries,
                resolvedToDate
              )
            );
          },
          0
        )
      );

    const journals =
      groupEntriesByJournal(
        allEntries
      );

    const movementRows = [];

    const adjustmentRows = [];

    let internalTransferCount =
      0;

    let internalTransferGrossAmount =
      0;

    let splitJournalCount =
      0;

    let classifiedCashJournalCount =
      0;

    /*
    |--------------------------------------------------------------------------
    | Analyse journals
    |--------------------------------------------------------------------------
    */

    journals.forEach(
      (
        entries
      ) => {
        if (
          !entries.length
        ) {
          return;
        }

        const journalDate =
          entries[0].date ||
          "";

        if (
          resolvedFromDate &&
          (
            !journalDate ||
            journalDate <
              resolvedFromDate
          )
        ) {
          return;
        }

        if (
          resolvedToDate &&
          (
            !journalDate ||
            journalDate >
              resolvedToDate
          )
        ) {
          return;
        }

        const cashEntries =
          entries.filter(
            (
              entry
            ) => {
              const accountId =
                String(
                  entry.accountId ||
                    ""
                );

              const accountCode =
                String(
                  entry.accountCode ||
                    ""
                );

              return (
                cashAccountIds.has(
                  accountId
                ) ||
                cashAccountCodes.has(
                  accountCode
                )
              );
            }
          );

        if (
          cashEntries.length ===
          0
        ) {
          /*
          |--------------------------------------------------------------------------
          | Non-cash journal
          |--------------------------------------------------------------------------
          */

          return;
        }

        const totalCashDebit =
          roundMoney(
            cashEntries.reduce(
              (
                total,
                entry
              ) =>
                total +
                Number(
                  entry.debit ||
                    0
                ),
              0
            )
          );

        const totalCashCredit =
          roundMoney(
            cashEntries.reduce(
              (
                total,
                entry
              ) =>
                total +
                Number(
                  entry.credit ||
                    0
                ),
              0
            )
          );

        const netCashAmount =
          roundMoney(
            totalCashDebit -
              totalCashCredit
          );

        const counterpartEntries =
          entries.filter(
            (
              entry
            ) => {
              const accountId =
                String(
                  entry.accountId ||
                    ""
                );

              const accountCode =
                String(
                  entry.accountCode ||
                    ""
                );

              return !(
                cashAccountIds.has(
                  accountId
                ) ||
                cashAccountCodes.has(
                  accountCode
                )
              );
            }
          );

        /*
        |--------------------------------------------------------------------------
        | Pure bank-to-bank / cash-to-cash transfer
        |--------------------------------------------------------------------------
        */

        if (
          counterpartEntries.length ===
            0 &&
          Math.abs(
            netCashAmount
          ) <=
            MONEY_TOLERANCE
        ) {
          internalTransferCount +=
            1;

          internalTransferGrossAmount =
            roundMoney(
              internalTransferGrossAmount +
                Math.max(
                  totalCashDebit,
                  totalCashCredit
                )
            );

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Net-zero mixed cash journal
        |--------------------------------------------------------------------------
        |
        | Company-wide cash did not change.
        |
        */

        if (
          Math.abs(
            netCashAmount
          ) <=
          MONEY_TOLERANCE
        ) {
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Opening / conversion cash movement
        |--------------------------------------------------------------------------
        */

        if (
          entries.some(
            isOpeningBalanceEntry
          )
        ) {
          adjustmentRows.push(
            createMovementRow({
              entries,

              cashEntries,

              amount:
                netCashAmount,

              category:
                "opening-balance-adjustment",

              classificationScores: {
                operating: 0,
                investing: 0,
                financing: 0,
              },

              allocationIndex:
                0,

              allocationCount:
                1,

              allocationWeight:
                Math.abs(
                  netCashAmount
                ),

              allocationPercentage:
                100,

              counterpartAccounts:
                [],
            })
          );

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Allocate mixed cash journal
        |--------------------------------------------------------------------------
        */

        const allocations =
          allocateCashMovement({
            counterpartEntries,

            accountLookup,

            netCashAmount,
          });

        if (
          allocations.length ===
          0
        ) {
          return;
        }

        classifiedCashJournalCount +=
          1;

        if (
          allocations.length >
          1
        ) {
          splitJournalCount +=
            1;
        }

        allocations.forEach(
          (
            allocation,
            allocationIndex
          ) => {
            movementRows.push(
              createMovementRow({
                entries,

                cashEntries,

                amount:
                  allocation.amount,

                category:
                  allocation.category,

                classificationScores:
                  allocation.classificationScores,

                allocationIndex,

                allocationCount:
                  allocations.length,

                allocationWeight:
                  allocation.weight,

                allocationPercentage:
                  allocation.percentage,

                counterpartAccounts:
                  allocation.counterpartAccounts,
              })
            );
          }
        );
      }
    );

    const sortedMovementRows =
      sortRows(
        movementRows
      );

    const allOperatingRows =
      sortedMovementRows.filter(
        (
          row
        ) =>
          row.category ===
          "operating"
      );

    const allInvestingRows =
      sortedMovementRows.filter(
        (
          row
        ) =>
          row.category ===
          "investing"
      );

    const allFinancingRows =
      sortedMovementRows.filter(
        (
          row
        ) =>
          row.category ===
          "financing"
      );

    /*
    |--------------------------------------------------------------------------
    | Full accounting totals
    |--------------------------------------------------------------------------
    */

    const totalOperating =
      sumAmounts(
        allOperatingRows
      );

    const totalInvesting =
      sumAmounts(
        allInvestingRows
      );

    const totalFinancing =
      sumAmounts(
        allFinancingRows
      );

    const netCashMovement =
      roundMoney(
        totalOperating +
          totalInvesting +
          totalFinancing
      );

    const sortedAdjustmentRows =
      sortRows(
        adjustmentRows
      );

    const openingBalanceAdjustments =
      sumAmounts(
        sortedAdjustmentRows
      );

    const totalCashIn =
      roundMoney(
        sortedMovementRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.cashIn ||
                0
            ),
          0
        )
      );

    const totalCashOut =
      roundMoney(
        sortedMovementRows.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.cashOut ||
                0
            ),
          0
        )
      );

    /*
    |--------------------------------------------------------------------------
    | Cash reconciliation
    |--------------------------------------------------------------------------
    |
    | Opening cash
    | + Operating
    | + Investing
    | + Financing
    | + Opening/conversion adjustments
    | = Expected closing cash
    |
    */

    const expectedClosingCashBalance =
      roundMoney(
        openingCashBalance +
          netCashMovement +
          openingBalanceAdjustments
      );

    const cashReconciliationDifference =
      roundMoney(
        closingCashBalance -
          expectedClosingCashBalance
      );

    const isReconciled =
      Math.abs(
        cashReconciliationDifference
      ) <=
      MONEY_TOLERANCE;

    /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    |
    | Search remains presentation-only.
    |
    */

    const searchValue =
      normaliseText(
        search
      );

    const visibleRows =
      sortedMovementRows.filter(
        (
          row
        ) =>
          rowMatchesSearch(
            row,
            searchValue
          )
      );

    const operatingRows =
      visibleRows.filter(
        (
          row
        ) =>
          row.category ===
          "operating"
      );

    const investingRows =
      visibleRows.filter(
        (
          row
        ) =>
          row.category ===
          "investing"
      );

    const financingRows =
      visibleRows.filter(
        (
          row
        ) =>
          row.category ===
          "financing"
      );

    const visibleTotalOperating =
      sumAmounts(
        operatingRows
      );

    const visibleTotalInvesting =
      sumAmounts(
        investingRows
      );

    const visibleTotalFinancing =
      sumAmounts(
        financingRows
      );

    const visibleNetCashMovement =
      roundMoney(
        visibleTotalOperating +
          visibleTotalInvesting +
          visibleTotalFinancing
      );

    /*
    |--------------------------------------------------------------------------
    | Journal-count compatibility
    |--------------------------------------------------------------------------
    |
    | Before mixed allocation there was one row per cash journal.
    |
    | We keep movementCount / totalMovementCount journal-based so the existing
    | UI does not suddenly report one mixed journal as several transactions.
    |
    */

    const visibleMovementCount =
      countUniqueJournals(
        visibleRows
      );

    const totalMovementCount =
      countUniqueJournals(
        sortedMovementRows
      );

    return {
      fromDate:
        resolvedFromDate,

      toDate:
        resolvedToDate,

      /*
      |--------------------------------------------------------------------------
      | Existing page API
      |--------------------------------------------------------------------------
      */

      operatingRows,

      investingRows,

      financingRows,

      openingCashBalance,

      totalOperating,

      totalInvesting,

      totalFinancing,

      totalCashIn,

      totalCashOut,

      netCashMovement,

      closingCashBalance,

      movementCount:
        visibleMovementCount,

      totalMovementCount,

      /*
      |--------------------------------------------------------------------------
      | Search / visible totals
      |--------------------------------------------------------------------------
      */

      searchActive:
        Boolean(
          searchValue
        ),

      visibleTotalOperating,

      visibleTotalInvesting,

      visibleTotalFinancing,

      visibleNetCashMovement,

      visibleMovementCount,

      /*
      |--------------------------------------------------------------------------
      | Opening balance adjustments
      |--------------------------------------------------------------------------
      */

      adjustmentRows:
        sortedAdjustmentRows,

      openingBalanceAdjustments,

      hasOpeningBalanceAdjustments:
        Math.abs(
          openingBalanceAdjustments
        ) >
        MONEY_TOLERANCE,

      /*
      |--------------------------------------------------------------------------
      | Internal-transfer controls
      |--------------------------------------------------------------------------
      */

      internalTransferCount,

      internalTransferGrossAmount,

      /*
      |--------------------------------------------------------------------------
      | Mixed-journal allocation diagnostics
      |--------------------------------------------------------------------------
      */

      splitJournalCount,

      hasSplitJournals:
        splitJournalCount >
        0,

      classifiedCashJournalCount,

      allocationRowCount:
        sortedMovementRows.length,

      visibleAllocationRowCount:
        visibleRows.length,

      /*
      |--------------------------------------------------------------------------
      | Reconciliation
      |--------------------------------------------------------------------------
      */

      expectedClosingCashBalance,

      cashReconciliationDifference,

      isReconciled,

      cashAccountCount:
        cashAccounts.length,

      cashAccounts:
        cashAccounts.map(
          (
            account
          ) => ({
            id:
              account.id,

            code:
              account.code,

            name:
              account.name,

            status:
              account.status ||
              "Active",
          })
        ),
    };
  };

/*
|--------------------------------------------------------------------------
| CSV export
|--------------------------------------------------------------------------
*/

export const exportCashFlowCsv =
  (
    options = {}
  ) => {
    const report =
      getCashFlowStatement(
        options
      );

    const searchValue =
      String(
        options.search ||
          ""
      ).trim();

    const createSectionRows = (
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
          "",
        ],

        ...rows.map(
          (
            row
          ) => [
            row.date ||
              "",

            row.reference ||
              row.journalNumber ||
              "",

            row.isAllocatedJournal
              ? `${row.description} (${row.allocationPercentage.toFixed(
                  2
                )}% allocated to ${row.category})`
              : row.description,

            row.amount.toFixed(
              2
            ),
          ]
        ),

        [
          "",
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
          "",
        ],
      ];
    };

    const rows = [
      [
        "Cash Flow Statement",
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
      ],

      [
        "To",
        report.toDate ||
          "",
        "",
        "",
      ],

      [
        "Search",
        searchValue,
        "",
        "",
      ],

      [
        "Status",
        report.isReconciled
          ? "Reconciled"
          : "Reconciliation difference",
        "",
        "",
      ],

      [
        "",
        "",
        "",
        "",
      ],

      [
        "",
        "",
        "Opening cash balance",
        report.openingCashBalance.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
        "",
      ],

      ...createSectionRows(
        "Operating Activities",
        report.operatingRows,
        "Net cash from operating activities",
        report.totalOperating
      ),

      ...createSectionRows(
        "Investing Activities",
        report.investingRows,
        "Net cash from investing activities",
        report.totalInvesting
      ),

      ...createSectionRows(
        "Financing Activities",
        report.financingRows,
        "Net cash from financing activities",
        report.totalFinancing
      ),

      [
        "",
        "",
        "Net cash from activities",
        report.netCashMovement.toFixed(
          2
        ),
      ],
    ];

    if (
      report.hasOpeningBalanceAdjustments
    ) {
      rows.push(
        [
          "",
          "",
          "",
          "",
        ],

        [
          "Opening Balance Adjustments",
          "",
          "",
          "",
        ],

        ...report.adjustmentRows.map(
          (
            row
          ) => [
            row.date ||
              "",

            row.reference ||
              row.journalNumber ||
              "",

            row.description,

            row.amount.toFixed(
              2
            ),
          ]
        ),

        [
          "",
          "",
          "Total opening balance adjustments",
          report.openingBalanceAdjustments.toFixed(
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
        "",
      ],

      [
        "",
        "",
        "Closing cash balance",
        report.closingCashBalance.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "Expected closing cash balance",
        report.expectedClosingCashBalance.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "Reconciliation difference",
        report.cashReconciliationDifference.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
        "",
      ],

      [
        "Accounting Controls",
        "",
        "",
        "",
      ],

      [
        "",
        "",
        "Cash accounts",
        String(
          report.cashAccountCount
        ),
      ],

      [
        "",
        "",
        "Internal transfers excluded",
        String(
          report.internalTransferCount
        ),
      ],

      [
        "",
        "",
        "Gross internal transfers excluded",
        report.internalTransferGrossAmount.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "Mixed journals allocated",
        String(
          report.splitJournalCount
        ),
      ],

      [
        "",
        "",
        "Cash journals classified",
        String(
          report.classifiedCashJournalCount
        ),
      ],

      [
        "",
        "",
        "Cash-flow allocation rows",
        String(
          report.allocationRowCount
        ),
      ],

      [
        "",
        "",
        "Total cash received",
        report.totalCashIn.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "Total cash paid",
        report.totalCashOut.toFixed(
          2
        ),
      ]
    );

    if (
      report.searchActive
    ) {
      rows.push(
        [
          "",
          "",
          "",
          "",
        ],

        [
          "Visible Search Results",
          "",
          "",
          "",
        ],

        [
          "",
          "",
          "Visible operating cash flow",
          report.visibleTotalOperating.toFixed(
            2
          ),
        ],

        [
          "",
          "",
          "Visible investing cash flow",
          report.visibleTotalInvesting.toFixed(
            2
          ),
        ],

        [
          "",
          "",
          "Visible financing cash flow",
          report.visibleTotalFinancing.toFixed(
            2
          ),
        ],

        [
          "",
          "",
          "Visible net cash flow",
          report.visibleNetCashMovement.toFixed(
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