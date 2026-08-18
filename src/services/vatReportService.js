import {
  getAccounts,
} from "./accountService";

import {
  getGeneralLedger,
} from "./generalLedgerService";

import {
  getAccountTransactions,
} from "./accountTransactionsService";

const MONEY_TOLERANCE =
  0.005;

const VAT_CONTROL_CODE =
  "210";

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

const formatLocalDate = (
  date
) => {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
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

  return formatLocalDate(
    parsedDate
  );
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

const findVatControlAccount = (
  accounts
) => {
  const byCode =
    accounts.find(
      (
        account
      ) =>
        String(
          account.code ||
          ""
        ) ===
        VAT_CONTROL_CODE
    );

  if (
    byCode
  ) {
    return byCode;
  }

  return (
    accounts.find(
      (
        account
      ) => {
        const text =
          [
            account.name,
            account.subtype,
            account.description,
          ]
            .filter(Boolean)
            .map(
              normaliseText
            )
            .join(" ");

        return (
          text.includes(
            "vat control"
          ) ||
          text.includes(
            "vat payable"
          ) ||
          text.includes(
            "vat liability"
          )
        );
      }
    ) ||
    null
  );
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

const getAccountText = (
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

const isCashAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Explicit cash / bank flags
  |--------------------------------------------------------------------------
  |
  | Prefer explicit metadata when available.
  |
  */

  if (
    account.isCashAccount ===
    true ||
    account.isBankAccount ===
    true
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Linked bank-account metadata
  |--------------------------------------------------------------------------
  |
  | Bank ledger accounts created by banking integrations may carry a link
  | back to the bank account even when their Chart of Accounts type varies.
  |
  */

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
  | Ledgify cash / bank control range
  |--------------------------------------------------------------------------
  |
  | 100 is the standard Bank account.
  | Additional bank accounts are created from 101 upward.
  | 110 is Accounts Receivable, so the range deliberately stops before it.
  |
  */

  const numericCode =
    Number(
      code
    );

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

  /*
  |--------------------------------------------------------------------------
  | Direct type recognition
  |--------------------------------------------------------------------------
  |
  | This fixes the previous weakness where type had to equal exactly "asset".
  |
  */

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

  const accountText =
    getAccountText(
      account
    );

  /*
  |--------------------------------------------------------------------------
  | Protect against obvious expense/liability false positives
  |--------------------------------------------------------------------------
  |
  | Examples that must NOT become cash accounts:
  |
  | - Bank charges
  | - Bank fees
  | - Merchant fees
  | - Bank loan
  | - Loan from bank
  |
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

  /*
  |--------------------------------------------------------------------------
  | Asset-like account types
  |--------------------------------------------------------------------------
  */

  const assetLike =
    typeValues.some(
      (
        value
      ) =>
        value ===
        "asset" ||
        value ===
        "assets" ||
        value ===
        "current asset" ||
        value ===
        "current assets" ||
        value ===
        "cash" ||
        value ===
        "bank" ||
        value.includes(
          "cash equivalent"
        ) ||
        value.includes(
          "current asset"
        )
    );

  if (
    !assetLike
  ) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Bank / cash terminology
  |--------------------------------------------------------------------------
  */

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
        accountText.includes(
          keyword
        )
    )
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Generic "bank" fallback
  |--------------------------------------------------------------------------
  |
  | At this point the account has already been confirmed to be asset-like,
  | so names such as:
  |
  |   Barclays Bank
  |   HSBC Business
  |   Starling Bank
  |
  | can safely be recognised.
  |
  */

  if (
    accountText.includes(
      "bank"
    )
  ) {
    return true;
  }

  return false;
};

const isReceivablesAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  if (
    String(
      account.code ||
      ""
    ) === "110"
  ) {
    return true;
  }

  const text =
    getAccountText(
      account
    );

  return (
    text.includes(
      "accounts receivable"
    ) ||
    text.includes(
      "trade receivable"
    ) ||
    text.includes(
      "trade debtor"
    )
  );
};

const isPayablesAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  if (
    String(
      account.code ||
      ""
    ) === "200"
  ) {
    return true;
  }

  const text =
    getAccountText(
      account
    );

  return (
    text.includes(
      "accounts payable"
    ) ||
    text.includes(
      "trade payable"
    ) ||
    text.includes(
      "trade creditor"
    )
  );
};

