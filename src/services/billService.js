import {
  bills as defaultBills,
} from "../data/bills";

import {
  deleteBankTransaction,
  getTransactionById,
} from "./bankTransactionServices";

import {
  postBillAccounting,
  reverseBillAccounting,
  rollbackBillAccounting,
} from "./billAccountingService";

import {
  postBillPaymentAccounting,
  reverseBillPaymentAccounting,
  rollbackBillPaymentAccounting,
} from "./paymentAccountingService";

import {
  assertBillChangePeriodOpen,
  assertBillPaymentPeriodOpen,
  assertBillPeriodOpen,
} from "./periodLockGuards";

const STORAGE_KEY =
  "ledgify_bills";

const FINANCIAL_STATUSES =
  new Set([
    "approved",
    "awaiting payment",
    "partly paid",
    "part paid",
    "paid",
    "overdue",
  ]);

const VOID_STATUSES =
  new Set([
    "voided",
    "cancelled",
    "canceled",
  ]);

/*
|--------------------------------------------------------------------------
| General helpers
|--------------------------------------------------------------------------
*/

const cloneData = (data) => {
  if (
    data === undefined ||
    data === null
  ) {
    return data;
  }

  return JSON.parse(
    JSON.stringify(data)
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

const formatCurrency = (
  amount,
  currency = "GBP"
) => {
  try {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          currency || "GBP",
      }
    ).format(
      Number(amount) || 0
    );
  } catch {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency: "GBP",
      }
    ).format(
      Number(amount) || 0
    );
  }
};

