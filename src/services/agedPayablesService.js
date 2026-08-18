import {
  getBills,
} from "./billService";

import {
  getAccounts,
} from "./accountService";

import {
  getAccountTransactions,
} from "./accountTransactionsService";

const MONEY_TOLERANCE =
  0.005;

const DEFAULT_PAYABLE_CODE =
  "200";

const DEFAULT_BASE_CURRENCY =
  "GBP";

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

const getToday = () => {
  return formatLocalDate(
    new Date()
  );
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

const dateToUtcNumber = (
  value
) => {
  const resolvedDate =
    normaliseDate(
      value
    );

  if (!resolvedDate) {
    return null;
  }

  const [
    year,
    month,
    day,
  ] = resolvedDate
    .split("-")
    .map(Number);

  return Date.UTC(
    year,
    month - 1,
    day
  );
};

const calculateDaysDifference =
  (
    earlierDate,
    laterDate
  ) => {
    const earlier =
      dateToUtcNumber(
        earlierDate
      );

    const later =
      dateToUtcNumber(
        laterDate
      );

    if (
      earlier === null ||
      later === null
    ) {
      return 0;
    }

    return Math.floor(
      (later - earlier) /
        (
          24 *
          60 *
          60 *
          1000
        )
    );
  };

const calculateBillLineTotal = (
  item,
  pricingMode = "exclusive"
) => {
  const quantity =
    Number(
      item?.quantity
    ) || 0;

  const unitPrice =
    Number(
      item?.unitPrice
    ) || 0;

  const discountRate =
    Number(
      item?.discountRate
    ) || 0;

  const vatRate =
    Number(
      item?.vatRate
    ) || 0;

  const grossAmount =
    quantity *
    unitPrice;

  const discountAmount =
    grossAmount *
    (
      discountRate /
      100
    );

  const discountedAmount =
    grossAmount -
    discountAmount;

  if (
    normaliseText(
      pricingMode
    ) ===
    "inclusive"
  ) {
    return roundMoney(
      discountedAmount
    );
  }

  return roundMoney(
    discountedAmount +
      discountedAmount *
        (
          vatRate /
          100
        )
  );
};

const calculateBillTotal = (
  bill
) => {
  const items =
    Array.isArray(
      bill?.items
    )
      ? bill.items
      : [];

  if (
    items.length > 0
  ) {
    return roundMoney(
      items.reduce(
        (
          total,
          item
        ) =>
          total +
          calculateBillLineTotal(
            item,
            bill.pricingMode ||
              "exclusive"
          ),
        0
      )
    );
  }

  const storedValues = [
    bill?.total,
    bill?.grandTotal,
    bill?.billTotal,
    bill?.amount,
  ];

  const storedTotal =
    storedValues.find(
      (
        value
      ) =>
        value !==
          undefined &&
        value !== null &&
        value !== "" &&
        Number.isFinite(
          Number(value)
        )
    );

  return roundMoney(
    storedTotal || 0
  );
};

const getBillAccountingDate = (
  bill
) => {
  return normaliseDate(
    bill?.accountingDate ||
      bill?.journalDate ||
      bill?.issueDate ||
      bill?.billDate ||
      bill?.date
  );
};

const getBillVoidDate = (
  bill
) => {
  return normaliseDate(
    bill?.voidDate ||
      bill?.voidedDate ||
      bill?.voidedAt ||
      bill?.cancelledAt ||
      bill?.canceledAt
  );
};

const billExistedAtDate = (
  bill,
  asOfDate
) => {
  const status =
    normaliseText(
      bill?.status
    );

  if (
    [
      "draft",
      "awaiting approval",
      "deleted",
    ].includes(
      status
    )
  ) {
    return false;
  }

  const accountingDate =
    getBillAccountingDate(
      bill
    );

  if (
    accountingDate &&
    accountingDate >
      asOfDate
  ) {
    return false;
  }

  if (
    [
      "void",
      "voided",
      "cancelled",
      "canceled",
    ].includes(
      status
    )
  ) {
    const voidDate =
      getBillVoidDate(
        bill
      );

    /*
    |--------------------------------------------------------------------------
    | Historical void handling
    |--------------------------------------------------------------------------
    |
    | A bill voided on 20 June still existed on 10 June.
    |
    */

    if (
      voidDate
    ) {
      return (
        asOfDate <
        voidDate
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Legacy void without date
    |--------------------------------------------------------------------------
    |
    | Exact historical reconstruction is not possible, so current-state
    | treatment excludes it.
    |
    */

    return false;
  }

  return true;
};

const getPaymentId = (
  payment
) => {
  return String(
    payment?.id ||
      payment?.paymentId ||
      ""
  );
};

const getPaymentDate = (
  payment
) => {
  return normaliseDate(
    payment?.paymentDate ||
      payment?.date ||
      payment?.transactionDate ||
      payment?.paidDate ||
      payment?.postedAt ||
      payment?.createdAt
  );
};

const getPaymentReversalDate = (
  payment
) => {
  return normaliseDate(
    payment?.reversalDate ||
      payment?.reversedDate ||
      payment?.reversedAt ||
      payment?.voidedAt ||
      payment?.cancelledAt ||
      payment?.canceledAt
  );
};

const getReversalTargetId = (
  payment
) => {
  return String(
    payment?.reversesPaymentId ||
      payment?.reversalOfPaymentId ||
      payment?.originalPaymentId ||
      ""
  );
};

const paymentIsExplicitReversal = (
  payment
) => {
  if (
    payment?.isReversal ||
    payment?.reversesPaymentId ||
    payment?.reversalOfPaymentId
  ) {
    return true;
  }

  const text =
    [
      payment?.type,
      payment?.action,
      payment?.sourceAction,
      payment?.description,
    ]
      .filter(Boolean)
      .map(
        normaliseText
      )
      .join(" ");

  return (
    text.includes(
      "payment reversal"
    ) ||
    text.includes(
      "reverse payment"
    )
  );
};

const paymentIsPermanentlyExcluded =
  (
    payment
  ) => {
    const status =
      normaliseText(
        payment?.status
      );

    return [
      "draft",
      "deleted",
      "cancelled",
      "canceled",
      "void",
      "voided",
    ].includes(
      status
    );
  };

const getPaymentSignedAmount = (
  payment
) => {
  const amount =
    roundMoney(
      payment?.amount
    );

  if (
    paymentIsExplicitReversal(
      payment
    )
  ) {
    return roundMoney(
      -Math.abs(
        amount
      )
    );
  }

  return roundMoney(
    Math.abs(
      amount
    )
  );
};

const getLinkedReversalTargets = (
  payments
) => {
  const targets =
    new Set();

  payments.forEach(
    (
      payment
    ) => {
      if (
        !paymentIsExplicitReversal(
          payment
        )
      ) {
        return;
      }

      const targetId =
        getReversalTargetId(
          payment
        );

      if (
        targetId
      ) {
        targets.add(
          targetId
        );
      }
    }
  );

  return targets;
};

const paymentAffectsAsOfDate = (
  payment,
  asOfDate,
  linkedReversalTargets
) => {
  if (
    paymentIsPermanentlyExcluded(
      payment
    )
  ) {
    return false;
  }

  const paymentDate =
    getPaymentDate(
      payment
    );

  if (
    paymentDate &&
    paymentDate >
      asOfDate
  ) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Explicit reversal payment
  |--------------------------------------------------------------------------
  |
  | This remains as a negative payment from its reversal date onwards.
  |
  */

  if (
    paymentIsExplicitReversal(
      payment
    )
  ) {
    return true;
  }

  const status =
    normaliseText(
      payment?.status
    );

  if (
    status !== "reversed"
  ) {
    return true;
  }

  const paymentId =
    getPaymentId(
      payment
    );

  /*
  |--------------------------------------------------------------------------
  | Separate reversal record exists
  |--------------------------------------------------------------------------
  |
  | Keep the original payment positive. The linked reversal record will
  | offset it from its own accounting date.
  |
  */

  if (
    paymentId &&
    linkedReversalTargets.has(
      paymentId
    )
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Reversal represented only on the original payment record
  |--------------------------------------------------------------------------
  */

  const reversalDate =
    getPaymentReversalDate(
      payment
    );

  if (
    reversalDate
  ) {
    return (
      asOfDate <
      reversalDate
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Legacy reversed record without reversal date
  |--------------------------------------------------------------------------
  */

  return false;
};

const calculateDetailedPaymentsAsOf =
  (
    payments,
    asOfDate
  ) => {
    const linkedReversalTargets =
      getLinkedReversalTargets(
        payments
      );

    return roundMoney(
      payments.reduce(
        (
          total,
          payment
        ) => {
          if (
            !paymentAffectsAsOfDate(
              payment,
              asOfDate,
              linkedReversalTargets
            )
          ) {
            return total;
          }

          return roundMoney(
            total +
              getPaymentSignedAmount(
                payment
              )
          );
        },
        0
      )
    );
  };

const calculateCurrentDetailedPayments =
  (
    payments
  ) => {
    return calculateDetailedPaymentsAsOf(
      payments,
      "9999-12-31"
    );
  };

const getLegacyPaymentDate = (
  bill
) => {
  return normaliseDate(
    bill?.paidDate ||
      bill?.paymentDate ||
      bill?.lastPaymentDate ||
      bill?.lastPaidAt
  );
};

const calculateBillAmountPaidAsOf = (
  bill,
  asOfDate
) => {
  const payments =
    Array.isArray(
      bill?.payments
    )
      ? bill.payments
      : [];

  const detailedAmountPaid =
    calculateDetailedPaymentsAsOf(
      payments,
      asOfDate
    );

  const currentDetailedTotal =
    calculateCurrentDetailedPayments(
      payments
    );

  const storedAmountPaid =
    roundMoney(
      bill?.amountPaid
    );

  /*
  |--------------------------------------------------------------------------
  | Legacy amountPaid compatibility
  |--------------------------------------------------------------------------
  |
  | Some older bills may contain amountPaid but no detailed payment records.
  | Avoid adding the same payment twice when detailed records exist.
  |
  */

  const legacyAmountPaid =
    roundMoney(
      Math.max(
        storedAmountPaid -
          currentDetailedTotal,
        0
      )
    );

  if (
    legacyAmountPaid <=
    MONEY_TOLERANCE
  ) {
    return {
      amountPaid:
        roundMoney(
          Math.max(
            detailedAmountPaid,
            0
          )
        ),

      detailedAmountPaid,

      legacyAmountPaid: 0,

      legacyPaymentTimingUncertain:
        false,
    };
  }

  const legacyPaymentDate =
    getLegacyPaymentDate(
      bill
    );

  if (
    legacyPaymentDate &&
    legacyPaymentDate >
      asOfDate
  ) {
    return {
      amountPaid:
        roundMoney(
          Math.max(
            detailedAmountPaid,
            0
          )
        ),

      detailedAmountPaid,

      legacyAmountPaid,

      legacyPaymentTimingUncertain:
        false,
    };
  }

  return {
    amountPaid:
      roundMoney(
        Math.max(
          detailedAmountPaid +
            legacyAmountPaid,
          0
        )
      ),

    detailedAmountPaid,

    legacyAmountPaid,

    legacyPaymentTimingUncertain:
      !legacyPaymentDate,
  };
};

const getAgeBucket = (
  daysOverdue
) => {
  if (
    daysOverdue <= 0
  ) {
    return "current";
  }

  if (
    daysOverdue <= 30
  ) {
    return "days1To30";
  }

  if (
    daysOverdue <= 60
  ) {
    return "days31To60";
  }

  if (
    daysOverdue <= 90
  ) {
    return "days61To90";
  }

  return "daysOver90";
};

const getBucketLabel = (
  bucket
) => {
  const labels = {
    current:
      "Current",

    days1To30:
      "1–30 days",

    days31To60:
      "31–60 days",

    days61To90:
      "61–90 days",

    daysOver90:
      "Over 90 days",
  };

  return (
    labels[bucket] ||
    "Current"
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
    row.supplier,
    row.supplierEmail,
    row.billNumber,
    row.supplierReference,
    row.purchaseOrderNumber,
    row.status,
    row.bucketLabel,
    row.currency,
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
      if (
        second.daysOverdue !==
        first.daysOverdue
      ) {
        return (
          second.daysOverdue -
          first.daysOverdue
        );
      }

      const dueDateDifference =
        String(
          first.dueDate ||
            ""
        ).localeCompare(
          String(
            second.dueDate ||
              ""
          )
        );

      if (
        dueDateDifference !==
        0
      ) {
        return dueDateDifference;
      }

      return String(
        first.billNumber ||
          ""
      ).localeCompare(
        String(
          second.billNumber ||
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

const findPayablesAccount =
  () => {
    const accounts =
      getAccounts({
        status: "All",
      });

    const accountList =
      Array.isArray(
        accounts
      )
        ? accounts
        : [];

    const byCode =
      accountList.find(
        (
          account
        ) =>
          String(
            account.code ||
              ""
          ) ===
          DEFAULT_PAYABLE_CODE
      );

    if (
      byCode
    ) {
      return byCode;
    }

    return (
      accountList.find(
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
              "accounts payable"
            ) ||
            text.includes(
              "trade payable"
            ) ||
            text.includes(
              "trade creditor"
            )
          );
        }
      ) ||
      null
    );
  };

const getPayablesLedgerControl = (
  asOfDate
) => {
  const account =
    findPayablesAccount();

  if (
    !account
  ) {
    return {
      available:
        false,

      account: null,

      balance: 0,

      balanceSide:
        "Credit",

      error:
        "Accounts Payable ledger account was not found.",
    };
  }

  try {
    const ledger =
      getAccountTransactions({
        accountId:
          account.id,

        fromDate: "",

        toDate:
          asOfDate,

        search: "",
      });

    return {
      available: true,

      account,

      balance:
        roundMoney(
          ledger.closingBalance
        ),

      balanceSide:
        ledger.closingBalanceSide ||
        ledger.accountNormalBalance ||
        "Credit",

      error: "",
    };
  } catch (
    controlError
  ) {
    return {
      available:
        false,

      account,

      balance: 0,

      balanceSide:
        "Credit",

      error:
        controlError.message ||
        "Accounts Payable ledger balance could not be calculated.",
    };
  }
};

const createCurrencyTotals = (
  rows
) => {
  const totals = {};

  rows.forEach(
    (
      row
    ) => {
      const currency =
        String(
          row.currency ||
            DEFAULT_BASE_CURRENCY
        )
          .trim()
          .toUpperCase();

      totals[currency] =
        roundMoney(
          Number(
            totals[currency] ||
              0
          ) +
            Number(
              row.outstanding ||
                0
            )
        );
    }
  );

  return totals;
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

export const getAgedPayables = (
  {
    asOfDate = "",
    search = "",
    bucket = "all",
    baseCurrency =
      DEFAULT_BASE_CURRENCY,
  } = {}
) => {
  const resolvedAsOfDate =
    asOfDate
      ? normaliseDate(
          asOfDate
        )
      : getToday();

  if (
    asOfDate &&
    !resolvedAsOfDate
  ) {
    throw new Error(
      "The Aged Payables reporting date is invalid."
    );
  }

  const searchValue =
    normaliseText(
      search
    );

  const billsResult =
    getBills();

  const bills =
    Array.isArray(
      billsResult
    )
      ? billsResult
      : [];

  /*
  |--------------------------------------------------------------------------
  | Historical supplier subledger
  |--------------------------------------------------------------------------
  */

  const allRows =
    sortRows(
      bills
        .filter(
          (
            bill
          ) =>
            billExistedAtDate(
              bill,
              resolvedAsOfDate
            )
        )
        .map(
          (
            bill
          ) => {
            const billTotal =
              calculateBillTotal(
                bill
              );

            const paymentState =
              calculateBillAmountPaidAsOf(
                bill,
                resolvedAsOfDate
              );

            const amountPaid =
              roundMoney(
                paymentState.amountPaid
              );

            const outstanding =
              roundMoney(
                Math.max(
                  billTotal -
                    amountPaid,
                  0
                )
              );

            const issueDate =
              getBillAccountingDate(
                bill
              );

            const dueDate =
              normaliseDate(
                bill.dueDate
              );

            const daysOverdue =
              dueDate
                ? Math.max(
                    calculateDaysDifference(
                      dueDate,
                      resolvedAsOfDate
                    ),
                    0
                  )
                : 0;

            const ageBucket =
              getAgeBucket(
                daysOverdue
              );

            return {
              id:
                bill.id,

              billId:
                bill.id,

              billNumber:
                bill.billNumber ||
                "",

              supplierId:
                bill.supplierId ??
                null,

              supplier:
                bill.supplier ||
                bill.supplierName ||
                "Unknown supplier",

              supplierEmail:
                bill.supplierEmail ||
                "",

              supplierReference:
                bill.supplierReference ||
                "",

              purchaseOrderId:
                bill.purchaseOrderId ??
                null,

              purchaseOrderNumber:
                bill.purchaseOrderNumber ||
                "",

              issueDate,

              dueDate,

              status:
                bill.status ||
                "Awaiting payment",

              currency:
                String(
                  bill.currency ||
                    DEFAULT_BASE_CURRENCY
                ).toUpperCase(),

              billTotal,

              amountPaid,

              detailedAmountPaid:
                paymentState.detailedAmountPaid,

              legacyAmountPaid:
                paymentState.legacyAmountPaid,

              legacyPaymentTimingUncertain:
                paymentState.legacyPaymentTimingUncertain,

              outstanding,

              daysOverdue,

              bucket:
                ageBucket,

              bucketLabel:
                getBucketLabel(
                  ageBucket
                ),
            };
          }
        )
        .filter(
          (
            row
          ) =>
            row.outstanding >
            MONEY_TOLERANCE
        )
    );

  /*
  |--------------------------------------------------------------------------
  | Currency separation
  |--------------------------------------------------------------------------
  |
  | We cannot mathematically add GBP, USD and EUR supplier balances together
  | without an exchange-rate conversion layer.
  |
  | The A/P control reconciliation therefore uses base-currency bills only.
  |
  */

  const normalisedBaseCurrency =
    String(
      baseCurrency ||
        DEFAULT_BASE_CURRENCY
    )
      .trim()
      .toUpperCase();

  const baseCurrencyRows =
    allRows.filter(
      (
        row
      ) =>
        String(
          row.currency
        )
          .trim()
          .toUpperCase() ===
        normalisedBaseCurrency
    );

  const foreignCurrencyRows =
    allRows.filter(
      (
        row
      ) =>
        String(
          row.currency
        )
          .trim()
          .toUpperCase() !==
        normalisedBaseCurrency
    );

  /*
  |--------------------------------------------------------------------------
  | Full accounting ageing totals
  |--------------------------------------------------------------------------
  |
  | Search and ageing-bucket filters must never change these totals.
  |
  */

  const bucketTotals = {
    current: 0,

    days1To30: 0,

    days31To60: 0,

    days61To90: 0,

    daysOver90: 0,
  };

  baseCurrencyRows.forEach(
    (
      row
    ) => {
      bucketTotals[
        row.bucket
      ] =
        roundMoney(
          bucketTotals[
            row.bucket
          ] +
            row.outstanding
        );
    }
  );

  const totalOutstanding =
    roundMoney(
      baseCurrencyRows.reduce(
        (
          total,
          row
        ) =>
          total +
          Number(
            row.outstanding ||
              0
          ),
        0
      )
    );

  const currentOutstanding =
    roundMoney(
      bucketTotals.current
    );

  const overdueOutstanding =
    roundMoney(
      baseCurrencyRows.reduce(
        (
          total,
          row
        ) =>
          row.daysOverdue >
          0
            ? total +
              Number(
                row.outstanding ||
                  0
              )
            : total,
        0
      )
    );

  const overdueBillCount =
    baseCurrencyRows.filter(
      (
        row
      ) =>
        row.daysOverdue >
        0
    ).length;

  const supplierIds =
    new Set(
      baseCurrencyRows.map(
        (
          row
        ) =>
          row.supplierId ??
          row.supplier
      )
    );

  /*
  |--------------------------------------------------------------------------
  | Presentation filters
  |--------------------------------------------------------------------------
  */

  const visibleRows =
    allRows.filter(
      (
        row
      ) => {
        if (
          bucket !==
            "all" &&
          row.bucket !==
            bucket
        ) {
          return false;
        }

        return rowMatchesSearch(
          row,
          searchValue
        );
      }
    );

  const visibleBaseCurrencyRows =
    visibleRows.filter(
      (
        row
      ) =>
        String(
          row.currency
        )
          .trim()
          .toUpperCase() ===
        normalisedBaseCurrency
    );

  const visibleOutstanding =
    roundMoney(
      visibleBaseCurrencyRows.reduce(
        (
          total,
          row
        ) =>
          total +
          Number(
            row.outstanding ||
              0
          ),
        0
      )
    );

  /*
  |--------------------------------------------------------------------------
  | Accounts Payable control reconciliation
  |--------------------------------------------------------------------------
  |
  | Supplier subledger:
  |
  |     Aged Payables
  |
  | must reconcile with:
  |
  |     200 Accounts Payable
  |
  | at exactly the same reporting date.
  |
  */

  const ledgerControl =
    getPayablesLedgerControl(
      resolvedAsOfDate
    );

  const ledgerPayablesBalance =
    ledgerControl.available
      ? roundMoney(
          ledgerControl.balance
        )
      : 0;

  const reconciliationDifference =
    ledgerControl.available
      ? roundMoney(
          totalOutstanding -
            ledgerPayablesBalance
        )
      : 0;

  const isReconciled =
    ledgerControl.available
      ? Math.abs(
          reconciliationDifference
        ) <=
        MONEY_TOLERANCE
      : false;

  /*
  |--------------------------------------------------------------------------
  | Legacy data diagnostics
  |--------------------------------------------------------------------------
  */

  const legacyTimingRows =
    allRows.filter(
      (
        row
      ) =>
        row.legacyPaymentTimingUncertain
    );

  return {
    asOfDate:
      resolvedAsOfDate,

    baseCurrency:
      normalisedBaseCurrency,

    rows:
      visibleRows,

    /*
    |--------------------------------------------------------------------------
    | Existing page API
    |--------------------------------------------------------------------------
    */

    totalOutstanding,

    currentOutstanding,

    overdueOutstanding,

    overdueBillCount,

    billCount:
      baseCurrencyRows.length,

    visibleBillCount:
      visibleRows.length,

    supplierCount:
      supplierIds.size,

    bucketTotals,

    /*
    |--------------------------------------------------------------------------
    | Additional count information
    |--------------------------------------------------------------------------
    */

    allCurrencyBillCount:
      allRows.length,

    baseCurrencyBillCount:
      baseCurrencyRows.length,

    visibleBaseCurrencyBillCount:
      visibleBaseCurrencyRows.length,

    /*
    |--------------------------------------------------------------------------
    | Filter controls
    |--------------------------------------------------------------------------
    */

    visibleOutstanding,

    searchActive:
      Boolean(
        searchValue
      ),

    bucketFilterActive:
      bucket !== "all",

    /*
    |--------------------------------------------------------------------------
    | Accounts Payable reconciliation
    |--------------------------------------------------------------------------
    */

    reconciliationAvailable:
      ledgerControl.available,

    payablesAccountId:
      ledgerControl.account?.id ||
      null,

    payablesAccountCode:
      ledgerControl.account?.code ||
      DEFAULT_PAYABLE_CODE,

    payablesAccountName:
      ledgerControl.account?.name ||
      "Accounts Payable",

    ledgerPayablesBalance,

    ledgerPayablesBalanceSide:
      ledgerControl.balanceSide ||
      "Credit",

    reconciliationDifference,

    isReconciled,

    reconciliationError:
      ledgerControl.error ||
      "",

    /*
    |--------------------------------------------------------------------------
    | Legacy payment diagnostics
    |--------------------------------------------------------------------------
    */

    legacyPaymentTimingUncertainCount:
      legacyTimingRows.length,

    hasLegacyPaymentTimingUncertainty:
      legacyTimingRows.length >
      0,

    /*
    |--------------------------------------------------------------------------
    | Currency diagnostics
    |--------------------------------------------------------------------------
    */

    currencyTotals:
      createCurrencyTotals(
        allRows
      ),

    foreignCurrencyRows,

    foreignCurrencyBillCount:
      foreignCurrencyRows.length,

    hasForeignCurrencyBalances:
      foreignCurrencyRows.length >
      0,
  };
};

export const exportAgedPayablesCsv = (
  options = {}
) => {
  const report =
    getAgedPayables(
      options
    );

  const rows = [
    [
      "Aged Payables",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "As at",
      report.asOfDate,
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "Base currency",
      report.baseCurrency,
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "A/P control account",
      `${report.payablesAccountCode} — ${report.payablesAccountName}`,
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "Aged payables",
      report.totalOutstanding.toFixed(
        2
      ),
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "A/P ledger balance",
      report.reconciliationAvailable
        ? report.ledgerPayablesBalance.toFixed(
            2
          )
        : "Unavailable",
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "Reconciliation difference",
      report.reconciliationAvailable
        ? report.reconciliationDifference.toFixed(
            2
          )
        : "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "Reconciliation status",
      report.reconciliationAvailable
        ? report.isReconciled
          ? "Reconciled"
          : "Difference"
        : "Unavailable",
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
      "",
      "",
      "",
      "",
      "",
    ],

    [
      "Supplier",
      "Bill",
      "Issue Date",
      "Due Date",
      "Days Overdue",
      "Age Bucket",
      "Currency",
      "Outstanding",
    ],

    ...report.rows.map(
      (
        row
      ) => [
        row.supplier,
        row.billNumber,
        row.issueDate ||
          "",
        row.dueDate ||
          "",
        row.daysOverdue,
        row.bucketLabel,
        row.currency,
        row.outstanding.toFixed(
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
      "",
      "",
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "Current",
      report.baseCurrency,
      report.bucketTotals.current.toFixed(
        2
      ),
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "1–30 days",
      report.baseCurrency,
      report.bucketTotals.days1To30.toFixed(
        2
      ),
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "31–60 days",
      report.baseCurrency,
      report.bucketTotals.days31To60.toFixed(
        2
      ),
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "61–90 days",
      report.baseCurrency,
      report.bucketTotals.days61To90.toFixed(
        2
      ),
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "Over 90 days",
      report.baseCurrency,
      report.bucketTotals.daysOver90.toFixed(
        2
      ),
    ],

    [
      "",
      "",
      "",
      "",
      "",
      "Total outstanding",
      report.baseCurrency,
      report.totalOutstanding.toFixed(
        2
      ),
    ],
  ];

  if (
    report.hasForeignCurrencyBalances
  ) {
    rows.push(
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Foreign currency balances",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      ...Object.entries(
        report.currencyTotals
      )
        .filter(
          (
            [
              currency,
            ]
          ) =>
            currency !==
            report.baseCurrency
        )
        .map(
          (
            [
              currency,
              total,
            ]
          ) => [
            "",
            "",
            "",
            "",
            "",
            "Outstanding",
            currency,
            Number(
              total
            ).toFixed(
              2
            ),
          ]
        )
    );
  }

  if (
    report.hasLegacyPaymentTimingUncertainty
  ) {
    rows.push(
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Data quality warning",
        `${report.legacyPaymentTimingUncertainCount} bill(s) contain legacy paid amounts without a payment date.`,
        "",
        "",
        "",
        "",
        "",
        "",
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