const isRevenueAccount = (
  account
) => {
  if (!account) {
    return false;
  }

  const typeText =
    [
      account.type,
      account.accountType,
      account.category,
      account.group,
    ]
      .filter(Boolean)
      .map(
        normaliseText
      )
      .join(" ");

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
  if (!account) {
    return false;
  }

  const typeText =
    [
      account.type,
      account.accountType,
      account.category,
      account.group,
    ]
      .filter(Boolean)
      .map(
        normaliseText
      )
      .join(" ");

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

const getJournalText = (
  entries
) => {
  return entries
    .flatMap(
      (
        entry
      ) => [
          entry.sourceType,
          entry.sourceNumber,
          entry.reference,
          entry.journalDescription,
          entry.lineDescription,
          entry.journalNumber,
        ]
    )
    .filter(Boolean)
    .map(
      normaliseText
    )
    .join(" ");
};

const isOpeningBalanceMovement = (
  entries
) => {
  if (
    entries.some(
      (
        entry
      ) =>
        entry.isOpeningBalance
    )
  ) {
    return true;
  }

  const text =
    getJournalText(
      entries
    );

  return (
    text.includes(
      "opening balance"
    ) ||
    text.includes(
      "opening balances"
    )
  );
};

const hasExplicitVatSettlementText =
  (
    entries
  ) => {
    const text =
      getJournalText(
        entries
      );

    return [
      "vat payment",
      "vat settlement",
      "vat paid",
      "pay vat",
      "payment to hmrc",
      "paid to hmrc",
      "hmrc payment",
      "vat refund",
      "hmrc refund",
    ].some(
      (
        keyword
      ) =>
        text.includes(
          keyword
        )
    );
  };

const classifyVatMovement = ({
  entries,
  counterpartEntries,
  accountLookup,
}) => {
  if (
    isOpeningBalanceMovement(
      entries
    )
  ) {
    return "opening";
  }

  const counterpartAccounts =
    counterpartEntries
      .map(
        (
          entry
        ) =>
          resolveEntryAccount(
            entry,
            accountLookup
          )
      )
      .filter(Boolean);

  /*
  |--------------------------------------------------------------------------
  | VAT settlement
  |--------------------------------------------------------------------------
  |
  | A VAT Control posting against Bank/Cash represents payment to HMRC,
  | repayment/refund from HMRC, or another settlement movement.
  |
  | It changes account 210, but it is NOT Output VAT or Input VAT for the
  | current return.
  |
  */

  if (
    hasExplicitVatSettlementText(
      entries
    ) ||
    counterpartAccounts.some(
      isCashAccount
    )
  ) {
    return "settlement";
  }

  /*
  |--------------------------------------------------------------------------
  | Counterpart-account classification
  |--------------------------------------------------------------------------
  */

  const hasReceivables =
    counterpartAccounts.some(
      isReceivablesAccount
    );

  const hasRevenue =
    counterpartAccounts.some(
      isRevenueAccount
    );

  const hasPayables =
    counterpartAccounts.some(
      isPayablesAccount
    );

  const hasExpense =
    counterpartAccounts.some(
      isExpenseAccount
    );

  if (
    hasReceivables ||
    hasRevenue
  ) {
    return "output";
  }

  if (
    hasPayables ||
    hasExpense
  ) {
    return "input";
  }

  /*
  |--------------------------------------------------------------------------
  | Source metadata fallback
  |--------------------------------------------------------------------------
  */

  const sourceText =
    getJournalText(
      entries
    );

  const inputKeywords = [
    "supplier bill",
    "purchase invoice",
    "supplier invoice",
    "purchase bill",
    "accounts payable",
    "supplier credit",
    "purchase credit",
  ];

  if (
    inputKeywords.some(
      (
        keyword
      ) =>
        sourceText.includes(
          keyword
        )
    )
  ) {
    return "input";
  }

  const outputKeywords = [
    "sales invoice",
    "customer invoice",
    "invoice approval",
    "accounts receivable",
    "customer credit",
    "sales credit",
  ];

  if (
    outputKeywords.some(
      (
        keyword
      ) =>
        sourceText.includes(
          keyword
        )
    )
  ) {
    return "output";
  }

  /*
  |--------------------------------------------------------------------------
  | Manual VAT adjustments
  |--------------------------------------------------------------------------
  |
  | A direct journal to VAT Control that cannot be identified as a sales,
  | purchase or settlement transaction remains a VAT adjustment.
  |
  */

  return "adjustment";
};

const getSourceLabel = (
  classification,
  entry
) => {
  if (
    classification ===
    "output"
  ) {
    return "Sales VAT";
  }

  if (
    classification ===
    "input"
  ) {
    return "Purchase VAT";
  }

  if (
    classification ===
    "settlement"
  ) {
    return "VAT settlement";
  }

  if (
    classification ===
    "opening"
  ) {
    return "Opening balance";
  }

  return (
    entry?.sourceType ||
    "VAT adjustment"
  );
};

const createVatMovementRow = ({
  entries,
  vatAccount,
  accountLookup,
}) => {
  if (
    !Array.isArray(
      entries
    ) ||
    entries.length === 0
  ) {
    return null;
  }

  const vatEntries =
    entries.filter(
      (
        entry
      ) => {
        return (
          String(
            entry.accountId ||
            ""
          ) ===
          String(
            vatAccount.id
          ) ||
          String(
            entry.accountCode ||
            ""
          ) ===
          String(
            vatAccount.code
          )
        );
      }
    );

  if (
    vatEntries.length === 0
  ) {
    return null;
  }

  const counterpartEntries =
    entries.filter(
      (
        entry
      ) =>
        !vatEntries.includes(
          entry
        )
    );

  const vatDebit =
    roundMoney(
      vatEntries.reduce(
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

  const vatCredit =
    roundMoney(
      vatEntries.reduce(
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

  if (
    Math.abs(
      vatDebit
    ) <=
    MONEY_TOLERANCE &&
    Math.abs(
      vatCredit
    ) <=
    MONEY_TOLERANCE
  ) {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | VAT Control sign convention
  |--------------------------------------------------------------------------
  |
  | VAT Control is a liability:
  |
  | Credit = increases VAT payable
  | Debit  = reduces VAT payable / increases recoverable VAT
  |
  */

  const controlMovement =
    roundMoney(
      vatCredit -
      vatDebit
    );

  const classification =
    classifyVatMovement({
      entries,
      counterpartEntries,
      accountLookup,
    });

  let outputVat = 0;
  let inputVat = 0;

  if (
    classification ===
    "output"
  ) {
    /*
    | Invoice reversal naturally creates negative Output VAT.
    */

    outputVat =
      controlMovement;
  }

  if (
    classification ===
    "input"
  ) {
    /*
    | Purchase VAT normally debits VAT Control.
    |
    | Therefore:
    |
    | debit £20 => control movement -£20
    | Input VAT = £20
    */

    inputVat =
      roundMoney(
        -controlMovement
      );
  }

  if (
    classification ===
    "adjustment"
  ) {
    /*
    |--------------------------------------------------------------------------
    | Adjustment presentation
    |--------------------------------------------------------------------------
    |
    | Credit adjustment behaves like additional Output VAT.
    | Debit adjustment behaves like additional Input VAT.
    |
    | This retains compatibility with the simplified VAT return currently
    | used by Ledgify while keeping settlements separate.
    |
    */

    if (
      controlMovement >= 0
    ) {
      outputVat =
        controlMovement;
    } else {
      inputVat =
        Math.abs(
          controlMovement
        );
    }
  }

  const firstEntry =
    vatEntries[0] ||
    entries[0];

  const counterpartAccounts =
    counterpartEntries
      .map(
        (
          entry
        ) =>
          resolveEntryAccount(
            entry,
            accountLookup
          )
      )
      .filter(Boolean);

  return {
    id:
      `vat-${firstEntry.journalId || firstEntry.id}`,

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

    documentNumber:
      firstEntry.sourceNumber ||
      firstEntry.reference ||
      firstEntry.journalNumber ||
      "",

    description:
      firstEntry.journalDescription ||
      firstEntry.lineDescription ||
      "VAT movement",

    sourceType:
      getSourceLabel(
        classification,
        firstEntry
      ),

    originalSourceType:
      firstEntry.sourceType ||
      "",

    sourceNumber:
      firstEntry.sourceNumber ||
      "",

    classification,

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

    vatDebit,

    vatCredit,

    outputVat:
      roundMoney(
        outputVat
      ),

    inputVat:
      roundMoney(
        inputVat
      ),

    netVat:
      roundMoney(
        outputVat -
        inputVat
      ),

    controlMovement,

    counterpartAccounts:
      counterpartAccounts.map(
        (
          account
        ) => ({
          id:
            account.id,

          code:
            account.code,

          name:
            account.name,

          type:
            account.type,
        })
      ),
  };
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
    row.documentNumber,
    row.description,
    row.sourceType,
    row.originalSourceType,
    row.classification,
    row.isReversal
      ? "reversal"
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
      const dateComparison =
        String(
          second.date ||
          ""
        ).localeCompare(
          String(
            first.date ||
            ""
          )
        );

      if (
        dateComparison !== 0
      ) {
        return dateComparison;
      }

      return String(
        second.documentNumber ||
        second.journalNumber ||
        ""
      ).localeCompare(
        String(
          first.documentNumber ||
          first.journalNumber ||
          ""
        ),
        undefined,
        {
          numeric: true,
          sensitivity:
            "base",
        }
      );
    }
  );
};

const sumRows = (
  rows,
  field
) => {
  return roundMoney(
    rows.reduce(
      (
        total,
        row
      ) =>
        total +
        Number(
          row[field] ||
          0
        ),
      0
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

export const getVatReturn = (
  {
    fromDate = "",
    toDate = "",
    search = "",
  } = {}
) => {
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
      "The VAT Return start date is invalid."
    );
  }

  if (
    toDate &&
    !resolvedToDate
  ) {
    throw new Error(
      "The VAT Return end date is invalid."
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

  const vatAccount =
    findVatControlAccount(
      accounts
    );

  if (
    !vatAccount
  ) {
    throw new Error(
      "VAT Control account 210 could not be found in the Chart of Accounts."
    );
  }

  const accountLookup =
    getAccountLookup(
      accounts
    );

  /*
  |--------------------------------------------------------------------------
  | General Ledger is the VAT accounting source of truth
  |--------------------------------------------------------------------------
  |
  | We load ALL account lines for the period, not only account 210, because
  | the counterpart accounts help determine whether a VAT Control movement
  | came from:
  |
  | - a sales invoice
  | - a supplier bill
  | - an HMRC settlement
  | - an opening balance
  | - a manual VAT adjustment
  |
  */

  const ledgerEntries =
    getGeneralLedger({
      accountId:
        "All",

      search: "",

      dateFrom:
        resolvedFromDate,

      dateTo:
        resolvedToDate,
    });

  const entries =
    Array.isArray(
      ledgerEntries
    )
      ? ledgerEntries
      : [];

  const groupedEntries =
    groupEntriesByJournal(
      entries
    );

  const allVatMovements = [];

  groupedEntries.forEach(
    (
      journalEntries
    ) => {
      const row =
        createVatMovementRow({
          entries:
            journalEntries,

          vatAccount,

          accountLookup,
        });

      if (
        row
      ) {
        allVatMovements.push(
          row
        );
      }
    }
  );

  const sortedVatMovements =
    sortRows(
      allVatMovements
    );

  /*
  |--------------------------------------------------------------------------
  | VAT Return activity
  |--------------------------------------------------------------------------
  |
  | Settlements and opening balances are intentionally excluded from Output
  | VAT / Input VAT.
  |
  */

  const returnRows =
    sortedVatMovements.filter(
      (
        row
      ) =>
        [
          "output",
          "input",
          "adjustment",
        ].includes(
          row.classification
        )
    );

  const outputRows =
    returnRows.filter(
      (
        row
      ) =>
        row.classification ===
        "output"
    );

  const inputRows =
    returnRows.filter(
      (
        row
      ) =>
        row.classification ===
        "input"
    );

  const adjustmentRows =
    returnRows.filter(
      (
        row
      ) =>
        row.classification ===
        "adjustment"
    );

  const settlementRows =
    sortedVatMovements.filter(
      (
        row
      ) =>
        row.classification ===
        "settlement"
    );

  const openingBalanceRows =
    sortedVatMovements.filter(
      (
        row
      ) =>
        row.classification ===
        "opening"
    );

  /*
  |--------------------------------------------------------------------------
  | Full VAT Return totals
  |--------------------------------------------------------------------------
  |
  | Search never changes these totals.
  |
  */

  const totalOutputVat =
    sumRows(
      returnRows,
      "outputVat"
    );

  const totalInputVat =
    sumRows(
      returnRows,
      "inputVat"
    );

  const netVat =
    roundMoney(
      totalOutputVat -
      totalInputVat
    );

  const salesOutputVat =
    sumRows(
      outputRows,
      "outputVat"
    );

  const purchaseInputVat =
    sumRows(
      inputRows,
      "inputVat"
    );

  const adjustmentNetVat =
    sumRows(
      adjustmentRows,
      "netVat"
    );

  /*
  |--------------------------------------------------------------------------
  | Settlements
  |--------------------------------------------------------------------------
  |
  | Negative:
  |   VAT payment to HMRC / reduction in liability
  |
  | Positive:
  |   movement increasing VAT Control credit balance
  |
  */

  const totalSettlementMovement =
    sumRows(
      settlementRows,
      "controlMovement"
    );

  const totalOpeningBalanceMovement =
    sumRows(
      openingBalanceRows,
      "controlMovement"
    );

  /*
  |--------------------------------------------------------------------------
  | VAT Control reconciliation
  |--------------------------------------------------------------------------
  |
  | Account Transactions derives from the General Ledger, so this gives us
  | the actual account 210 position immediately before and at the end of the
  | selected VAT period.
  |
  */

  const controlReport =
    getAccountTransactions({
      accountId:
        vatAccount.id,

      fromDate:
        resolvedFromDate,

      toDate:
        resolvedToDate,

      search: "",
    });

  const openingVatControlBalance =
    roundMoney(
      controlReport.openingBalance
    );

  const closingVatControlBalance =
    roundMoney(
      controlReport.closingBalance
    );

  const periodVatControlMovement =
    roundMoney(
      closingVatControlBalance -
      openingVatControlBalance
    );

  /*
  |--------------------------------------------------------------------------
  | Expected account 210 closing balance
  |--------------------------------------------------------------------------
  |
  | VAT Return activity:
  |
  |   Output VAT
  | - Input VAT
  |
  | plus:
  |
  |   VAT settlements
  |   conversion/opening entries inside the period
  |
  */

  const expectedClosingVatControlBalance =
    roundMoney(
      openingVatControlBalance +
      netVat +
      totalSettlementMovement +
      totalOpeningBalanceMovement
    );

  const reconciliationDifference =
    roundMoney(
      closingVatControlBalance -
      expectedClosingVatControlBalance
    );

  const isReconciled =
    Math.abs(
      reconciliationDifference
    ) <=
    MONEY_TOLERANCE;

  /*
  |--------------------------------------------------------------------------
  | Secondary movement control
  |--------------------------------------------------------------------------
  */

  const classifiedControlMovement =
    roundMoney(
      netVat +
      totalSettlementMovement +
      totalOpeningBalanceMovement
    );

  const movementDifference =
    roundMoney(
      periodVatControlMovement -
      classifiedControlMovement
    );

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  |
  | Search filters only the visible VAT Return rows.
  |
  */

  const searchValue =
    normaliseText(
      search
    );

  const rows =
    returnRows.filter(
      (
        row
      ) =>
        rowMatchesSearch(
          row,
          searchValue
        )
    );

  const visibleOutputVat =
    sumRows(
      rows,
      "outputVat"
    );

  const visibleInputVat =
    sumRows(
      rows,
      "inputVat"
    );

  const visibleNetVat =
    roundMoney(
      visibleOutputVat -
      visibleInputVat
    );

  let position =
    "clear";

  if (
    netVat >
    MONEY_TOLERANCE
  ) {
    position =
      "payable";
  }

  if (
    netVat <
    -MONEY_TOLERANCE
  ) {
    position =
      "refundable";
  }

  let controlPosition =
    "clear";

  if (
    closingVatControlBalance >
    MONEY_TOLERANCE
  ) {
    controlPosition =
      "payable";
  }

  if (
    closingVatControlBalance <
    -MONEY_TOLERANCE
  ) {
    controlPosition =
      "recoverable";
  }

  return {
    fromDate:
      resolvedFromDate,

    toDate:
      resolvedToDate,

    vatAccountId:
      vatAccount.id,

    vatAccountCode:
      vatAccount.code,

    vatAccountName:
      vatAccount.name,

    /*
    |--------------------------------------------------------------------------
    | Existing VAT Return API
    |--------------------------------------------------------------------------
    */

    rows,

    totalOutputVat,

    totalInputVat,

    netVat,

    absoluteNetVat:
      Math.abs(
        netVat
      ),

    position,

    transactionCount:
      rows.length,

    totalTransactionCount:
      returnRows.length,

    /*
    |--------------------------------------------------------------------------
    | VAT activity detail
    |--------------------------------------------------------------------------
    */

    outputRows,

    inputRows,

    adjustmentRows,

    salesOutputVat,

    purchaseInputVat,

    adjustmentNetVat,

    adjustmentCount:
      adjustmentRows.length,

    hasAdjustments:
      adjustmentRows.length >
      0,

    /*
    |--------------------------------------------------------------------------
    | Search totals
    |--------------------------------------------------------------------------
    */

    searchActive:
      Boolean(
        searchValue
      ),

    visibleOutputVat,

    visibleInputVat,

    visibleNetVat,

    /*
    |--------------------------------------------------------------------------
    | VAT settlements
    |--------------------------------------------------------------------------
    */

    settlementRows,

    settlementCount:
      settlementRows.length,

    totalSettlementMovement,

    hasSettlements:
      settlementRows.length >
      0,

    /*
    |--------------------------------------------------------------------------
    | Opening / conversion VAT
    |--------------------------------------------------------------------------
    */

    openingBalanceRows,

    openingBalanceMovement:
      totalOpeningBalanceMovement,

    hasOpeningBalanceMovement:
      Math.abs(
        totalOpeningBalanceMovement
      ) >
      MONEY_TOLERANCE,

    /*
    |--------------------------------------------------------------------------
    | VAT Control reconciliation
    |--------------------------------------------------------------------------
    */

    openingVatControlBalance,

    closingVatControlBalance,

    expectedClosingVatControlBalance,

    periodVatControlMovement,

    classifiedControlMovement,

    reconciliationDifference,

    movementDifference,

    isReconciled,

    controlPosition,

    vatControlBalanceSide:
      controlReport.closingBalanceSide ||
      controlReport.accountNormalBalance ||
      "Credit",
  };
};

export const exportVatReturnCsv = (
  options = {}
) => {
  const report =
    getVatReturn(
      options
    );

  const searchValue =
    String(
      options.search ||
      ""
    ).trim();

  const rows = [
    [
      "VAT Return",
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
    ],

    [
      "To",
      report.toDate ||
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "VAT Control",
      `${report.vatAccountCode} — ${report.vatAccountName}`,
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
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "Date",
      "Source",
      "Document",
      "Description",
      "Output VAT",
      "Input VAT",
    ],

    ...report.rows.map(
      (
        row
      ) => [
          row.date ||
          "",
          row.sourceType,
          row.documentNumber,
          row.description,
          row.outputVat.toFixed(
            2
          ),
          row.inputVat.toFixed(
            2
          ),
        ]
    ),

    [
      "",
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
      "Total Output VAT",
      report.totalOutputVat.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Total Input VAT",
      "",
      report.totalInputVat.toFixed(
        2
      ),
    ],

    [
      "",
      "",
      "",
      report.position ===
        "refundable"
        ? "VAT Refundable"
        : report.position ===
          "payable"
          ? "VAT Payable"
          : "Net VAT",

      report.netVat.toFixed(
        2
      ),

      "",
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
        "",
        "",
        "",
      ],

      [
        "Visible Search Results",
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
        "Visible Output VAT",
        report.visibleOutputVat.toFixed(
          2
        ),
        "",
      ],

      [
        "",
        "",
        "",
        "Visible Input VAT",
        "",
        report.visibleInputVat.toFixed(
          2
        ),
      ],

      [
        "",
        "",
        "",
        "Visible Net VAT",
        report.visibleNetVat.toFixed(
          2
        ),
        "",
      ]
    );
  }

  if (
    report.hasSettlements
  ) {
    rows.push(
      [
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "VAT Settlements",
        "",
        "",
        "",
        "",
        "",
      ],

      ...report.settlementRows.map(
        (
          row
        ) => [
            row.date ||
            "",
            row.sourceType,
            row.documentNumber,
            row.description,
            row.controlMovement.toFixed(
              2
            ),
            "",
          ]
      ),

      [
        "",
        "",
        "",
        "Net settlement movement",
        report.totalSettlementMovement.toFixed(
          2
        ),
        "",
      ]
    );
  }

  if (
    report.hasOpeningBalanceMovement
  ) {
    rows.push(
      [
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Opening / Conversion VAT",
        "",
        "",
        "",
        "",
        "",
      ],

      ...report.openingBalanceRows.map(
        (
          row
        ) => [
            row.date ||
            "",
            row.sourceType,
            row.documentNumber,
            row.description,
            row.controlMovement.toFixed(
              2
            ),
            "",
          ]
      ),

      [
        "",
        "",
        "",
        "Opening balance movement",
        report.openingBalanceMovement.toFixed(
          2
        ),
        "",
      ]
    );
  }

  rows.push(
    [
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "VAT Control Reconciliation",
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
      "Opening VAT Control balance",
      report.openingVatControlBalance.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "VAT Return movement",
      report.netVat.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Settlement movement",
      report.totalSettlementMovement.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Opening / conversion movement",
      report.openingBalanceMovement.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Expected closing VAT Control",
      report.expectedClosingVatControlBalance.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Actual closing VAT Control",
      report.closingVatControlBalance.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Reconciliation difference",
      report.reconciliationDifference.toFixed(
        2
      ),
      "",
    ],

    [
      "",
      "",
      "",
      "Status",
      report.isReconciled
        ? "Reconciled"
        : "Difference",
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