const formatActivityDate = (
  date = new Date()
) => {
  return date.toLocaleString(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
};

const formatDisplayDate = (
  date
) => {
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(date);
};

const isFinancialStatus = (
  status
) => {
  return FINANCIAL_STATUSES.has(
    normaliseText(status)
  );
};

const isVoidStatus = (
  status
) => {
  return VOID_STATUSES.has(
    normaliseText(status)
  );
};

const getAccountingJournalId = (
  result
) => {
  return (
    result?.journalId ||
    result?.journal?.id ||
    result?.id ||
    null
  );
};

const safelyRollbackBillAccounting =
  (
    billId,
    journalId = null
  ) => {
    try {
      rollbackBillAccounting(
        billId,
        journalId
      );
    } catch (error) {
      console.error(
        "Bill accounting rollback failed:",
        error
      );
    }
  };

const safelyRollbackPaymentAccounting =
  (
    paymentId,
    journalId = null
  ) => {
    try {
      rollbackBillPaymentAccounting(
        paymentId,
        journalId
      );
    } catch (error) {
      console.error(
        "Bill payment accounting rollback failed:",
        error
      );
    }
  };

/*
|--------------------------------------------------------------------------
| Bill calculations
|--------------------------------------------------------------------------
*/

export const calculateBillLine = (
  item,
  pricingMode = "exclusive"
) => {
  const quantity =
    Number(item?.quantity) || 0;

  const unitPrice =
    Number(item?.unitPrice) || 0;

  const discountRate =
    Number(
      item?.discountRate
    ) || 0;

  const vatRate =
    Number(item?.vatRate) || 0;

  const gross =
    roundMoney(
      quantity * unitPrice
    );

  const discount =
    roundMoney(
      gross *
        (discountRate / 100)
    );

  const discountedAmount =
    roundMoney(
      gross - discount
    );

  if (
    normaliseText(
      pricingMode
    ) === "inclusive"
  ) {
    const vat =
      vatRate > 0
        ? roundMoney(
            discountedAmount -
              discountedAmount /
                (1 +
                  vatRate / 100)
          )
        : 0;

    return {
      gross,

      discount,

      subtotal:
        roundMoney(
          discountedAmount -
            vat
        ),

      vat,

      vatAmount: vat,

      total:
        discountedAmount,
    };
  }

  const vat =
    roundMoney(
      discountedAmount *
        (vatRate / 100)
    );

  return {
    gross,

    discount,

    subtotal:
      discountedAmount,

    vat,

    vatAmount: vat,

    total:
      roundMoney(
        discountedAmount +
          vat
      ),
  };
};

export const calculateBillTotals = (
  bill = {}
) => {
  const items =
    Array.isArray(
      bill.items
    )
      ? bill.items
      : [];

  if (items.length > 0) {
    const totals =
      items.reduce(
        (
          result,
          item
        ) => {
          const line =
            calculateBillLine(
              item,
              bill.pricingMode ||
                "exclusive"
            );

          return {
            subtotal:
              roundMoney(
                result.subtotal +
                  line.subtotal
              ),

            discount:
              roundMoney(
                result.discount +
                  line.discount
              ),

            vat:
              roundMoney(
                result.vat +
                  line.vat
              ),

            total:
              roundMoney(
                result.total +
                  line.total
              ),
          };
        },
        {
          subtotal: 0,
          discount: 0,
          vat: 0,
          total: 0,
        }
      );

    return {
      ...totals,

      vatTotal:
        totals.vat,

      grandTotal:
        totals.total,
    };
  }

  const storedTotal =
    [
      bill.total,
      bill.grandTotal,
      bill.billTotal,
      bill.amount,
    ].find(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== "" &&
        Number.isFinite(
          Number(value)
        )
    );

  const total =
    roundMoney(
      storedTotal || 0
    );

  const vat =
    roundMoney(
      bill.vat ??
        bill.vatTotal ??
        bill.taxTotal ??
        0
    );

  return {
    subtotal:
      roundMoney(
        bill.subtotal ??
          total - vat
      ),

    discount:
      roundMoney(
        bill.discount ??
          bill.discountTotal ??
          0
      ),

    vat,

    vatTotal: vat,

    total,

    grandTotal: total,
  };
};

export const calculateBillTotal = (
  bill = {}
) => {
  return calculateBillTotals(
    bill
  ).total;
};

const calculatePaymentsTotal = (
  payments = []
) => {
  return roundMoney(
    payments.reduce(
      (
        total,
        payment
      ) =>
        total +
        (Number(
          payment?.amount
        ) || 0),
      0
    )
  );
};

const calculateLegacyAmountPaid = (
  bill
) => {
  const payments =
    Array.isArray(
      bill?.payments
    )
      ? bill.payments
      : [];

  const paymentRecordsTotal =
    calculatePaymentsTotal(
      payments
    );

  const storedAmountPaid =
    roundMoney(
      bill?.amountPaid
    );

  return roundMoney(
    Math.max(
      storedAmountPaid -
        paymentRecordsTotal,
      0
    )
  );
};

export const calculateBillAmountPaid =
  (bill = {}) => {
    const payments =
      Array.isArray(
        bill.payments
      )
        ? bill.payments
        : [];

    return roundMoney(
      calculateLegacyAmountPaid(
        bill
      ) +
        calculatePaymentsTotal(
          payments
        )
    );
  };

export const getBillBalance = (
  bill
) => {
  const totals =
    calculateBillTotals(
      bill
    );

  const amountPaid =
    calculateBillAmountPaid(
      bill
    );

  return {
    ...totals,

    amountPaid,

    outstanding:
      roundMoney(
        Math.max(
          totals.total -
            amountPaid,
          0
        )
      ),
  };
};

const billIsOverdue = (
  bill
) => {
  const dueDate =
    normaliseDate(
      bill?.dueDate
    );

  if (!dueDate) {
    return false;
  }

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  return dueDate < today;
};

const getBillPaymentStatus = (
  bill,
  billTotal,
  amountPaid
) => {
  if (
    amountPaid <= 0.005
  ) {
    return billIsOverdue(
      bill
    )
      ? "Overdue"
      : "Awaiting payment";
  }

  if (
    amountPaid + 0.005 >=
    billTotal
  ) {
    return "Paid";
  }

  return "Partly paid";
};

/*
|--------------------------------------------------------------------------
| Financial-change detection
|--------------------------------------------------------------------------
*/

const getFinancialItemSnapshot = (
  item
) => {
  return {
    productId:
      item?.productId ??
      item?.inventoryItemId ??
      null,

    description:
      String(
        item?.description ||
          ""
      ).trim(),

    quantity:
      Number(item?.quantity) ||
      0,

    unitPrice:
      Number(item?.unitPrice) ||
      0,

    discountRate:
      Number(
        item?.discountRate
      ) || 0,

    vatRate:
      Number(item?.vatRate) ||
      0,

    accountId:
      item?.accountId ??
      null,

    accountCode:
      item?.accountCode ||
      "",

    expenseAccountId:
      item?.expenseAccountId ??
      null,

    expenseAccountCode:
      item?.expenseAccountCode ||
      "",

    tracked:
      Boolean(
        item?.tracked ||
          item?.isTracked
      ),

    costPrice:
      Number(
        item?.costPrice ??
          item?.purchasePrice ??
          item?.averageCost
      ) || 0,
  };
};

const getBillFinancialSnapshot = (
  bill
) => {
  return {
    issueDate:
      normaliseDate(
        bill?.issueDate
      ),

    currency:
      String(
        bill?.currency ||
          "GBP"
      ).toUpperCase(),

    pricingMode:
      normaliseText(
        bill?.pricingMode ||
          "exclusive"
      ),

    items:
      (
        Array.isArray(
          bill?.items
        )
          ? bill.items
          : []
      ).map(
        getFinancialItemSnapshot
      ),
  };
};

export const hasBillFinancialChanges =
  (
    originalBill,
    updatedBill
  ) => {
    return (
      JSON.stringify(
        getBillFinancialSnapshot(
          originalBill
        )
      ) !==
      JSON.stringify(
        getBillFinancialSnapshot(
          updatedBill
        )
      )
    );
  };

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const initialiseBills = () => {
  const storedBills =
    localStorage.getItem(
      STORAGE_KEY
    );

  if (storedBills) {
    try {
      const parsedBills =
        JSON.parse(
          storedBills
        );

      if (
        Array.isArray(
          parsedBills
        )
      ) {
        return parsedBills;
      }
    } catch (error) {
      console.error(
        "Unable to read saved bills:",
        error
      );
    }
  }

  const initialBills =
    cloneData(
      defaultBills
    );

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      initialBills
    )
  );

  return initialBills;
};

