import {
  getInvoices,
} from "./invoiceService";

import {
  getAccounts,
} from "./accountService";

import {
  getAccountTransactions,
} from "./accountTransactionsService";

const MONEY_TOLERANCE =
  0.005;

const DEFAULT_RECEIVABLE_CODE =
  "110";

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

  if (
    !resolvedDate
  ) {
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

const calculateInvoiceLineTotal =
  (
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

const calculateInvoiceTotal = (
  invoice
) => {
  const items =
    Array.isArray(
      invoice?.items
    )
      ? invoice.items
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
          calculateInvoiceLineTotal(
            item,
            invoice.pricingMode ||
              "exclusive"
          ),
        0
      )
    );
  }

  const storedValues = [
    invoice?.total,
    invoice?.grandTotal,
    invoice?.invoiceTotal,
    invoice?.amount,
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

const getInvoiceAccountingDate =
  (
    invoice
  ) => {
    return normaliseDate(
      invoice?.accountingDate ||
        invoice?.journalDate ||
        invoice?.issueDate ||
        invoice?.invoiceDate ||
        invoice?.date
    );
  };

const getInvoiceVoidDate = (
  invoice
) => {
  return normaliseDate(
    invoice?.voidDate ||
      invoice?.voidedDate ||
      invoice?.voidedAt ||
      invoice?.cancelledDate ||
      invoice?.canceledDate ||
      invoice?.cancelledAt ||
      invoice?.canceledAt
  );
};

const invoiceIsAlwaysExcluded =
  (
    invoice
  ) => {
    const status =
      normaliseText(
        invoice?.status
      );

    return [
      "draft",
      "awaiting approval",
      "deleted",
    ].includes(
      status
    );
  };

const invoiceIsVoided = (
  invoice
) => {
  const status =
    normaliseText(
      invoice?.status
    );

  return [
    "voided",
    "void",
    "cancelled",
    "canceled",
  ].includes(
    status
  );
};

const invoiceExistedAtDate = (
  invoice,
  asOfDate
) => {
  if (
    invoiceIsAlwaysExcluded(
      invoice
    )
  ) {
    return false;
  }

  const accountingDate =
    getInvoiceAccountingDate(
      invoice
    );

  /*
  |--------------------------------------------------------------------------
  | Invoice did not yet exist
  |--------------------------------------------------------------------------
  */

  if (
    accountingDate &&
    accountingDate >
      asOfDate
  ) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Historical void / cancellation handling
  |--------------------------------------------------------------------------
  |
  | Example:
  |
  | Invoice issued        01 June
  | Invoice voided        20 June
  |
  | Report at 10 June:
  |   invoice DID exist
  |
  | Report at 25 June:
  |   invoice no longer forms part of receivables
  |
  */

  if (
    invoiceIsVoided(
      invoice
    )
  ) {
    const voidDate =
      getInvoiceVoidDate(
        invoice
      );

    if (
      !voidDate
    ) {
      /*
      |--------------------------------------------------------------------------
      | Legacy voided invoice with no void date
      |--------------------------------------------------------------------------
      |
      | We cannot reconstruct when it ceased to exist.
      | Use current-state treatment and exclude it.
      |
      */

      return false;
    }

    if (
      voidDate <=
      asOfDate
    ) {
      return false;
    }
  }

  return true;
};

const getPaymentDate = (
  payment
) => {
  return normaliseDate(
    payment?.paymentDate ||
      payment?.date ||
      payment?.transactionDate ||
      payment?.receivedDate ||
      payment?.postedAt ||
      payment?.createdAt
  );
};

const getPaymentReversalDate =
  (
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

const getPaymentId = (
  payment
) => {
  const id =
    payment?.id ??
    payment?.paymentId ??
    null;

  if (
    id === null ||
    id === undefined ||
    id === ""
  ) {
    return "";
  }

  return String(
    id
  );
};

const getPaymentReversalTargetId =
  (
    payment
  ) => {
    const targetId =
      payment?.reversesPaymentId ??
      payment?.reversalOfPaymentId ??
      payment?.originalPaymentId ??
      null;

    if (
      targetId === null ||
      targetId === undefined ||
      targetId === ""
    ) {
      return "";
    }

    return String(
      targetId
    );
  };

const paymentIsExplicitReversal =
  (
    payment
  ) => {
    if (
      payment?.isReversal ||
      getPaymentReversalTargetId(
        payment
      )
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
      ) ||
      text.includes(
        "reversed payment"
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

const getPaymentAmount = (
  payment
) => {
  const values = [
    payment?.amount,
    payment?.paymentAmount,
    payment?.amountPaid,
    payment?.receivedAmount,
  ];

  const value =
    values.find(
      (
        candidate
      ) =>
        candidate !==
          undefined &&
        candidate !== null &&
        candidate !== "" &&
        Number.isFinite(
          Number(
            candidate
          )
        )
    );

  return roundMoney(
    value || 0
  );
};

const getPaymentSignedAmount =
  (
    payment
  ) => {
    const amount =
      getPaymentAmount(
        payment
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

const getLinkedReversalTargetIds =
  (
    payments
  ) => {
    const ids =
      new Set();

    payments.forEach(
      (
        payment
      ) => {
        if (
          paymentIsPermanentlyExcluded(
            payment
          )
        ) {
          return;
        }

        if (
          !paymentIsExplicitReversal(
            payment
          )
        ) {
          return;
        }

        const targetId =
          getPaymentReversalTargetId(
            payment
          );

        if (
          targetId
        ) {
          ids.add(
            targetId
          );
        }
      }
    );

    return ids;
  };

const paymentHasLinkedReversal =
  (
    payment,
    linkedReversalTargetIds
  ) => {
    const paymentId =
      getPaymentId(
        payment
      );

    if (
      !paymentId
    ) {
      return false;
    }

    return linkedReversalTargetIds.has(
      paymentId
    );
  };

const paymentAffectsAsOfDate =
  (
    payment,
    asOfDate,
    linkedReversalTargetIds
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
    | Explicit reversal record
    |--------------------------------------------------------------------------
    |
    | The reversal itself contributes a negative payment from its own date.
    |
    | Example:
    |
    | Payment      10 June   +£500
    | Reversal     20 June   -£500
    |
    | As at 15 June -> £500 paid
    | As at 25 June -> £0 paid
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
      status !==
      "reversed"
    ) {
      return true;
    }

    /*
    |--------------------------------------------------------------------------
    | Original payment with a separate reversal record
    |--------------------------------------------------------------------------
    |
    | When the original is marked Reversed AND a separate linked reversal
    | exists, the original must remain positive.
    |
    | The reversal record itself supplies the negative amount.
    |
    | Otherwise we would reverse the payment twice.
    |
    */

    if (
      paymentHasLinkedReversal(
        payment,
        linkedReversalTargetIds
      )
    ) {
      return true;
    }

    /*
    |--------------------------------------------------------------------------
    | Legacy reversal stored only on the original payment
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
    | Legacy reversed payment without a reversal date
    |--------------------------------------------------------------------------
    */

    return false;
  };

const calculateDetailedPaymentsAsOf =
  (
    payments,
    asOfDate
  ) => {
    const linkedReversalTargetIds =
      getLinkedReversalTargetIds(
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
              linkedReversalTargetIds
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
    const linkedReversalTargetIds =
      getLinkedReversalTargetIds(
        payments
      );

    return roundMoney(
      payments.reduce(
        (
          total,
          payment
        ) => {
          if (
            paymentIsPermanentlyExcluded(
              payment
            )
          ) {
            return total;
          }

          if (
            paymentIsExplicitReversal(
              payment
            )
          ) {
            return roundMoney(
              total +
                getPaymentSignedAmount(
                  payment
                )
            );
          }

          const status =
            normaliseText(
              payment?.status
            );

          if (
            status ===
            "reversed"
          ) {
            /*
            |--------------------------------------------------------------------------
            | Separate linked reversal exists
            |--------------------------------------------------------------------------
            |
            | Keep original positive because linked reversal contributes the
            | negative value.
            |
            */

            if (
              paymentHasLinkedReversal(
                payment,
                linkedReversalTargetIds
              )
            ) {
              return roundMoney(
                total +
                  getPaymentSignedAmount(
                    payment
                  )
              );
            }

            /*
            |--------------------------------------------------------------------------
            | Original-only legacy reversal
            |--------------------------------------------------------------------------
            |
            | Current state no longer includes the payment.
            |
            */

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

const getLegacyPaymentDate = (
  invoice
) => {
  return normaliseDate(
    invoice?.paidDate ||
      invoice?.paymentDate ||
      invoice?.lastPaymentDate ||
      invoice?.lastPaidAt
  );
};

const calculateInvoiceAmountPaidAsOf =
  (
    invoice,
    asOfDate
  ) => {
    const payments =
      Array.isArray(
        invoice?.payments
      )
        ? invoice.payments
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
        invoice?.amountPaid
      );

    /*
    |--------------------------------------------------------------------------
    | Legacy payment compatibility
    |--------------------------------------------------------------------------
    |
    | Older invoice data may have:
    |
    |   invoice.amountPaid
    |
    | without individual payment records.
    |
    | We retain only the portion not already explained by detailed payments.
    |
    */

    const explainedDetailedAmount =
      Math.max(
        currentDetailedTotal,
        0
      );

    const legacyAmountPaid =
      roundMoney(
        Math.max(
          storedAmountPaid -
            explainedDetailedAmount,
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

        currentDetailedTotal,

        legacyAmountPaid: 0,

        legacyPaymentTimingUncertain:
          false,
      };
    }

    const legacyPaymentDate =
      getLegacyPaymentDate(
        invoice
      );

    /*
    |--------------------------------------------------------------------------
    | Known legacy payment date is after report date
    |--------------------------------------------------------------------------
    */

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

        currentDetailedTotal,

        legacyAmountPaid,

        legacyPaymentTimingUncertain:
          false,
      };
    }

    /*
    |--------------------------------------------------------------------------
    | Known or undated legacy payment existed by reporting date
    |--------------------------------------------------------------------------
    */

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

      currentDetailedTotal,

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

const invoiceMatchesSearch =
  (
    row,
    searchValue
  ) => {
    if (
      !searchValue
    ) {
      return true;
    }

    return [
      row.customer,
      row.customerEmail,
      row.invoiceNumber,
      row.reference,
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
        first.invoiceNumber ||
          ""
      ).localeCompare(
        String(
          second.invoiceNumber ||
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

const findReceivablesAccount =
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
          DEFAULT_RECEIVABLE_CODE
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
              "accounts receivable"
            ) ||
            text.includes(
              "trade receivable"
            ) ||
            text.includes(
              "trade debtor"
            )
          );
        }
      ) ||
      null
    );
  };

const getReceivablesLedgerControl =
  (
    asOfDate
  ) => {
    const account =
      findReceivablesAccount();

    if (
      !account
    ) {
      return {
        available: false,

        account: null,

        balance: 0,

        balanceSide:
          "Debit",

        error:
          "Accounts Receivable ledger account was not found.",
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
          "Debit",

        error: "",
      };
    } catch (
      controlError
    ) {
      return {
        available: false,

        account,

        balance: 0,

        balanceSide:
          "Debit",

        error:
          controlError.message ||
          "Accounts Receivable ledger balance could not be calculated.",
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

export const getAgedReceivables =
  ({
    asOfDate = "",
    search = "",
    bucket = "all",
    baseCurrency =
      DEFAULT_BASE_CURRENCY,
  } = {}) => {
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
        "The Aged Receivables reporting date is invalid."
      );
    }

    const searchValue =
      normaliseText(
        search
      );

    const invoicesResult =
      getInvoices();

    const invoices =
      Array.isArray(
        invoicesResult
      )
        ? invoicesResult
        : [];

    /*
    |--------------------------------------------------------------------------
    | Historical invoice subledger
    |--------------------------------------------------------------------------
    */

    const allRows =
      sortRows(
        invoices
          .filter(
            (
              invoice
            ) =>
              invoiceExistedAtDate(
                invoice,
                resolvedAsOfDate
              )
          )
          .map(
            (
              invoice
            ) => {
              const invoiceTotal =
                calculateInvoiceTotal(
                  invoice
                );

              const paymentState =
                calculateInvoiceAmountPaidAsOf(
                  invoice,
                  resolvedAsOfDate
                );

              const amountPaid =
                roundMoney(
                  paymentState.amountPaid
                );

              const outstanding =
                roundMoney(
                  Math.max(
                    invoiceTotal -
                      amountPaid,
                    0
                  )
                );

              const issueDate =
                getInvoiceAccountingDate(
                  invoice
                );

              const dueDate =
                normaliseDate(
                  invoice.dueDate
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

              const currency =
                String(
                  invoice.currency ||
                    DEFAULT_BASE_CURRENCY
                )
                  .trim()
                  .toUpperCase();

              return {
                id:
                  invoice.id,

                invoiceId:
                  invoice.id,

                invoiceNumber:
                  invoice.invoiceNumber ||
                  "",

                customerId:
                  invoice.customerId ??
                  null,

                customer:
                  invoice.customer ||
                  invoice.customerName ||
                  "Unknown customer",

                customerEmail:
                  invoice.customerEmail ||
                  "",

                issueDate,

                dueDate,

                reference:
                  invoice.reference ||
                  "",

                status:
                  invoice.status ||
                  "Awaiting payment",

                currency,

                invoiceTotal,

                amountPaid,

                detailedAmountPaid:
                  paymentState.detailedAmountPaid,

                currentDetailedAmountPaid:
                  paymentState.currentDetailedTotal,

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
    | Currency control
    |--------------------------------------------------------------------------
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
          row.currency ===
          normalisedBaseCurrency
      );

    const foreignCurrencyRows =
      allRows.filter(
        (
          row
        ) =>
          row.currency !==
          normalisedBaseCurrency
      );

    /*
    |--------------------------------------------------------------------------
    | Full accounting totals
    |--------------------------------------------------------------------------
    |
    | Search and ageing filters do not alter these totals.
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
            row.outstanding,
          0
        )
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
                row.outstanding
              : total,
          0
        )
      );

    const currentOutstanding =
      roundMoney(
        bucketTotals.current
      );

    const overdueInvoiceCount =
      baseCurrencyRows.filter(
        (
          row
        ) =>
          row.daysOverdue >
          0
      ).length;

    const customerIds =
      new Set(
        baseCurrencyRows.map(
          (
            row
          ) =>
            row.customerId ??
            row.customer
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
            bucket !== "all" &&
            row.bucket !==
              bucket
          ) {
            return false;
          }

          return invoiceMatchesSearch(
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
          row.currency ===
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
            row.outstanding,
          0
        )
      );

    /*
    |--------------------------------------------------------------------------
    | Accounts Receivable reconciliation
    |--------------------------------------------------------------------------
    */

    const ledgerControl =
      getReceivablesLedgerControl(
        resolvedAsOfDate
      );

    const ledgerReceivablesBalance =
      ledgerControl.available
        ? roundMoney(
            ledgerControl.balance
          )
        : 0;

    const reconciliationDifference =
      ledgerControl.available
        ? roundMoney(
            totalOutstanding -
              ledgerReceivablesBalance
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
    | Data-quality diagnostics
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
      | Summary
      |--------------------------------------------------------------------------
      */

      totalOutstanding,

      currentOutstanding,

      overdueOutstanding,

      overdueInvoiceCount,

      invoiceCount:
        baseCurrencyRows.length,

      allCurrencyInvoiceCount:
        allRows.length,

      visibleInvoiceCount:
        visibleRows.length,

      customerCount:
        customerIds.size,

      bucketTotals,

      /*
      |--------------------------------------------------------------------------
      | Visible presentation totals
      |--------------------------------------------------------------------------
      */

      visibleOutstanding,

      visibleBaseCurrencyInvoiceCount:
        visibleBaseCurrencyRows.length,

      searchActive:
        Boolean(
          searchValue
        ),

      bucketFilterActive:
        bucket !== "all",

      /*
      |--------------------------------------------------------------------------
      | Accounts Receivable reconciliation
      |--------------------------------------------------------------------------
      */

      reconciliationAvailable:
        ledgerControl.available,

      receivablesAccountId:
        ledgerControl.account?.id ||
        null,

      receivablesAccountCode:
        ledgerControl.account?.code ||
        DEFAULT_RECEIVABLE_CODE,

      receivablesAccountName:
        ledgerControl.account?.name ||
        "Accounts Receivable",

      ledgerReceivablesBalance,

      ledgerReceivablesBalanceSide:
        ledgerControl.balanceSide ||
        "Debit",

      reconciliationDifference,

      isReconciled,

      reconciliationError:
        ledgerControl.error ||
        "",

      /*
      |--------------------------------------------------------------------------
      | Legacy-data diagnostics
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

      foreignCurrencyInvoiceCount:
        foreignCurrencyRows.length,

      hasForeignCurrencyBalances:
        foreignCurrencyRows.length >
        0,
    };
  };

export const exportAgedReceivablesCsv =
  (
    options = {}
  ) => {
    const report =
      getAgedReceivables(
        options
      );

    const rows = [
      [
        "Aged Receivables",
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
        "A/R control account",
        `${report.receivablesAccountCode} — ${report.receivablesAccountName}`,
        "",
        "",
        "",
        "",
        "",
        "",
      ],

      [
        "Aged receivables",
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
        "A/R ledger balance",
        report.reconciliationAvailable
          ? report.ledgerReceivablesBalance.toFixed(
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
        "Customer",
        "Invoice",
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
          row.customer,
          row.invoiceNumber,
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
          `${report.legacyPaymentTimingUncertainCount} invoice(s) contain legacy paid amounts without a payment date.`,
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