export const getBills = () => {
  return initialiseBills();
};

export const getBillById = (
  billId
) => {
  return (
    getBills().find(
      (bill) =>
        String(bill.id) ===
        String(billId)
    ) || null
  );
};

export const saveBills = (
  bills
) => {
  if (
    !Array.isArray(bills)
  ) {
    throw new Error(
      "Bills must be stored as an array."
    );
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(bills)
  );

  return bills;
};

const replaceBillInStorage = (
  billId,
  replacement
) => {
  const bills =
    getBills();

  const billExists =
    bills.some(
      (bill) =>
        String(bill.id) ===
        String(billId)
    );

  if (!billExists) {
    throw new Error(
      "Bill not found."
    );
  }

  const updatedBills =
    bills.map(
      (bill) =>
        String(bill.id) ===
        String(billId)
          ? replacement
          : bill
    );

  saveBills(
    updatedBills
  );

  return replacement;
};

/*
|--------------------------------------------------------------------------
| Bill numbering
|--------------------------------------------------------------------------
*/

const calculateNextBillNumber = (
  bills
) => {
  const highestNumber =
    bills.reduce(
      (
        highest,
        bill
      ) => {
        const numericPart =
          Number(
            String(
              bill.billNumber ||
                ""
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
      1000
    );

  return `BILL-${
    highestNumber + 1
  }`;
};

export const getNextBillNumber =
  () => {
    return calculateNextBillNumber(
      getBills()
    );
  };

const calculateNextBillId = (
  bills
) => {
  const numericIds =
    bills
      .map(
        (bill) =>
          Number(bill.id)
      )
      .filter(
        Number.isFinite
      );

  if (
    numericIds.length === 0
  ) {
    return 1;
  }

  return (
    Math.max(
      ...numericIds
    ) + 1
  );
};

/*
|--------------------------------------------------------------------------
| Accounting transitions
|--------------------------------------------------------------------------
*/

const applyBillAccountingTransition =
  (
    existingBill,
    updatedBill,
    {
      skipAccounting = false,
    } = {}
  ) => {
    if (skipAccounting) {
      return {
        action: "none",
        result: null,
      };
    }

    const wasFinancial =
      isFinancialStatus(
        existingBill?.status
      );

    const isNowFinancial =
      isFinancialStatus(
        updatedBill?.status
      );

    if (
      !wasFinancial &&
      isNowFinancial
    ) {
      const result =
        postBillAccounting(
          updatedBill
        );

      return {
        action: "posted",
        result,
      };
    }

    if (
      wasFinancial &&
      !isNowFinancial
    ) {
      const result =
        reverseBillAccounting(
          existingBill,
          `Bill status changed from ${existingBill.status} to ${updatedBill.status}.`
        );

      return {
        action: "reversed",
        result,
      };
    }

    return {
      action: "none",
      result: null,
    };
  };

/*
|--------------------------------------------------------------------------
| Create bill
|--------------------------------------------------------------------------
*/

export const createBill = (
  billData,
  statusOrOptions = "Draft",
  maybeOptions = {}
) => {
  if (
    !billData ||
    typeof billData !==
      "object"
  ) {
    throw new Error(
      "Bill data is required."
    );
  }

  let status =
    billData.status ||
    "Draft";

  let options;

  if (
    typeof statusOrOptions ===
    "string"
  ) {
    status =
      statusOrOptions ||
      status;

    options =
      maybeOptions || {};
  } else {
    options =
      statusOrOptions || {};
  }

  const bills =
    getBills();

  const now =
    new Date();

  const newBill = {
    ...cloneData(
      billData
    ),

    id:
      billData.id ??
      calculateNextBillId(
        bills
      ),

    billNumber:
      billData.billNumber ||
      calculateNextBillNumber(
        bills
      ),

    supplierId:
      billData.supplierId ??
      null,

    supplier:
      billData.supplier ||
      billData.supplierName ||
      "",

    supplierName:
      billData.supplierName ||
      billData.supplier ||
      "",

    supplierEmail:
      billData.supplierEmail ||
      "",

    supplierAddress:
      cloneData(
        billData.supplierAddress ||
          []
      ),

    supplierReference:
      billData.supplierReference ||
      "",

    purchaseOrderId:
      billData.purchaseOrderId ??
      null,

    purchaseOrderNumber:
      billData.purchaseOrderNumber ||
      "",

    amountPaid: 0,

    payments: [],

    issueDate:
      billData.issueDate,

    dueDate:
      billData.dueDate,

    paymentTerms:
      billData.paymentTerms ||
      "",

    status,

    category:
      billData.category ||
      "",

    currency:
      billData.currency ||
      "GBP",

    pricingMode:
      billData.pricingMode ||
      "exclusive",

    items:
      cloneData(
        billData.items ||
          []
      ),

    notes:
      billData.notes || "",

    accountingJournalId:
      null,

    createdAt:
      now.toISOString(),

    updatedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          isFinancialStatus(
            status
          )
            ? "Bill approved"
            : "Bill created",

        description:
          isFinancialStatus(
            status
          )
            ? "Supplier bill was created and approved for payment."
            : "Supplier bill was created as a draft.",

        date:
          formatActivityDate(
            now
          ),
      },
    ],
  };

  if (
    !options.skipPeriodLock
  ) {
    assertBillPeriodOpen(
      newBill,
      "create this supplier bill",
      options
    );
  }

  let accountingResult =
    null;

  try {
    if (
      isFinancialStatus(
        newBill.status
      ) &&
      !options.skipAccounting
    ) {
      accountingResult =
        postBillAccounting(
          newBill
        );

      newBill.accountingJournalId =
        getAccountingJournalId(
          accountingResult
        );
    }

    saveBills([
      ...bills,
      newBill,
    ]);

    return newBill;
  } catch (error) {
    if (accountingResult) {
      safelyRollbackBillAccounting(
        newBill.id,
        getAccountingJournalId(
          accountingResult
        )
      );
    }

    throw new Error(
      error.message ||
        "The supplier bill could not be created.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Update bill
|--------------------------------------------------------------------------
*/

export const updateBill = (
  billId,
  updatedFields,
  options = {}
) => {
  const existingBill =
    getBillById(
      billId
    );

  if (!existingBill) {
    throw new Error(
      "Bill not found."
    );
  }

  const now =
    new Date();

  const updatedBill = {
    ...existingBill,

    ...cloneData(
      updatedFields || {}
    ),

    id:
      existingBill.id,

    createdAt:
      existingBill.createdAt,

    updatedAt:
      updatedFields?.updatedAt ||
      now.toISOString(),
  };

  if (
    !options.skipPeriodLock
  ) {
    assertBillChangePeriodOpen(
      existingBill,
      updatedBill,
      options.action ||
        "edit this supplier bill",
      options
    );
  }

  const financialChanges =
    hasBillFinancialChanges(
      existingBill,
      updatedBill
    );

  const hasPayments =
    calculateBillAmountPaid(
      existingBill
    ) > 0.005;

  if (
    financialChanges &&
    hasPayments
  ) {
    throw new Error(
      "This bill has recorded payments. Reverse the payments before changing bill amounts, dates, currency, VAT or line items."
    );
  }

  if (
    financialChanges &&
    isFinancialStatus(
      existingBill.status
    )
  ) {
    throw new Error(
      "This bill has already been posted to accounting. Return it to Draft before changing amounts, VAT, currency, bill date or line items."
    );
  }

  const transition =
    applyBillAccountingTransition(
      existingBill,
      updatedBill,
      options
    );

  if (
    transition.action ===
    "posted"
  ) {
    updatedBill.accountingJournalId =
      getAccountingJournalId(
        transition.result
      );
  }

  if (
    transition.action ===
    "reversed"
  ) {
    updatedBill.accountingJournalId =
      null;
  }

  try {
    return replaceBillInStorage(
      billId,
      updatedBill
    );
  } catch (error) {
    if (
      transition.action !==
      "none"
    ) {
      safelyRollbackBillAccounting(
        existingBill.id,
        getAccountingJournalId(
          transition.result
        )
      );
    }

    throw new Error(
      error.message ||
        "The supplier bill could not be updated.",
      { cause: error }
    );
  }
};

export const editBill = (
  billId,
  billData,
  options = {}
) => {
  const bill =
    getBillById(
      billId
    );

  if (!bill) {
    throw new Error(
      "Bill not found."
    );
  }

  const now =
    new Date();

  return updateBill(
    billId,
    {
      ...billData,

      activity: [
        {
          id: createRecordId(),

          title:
            "Bill updated",

          description:
            "Supplier bill details were edited and saved.",

          date:
            formatActivityDate(
              now
            ),
        },

        ...(bill.activity ||
          []),
      ],

      updatedAt:
        now.toISOString(),
    },
    {
      ...options,

      action:
        "edit this supplier bill",
    }
  );
};

/*
|--------------------------------------------------------------------------
| Bill status
|--------------------------------------------------------------------------
*/

export const changeBillStatus = (
  billId,
  nextStatus,
  options = {}
) => {
  const bill =
    getBillById(
      billId
    );

  if (!bill) {
    throw new Error(
      "Bill not found."
    );
  }

  const cleanedStatus =
    String(nextStatus || "")
      .trim();

  if (!cleanedStatus) {
    throw new Error(
      "Select a bill status."
    );
  }

  if (
    normaliseText(
      bill.status
    ) ===
    normaliseText(
      cleanedStatus
    )
  ) {
    return bill;
  }

  const hasPayments =
    calculateBillAmountPaid(
      bill
    ) > 0.005;

  if (
    hasPayments &&
    (
      isVoidStatus(
        cleanedStatus
      ) ||
      !isFinancialStatus(
        cleanedStatus
      )
    )
  ) {
    throw new Error(
      "This bill has recorded payments. Reverse the payments before changing it to this status."
    );
  }

  const now =
    new Date();

  const statusDescription =
    isVoidStatus(
      cleanedStatus
    )
      ? `Bill was changed to ${cleanedStatus} and removed from the payment workflow.`
      : `Bill status changed from ${
          bill.status ||
          "Draft"
        } to ${cleanedStatus}.`;

  return updateBill(
    billId,
    {
      status:
        cleanedStatus,

      activity: [
        {
          id: createRecordId(),

          title:
            isVoidStatus(
              cleanedStatus
            )
              ? "Bill voided"
              : "Bill status updated",

          description:
            statusDescription,

          date:
            formatActivityDate(
              now
            ),
        },

        ...(bill.activity ||
          []),
      ],

      updatedAt:
        now.toISOString(),
    },
    {
      ...options,

      action:
        "change the status of this supplier bill",
    }
  );
};

export const updateBillStatus =
  changeBillStatus;

export const approveBill = (
  billId,
  options = {}
) => {
  return changeBillStatus(
    billId,
    "Awaiting payment",
    options
  );
};

export const voidBill = (
  billId,
  options = {}
) => {
  return changeBillStatus(
    billId,
    "Voided",
    options
  );
};

/*
|--------------------------------------------------------------------------
| Delete bill
|--------------------------------------------------------------------------
*/

export const deleteBill = (
  billId,
  options = {}
) => {
  const bills =
    getBills();

  const bill =
    bills.find(
      (
        currentBill
      ) =>
        String(
          currentBill.id
        ) ===
        String(billId)
    );

  if (!bill) {
    throw new Error(
      "Bill not found."
    );
  }

  if (
    !options.skipPeriodLock
  ) {
    assertBillPeriodOpen(
      bill,
      "delete this supplier bill",
      options
    );
  }

  const hasPayments =
    (
      bill.payments ||
      []
    ).length > 0 ||
    calculateBillAmountPaid(
      bill
    ) > 0.005;

  if (hasPayments) {
    throw new Error(
      "This bill has recorded payments. Reverse the payments before deleting the bill."
    );
  }

  let reversalResult =
    null;

  try {
    if (
      isFinancialStatus(
        bill.status
      ) &&
      !options.skipAccounting
    ) {
      reversalResult =
        reverseBillAccounting(
          bill,
          "Bill deleted."
        );
    }

    const updatedBills =
      bills.filter(
        (
          currentBill
        ) =>
          String(
            currentBill.id
          ) !==
          String(billId)
      );

    saveBills(
      updatedBills
    );

    return updatedBills;
  } catch (error) {
    if (reversalResult) {
      safelyRollbackBillAccounting(
        bill.id,
        getAccountingJournalId(
          reversalResult
        )
      );
    }

    throw new Error(
      error.message ||
        "The supplier bill could not be deleted.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Duplicate bill
|--------------------------------------------------------------------------
*/

export const duplicateBill = (
  billId,
  options = {}
) => {
  const sourceBill =
    getBillById(
      billId
    );

  if (!sourceBill) {
    throw new Error(
      "Bill not found."
    );
  }

  const bills =
    getBills();

  const now =
    new Date();

  const duplicatedBill = {
    ...cloneData(
      sourceBill
    ),

    id:
      calculateNextBillId(
        bills
      ),

    billNumber:
      calculateNextBillNumber(
        bills
      ),

    supplierReference: "",

    status: "Draft",

    amountPaid: 0,

    payments: [],

    accountingJournalId:
      null,

    createdAt:
      now.toISOString(),

    updatedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          "Bill duplicated",

        description:
          `Bill was duplicated from ${sourceBill.billNumber} and saved as a draft.`,

        date:
          formatActivityDate(
            now
          ),
      },
    ],
  };

  if (
    !options.skipPeriodLock
  ) {
    assertBillPeriodOpen(
      duplicatedBill,
      "duplicate this supplier bill",
      options
    );
  }

  saveBills([
    ...bills,
    duplicatedBill,
  ]);

  return duplicatedBill;
};

/*
|--------------------------------------------------------------------------
| Record supplier payment
|--------------------------------------------------------------------------
*/

export const recordBillPayment = (
  billId,
  payment,
  options = {}
) => {
  const bill =
    getBillById(
      billId
    );

  if (!bill) {
    throw new Error(
      "Bill not found."
    );
  }

  if (
    isVoidStatus(
      bill.status
    )
  ) {
    throw new Error(
      "A payment cannot be recorded against a voided or cancelled bill."
    );
  }

  if (
    !isFinancialStatus(
      bill.status
    )
  ) {
    throw new Error(
      "Approve the bill before recording a supplier payment."
    );
  }

  const amount =
    roundMoney(
      payment?.amount
    );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Enter a payment amount greater than zero."
    );
  }

  const existingPayments =
    Array.isArray(
      bill.payments
    )
      ? bill.payments
      : [];

  const billTotal =
    calculateBillTotal(
      bill
    );

  const legacyAmountPaid =
    calculateLegacyAmountPaid(
      bill
    );

  const existingPaymentsTotal =
    calculatePaymentsTotal(
      existingPayments
    );

  const existingAmountPaid =
    roundMoney(
      legacyAmountPaid +
        existingPaymentsTotal
    );

  const outstanding =
    roundMoney(
      Math.max(
        billTotal -
          existingAmountPaid,
        0
      )
    );

  if (
    outstanding <= 0.005
  ) {
    throw new Error(
      "This bill has already been paid in full."
    );
  }

  if (
    amount >
    outstanding + 0.005
  ) {
    throw new Error(
      `The payment cannot exceed ${formatCurrency(
        outstanding,
        bill.currency
      )}.`
    );
  }

  if (
    payment?.bankTransactionId
  ) {
    const transactionAlreadyLinked =
      getBills().some(
        (
          currentBill
        ) =>
          (
            currentBill.payments ||
            []
          ).some(
            (
              currentPayment
            ) =>
              String(
                currentPayment.bankTransactionId ||
                  ""
              ) ===
              String(
                payment.bankTransactionId
              )
          )
      );

    if (
      transactionAlreadyLinked
    ) {
      throw new Error(
        "This bank transaction is already linked to a supplier payment."
      );
    }

    const bankTransaction =
      getTransactionById(
        payment.bankTransactionId
      );

    if (!bankTransaction) {
      throw new Error(
        "The linked bank transaction could not be found."
      );
    }

    if (
      String(
        bankTransaction.transactionType
      ) !== "Money out"
    ) {
      throw new Error(
        "A supplier payment must be linked to a money-out bank transaction."
      );
    }

    if (
      Math.abs(
        Number(
          bankTransaction.amount
        ) - amount
      ) > 0.005
    ) {
      throw new Error(
        "The supplier payment amount does not match the linked bank transaction."
      );
    }
  }

  const now =
    new Date();

  const paymentRecord = {
    ...cloneData(
      payment || {}
    ),

    id:
      payment?.id ||
      createRecordId(),

    amount,

    paymentDate:
      payment?.paymentDate ||
      payment?.date ||
      now
        .toISOString()
        .slice(0, 10),

    createdAt:
      payment?.createdAt ||
      now.toISOString(),

    accountingJournalId:
      null,
  };

  if (
    !options.skipPeriodLock
  ) {
    assertBillPaymentPeriodOpen(
      paymentRecord,
      bill,
      "record this supplier payment",
      options
    );
  }

  const payments = [
    ...existingPayments,
    paymentRecord,
  ];

  const amountPaid =
    roundMoney(
      legacyAmountPaid +
        calculatePaymentsTotal(
          payments
        )
    );

  const status =
    getBillPaymentStatus(
      bill,
      billTotal,
      amountPaid
    );

  const accountName =
    paymentRecord.bankAccountName ||
    paymentRecord.bankAccount ||
    "the selected account";

  const updatedBill = {
    ...bill,

    payments,

    amountPaid,

    status,

    updatedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          "Payment recorded",

        description:
          `${formatCurrency(
            paymentRecord.amount,
            bill.currency
          )} was paid by ${
            paymentRecord.paymentMethod ||
            "payment"
          } from ${accountName}.`,

        date:
          `${paymentRecord.paymentDate} · Reference: ${
            paymentRecord.reference ||
            "No reference"
          }`,
      },

      ...(bill.activity ||
        []),
    ],
  };

  let accountingResult =
    null;

  try {
    if (
      !options.skipAccounting
    ) {
      accountingResult =
        postBillPaymentAccounting(
          updatedBill,
          paymentRecord
        );

      paymentRecord.accountingJournalId =
        getAccountingJournalId(
          accountingResult
        );

      updatedBill.payments =
        payments.map(
          (
            currentPayment
          ) =>
            String(
              currentPayment.id
            ) ===
            String(
              paymentRecord.id
            )
              ? paymentRecord
              : currentPayment
        );
    }

    return replaceBillInStorage(
      billId,
      updatedBill
    );
  } catch (error) {
    if (accountingResult) {
      safelyRollbackPaymentAccounting(
        paymentRecord.id,
        getAccountingJournalId(
          accountingResult
        )
      );
    }

    throw new Error(
      error.message ||
        "The supplier payment could not be recorded.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Reverse supplier payment
|--------------------------------------------------------------------------
*/

export const reverseBillPayment = (
  billId,
  paymentId,
  reasonOrOptions = "",
  maybeOptions = {}
) => {
  let reason = "";
  let options;

  if (
    reasonOrOptions &&
    typeof reasonOrOptions ===
      "object"
  ) {
    options =
      reasonOrOptions;
  } else {
    reason =
      String(
        reasonOrOptions ||
          ""
      ).trim();

    options =
      maybeOptions || {};
  }

  const bill =
    getBillById(
      billId
    );

  if (!bill) {
    throw new Error(
      "Bill not found."
    );
  }

  const payments =
    Array.isArray(
      bill.payments
    )
      ? bill.payments
      : [];

  const payment =
    payments.find(
      (
        currentPayment
      ) =>
        String(
          currentPayment.id
        ) ===
        String(paymentId)
    );

  if (!payment) {
    throw new Error(
      "Supplier payment not found."
    );
  }

  if (
    !options.skipPeriodLock
  ) {
    assertBillPaymentPeriodOpen(
      payment,
      bill,
      "reverse this supplier payment",
      options
    );
  }

  const remainingPayments =
    payments.filter(
      (
        currentPayment
      ) =>
        String(
          currentPayment.id
        ) !==
        String(paymentId)
    );

  const legacyAmountPaid =
    calculateLegacyAmountPaid(
      bill
    );

  const amountPaid =
    roundMoney(
      legacyAmountPaid +
        calculatePaymentsTotal(
          remainingPayments
        )
    );

  const billTotal =
    calculateBillTotal(
      bill
    );

  const status =
    getBillPaymentStatus(
      bill,
      billTotal,
      amountPaid
    );

  const now =
    new Date();

  const updatedBill = {
    ...bill,

    payments:
      remainingPayments,

    amountPaid,

    status,

    updatedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          "Payment reversed",

        description:
          `${formatCurrency(
            payment.amount,
            bill.currency
          )} was reversed${
            reason
              ? `: ${reason}`
              : "."
          }`,

        date:
          formatActivityDate(
            now
          ),
      },

      ...(bill.activity ||
        []),
    ],
  };

  let accountingResult =
    null;

  try {
    if (
      !options.skipAccounting
    ) {
      accountingResult =
        reverseBillPaymentAccounting(
          bill,
          payment,
          reason
        );
    }

    if (
      payment.bankTransactionId
    ) {
      const linkedTransaction =
        getTransactionById(
          payment.bankTransactionId
        );

      if (
        linkedTransaction
      ) {
        deleteBankTransaction(
          payment.bankTransactionId,
          {
            allowLinkedPaymentDeletion:
              true,

            allowPeriodLockOverride:
              Boolean(
                options.allowPeriodLockOverride
              ),
          }
        );
      }
    }

    return replaceBillInStorage(
      billId,
      updatedBill
    );
  } catch (error) {
    if (accountingResult) {
      safelyRollbackPaymentAccounting(
        payment.id,
        getAccountingJournalId(
          accountingResult
        )
      );
    }

    throw new Error(
      error.message ||
        "The supplier payment reversal failed and the bill was not changed.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Create bill from purchase order
|--------------------------------------------------------------------------
*/

export const createBillFromPurchaseOrder =
  (
    purchaseOrder,
    statusOrOptions = "Draft",
    maybeOptions = {}
  ) => {
    if (!purchaseOrder) {
      throw new Error(
        "Purchase order is required."
      );
    }

    let status;
    let options;

    if (
      typeof statusOrOptions ===
      "string"
    ) {
      status =
        statusOrOptions ||
        "Draft";

      options =
        maybeOptions || {};
    } else {
      options =
        statusOrOptions || {};

      status =
        options.status ||
        "Draft";
    }

    const today =
      new Date();

    const dueDate =
      new Date(
        today.getTime() +
          30 *
            24 *
            60 *
            60 *
            1000
      );

    return createBill(
      {
        supplierId:
          purchaseOrder.supplierId ??
          null,

        supplier:
          purchaseOrder.supplier ||
          purchaseOrder.supplierName ||
          "",

        supplierName:
          purchaseOrder.supplierName ||
          purchaseOrder.supplier ||
          "",

        supplierEmail:
          purchaseOrder.supplierEmail ||
          "",

        supplierAddress:
          cloneData(
            purchaseOrder.supplierAddress ||
              []
          ),

        supplierReference: "",

        purchaseOrderId:
          purchaseOrder.id,

        purchaseOrderNumber:
          purchaseOrder.purchaseOrderNumber ||
          purchaseOrder.orderNumber ||
          purchaseOrder.poNumber ||
          "",

        issueDate:
          formatDisplayDate(
            today
          ),

        dueDate:
          formatDisplayDate(
            dueDate
          ),

        paymentTerms:
          purchaseOrder.paymentTerms ||
          "30 days",

        category:
          purchaseOrder.category ||
          "",

        currency:
          purchaseOrder.currency ||
          "GBP",

        pricingMode:
          purchaseOrder.pricingMode ||
          "exclusive",

        notes:
          purchaseOrder.notes ||
          "Created from purchase order.",

        items:
          (
            purchaseOrder.items ||
            []
          ).map(
            (item) => ({
              ...cloneData(
                item
              ),

              id:
                createRecordId(),
            })
          ),
      },
      status,
      options
    );
  };

/*
|--------------------------------------------------------------------------
| Development reset
|--------------------------------------------------------------------------
*/

export const resetBills = () => {
  const initialBills =
    cloneData(
      defaultBills
    );

  saveBills(
    initialBills
  );

  return initialBills;
};
