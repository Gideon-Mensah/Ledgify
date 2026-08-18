import {
  invoices as defaultInvoices,
} from "../data/invoices";

import {
  deleteBankTransaction,
  getTransactionById,
} from "./bankTransactionServices";

import {
  postInvoiceAccounting,
  reverseInvoiceAccounting,
  rollbackInvoiceAccounting,
} from "./invoiceAccountingService";

import {
  postInvoicePaymentAccounting,
  reverseInvoicePaymentAccounting,
  rollbackInvoicePaymentAccounting,
} from "./paymentAccountingService";

import {
  assertInvoiceChangePeriodOpen,
  assertInvoicePaymentPeriodOpen,
  assertInvoicePeriodOpen,
} from "./periodLockGuards";

const STORAGE_KEY =
  "ledgify_invoices";

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

const safelyRollbackInvoiceAccounting =
  (
    invoiceId,
    journalId = null
  ) => {
    try {
      rollbackInvoiceAccounting(
        invoiceId,
        journalId
      );
    } catch (error) {
      console.error(
        "Invoice accounting rollback failed:",
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
      rollbackInvoicePaymentAccounting(
        paymentId,
        journalId
      );
    } catch (error) {
      console.error(
        "Invoice payment accounting rollback failed:",
        error
      );
    }
  };

/*
|--------------------------------------------------------------------------
| Invoice totals
|--------------------------------------------------------------------------
*/

export const calculateInvoiceLine = (
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
    const vatAmount =
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
            vatAmount
        ),

      vatAmount,

      total:
        discountedAmount,
    };
  }

  const vatAmount =
    roundMoney(
      discountedAmount *
        (vatRate / 100)
    );

  return {
    gross,

    discount,

    subtotal:
      discountedAmount,

    vatAmount,

    total:
      roundMoney(
        discountedAmount +
          vatAmount
      ),
  };
};

export const calculateInvoiceTotals =
  (invoice = {}) => {
    const items =
      Array.isArray(
        invoice.items
      )
        ? invoice.items
        : [];

    if (items.length > 0) {
      return items.reduce(
        (totals, item) => {
          const line =
            calculateInvoiceLine(
              item,
              invoice.pricingMode ||
                "exclusive"
            );

          return {
            subtotal:
              roundMoney(
                totals.subtotal +
                  line.subtotal
              ),

            discount:
              roundMoney(
                totals.discount +
                  line.discount
              ),

            vatTotal:
              roundMoney(
                totals.vatTotal +
                  line.vatAmount
              ),

            grandTotal:
              roundMoney(
                totals.grandTotal +
                  line.total
              ),
          };
        },
        {
          subtotal: 0,
          discount: 0,
          vatTotal: 0,
          grandTotal: 0,
        }
      );
    }

    const storedTotal =
      [
        invoice.total,
        invoice.grandTotal,
        invoice.invoiceTotal,
        invoice.amount,
      ].find(
        (value) =>
          value !== undefined &&
          value !== null &&
          value !== "" &&
          Number.isFinite(
            Number(value)
          )
      );

    const grandTotal =
      roundMoney(
        storedTotal || 0
      );

    return {
      subtotal:
        roundMoney(
          invoice.subtotal ??
            grandTotal
        ),

      discount:
        roundMoney(
          invoice.discount ??
            invoice.discountTotal ??
            0
        ),

      vatTotal:
        roundMoney(
          invoice.vatTotal ??
            invoice.taxTotal ??
            0
        ),

      grandTotal,
    };
  };

export const calculateInvoiceTotal =
  (invoice = {}) => {
    return calculateInvoiceTotals(
      invoice
    ).grandTotal;
  };

const calculatePaymentsTotal = (
  payments = []
) => {
  return roundMoney(
    payments.reduce(
      (total, payment) =>
        total +
        (Number(
          payment?.amount
        ) || 0),
      0
    )
  );
};

const calculateLegacyAmountPaid = (
  invoice
) => {
  const payments =
    Array.isArray(
      invoice?.payments
    )
      ? invoice.payments
      : [];

  const paymentRecordsTotal =
    calculatePaymentsTotal(
      payments
    );

  const storedAmountPaid =
    roundMoney(
      invoice?.amountPaid
    );

  return roundMoney(
    Math.max(
      storedAmountPaid -
        paymentRecordsTotal,
      0
    )
  );
};

export const calculateInvoiceAmountPaid =
  (invoice = {}) => {
    const payments =
      Array.isArray(
        invoice.payments
      )
        ? invoice.payments
        : [];

    return roundMoney(
      calculateLegacyAmountPaid(
        invoice
      ) +
        calculatePaymentsTotal(
          payments
        )
    );
  };

export const getInvoiceBalance = (
  invoice
) => {
  const total =
    calculateInvoiceTotal(
      invoice
    );

  const amountPaid =
    calculateInvoiceAmountPaid(
      invoice
    );

  return {
    total,

    amountPaid,

    outstanding:
      roundMoney(
        Math.max(
          total - amountPaid,
          0
        )
      ),
  };
};

const invoiceIsOverdue = (
  invoice
) => {
  const dueDate =
    normaliseDate(
      invoice?.dueDate
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

const getInvoicePaymentStatus = (
  invoice,
  invoiceTotal,
  amountPaid
) => {
  if (
    amountPaid <= 0.005
  ) {
    return invoiceIsOverdue(
      invoice
    )
      ? "Overdue"
      : "Awaiting payment";
  }

  if (
    amountPaid + 0.005 >=
    invoiceTotal
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

    revenueAccountId:
      item?.revenueAccountId ??
      null,

    revenueAccountCode:
      item?.revenueAccountCode ||
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

const getInvoiceFinancialSnapshot = (
  invoice
) => {
  return {
    issueDate:
      normaliseDate(
        invoice?.issueDate
      ),

    currency:
      String(
        invoice?.currency ||
          "GBP"
      ).toUpperCase(),

    pricingMode:
      normaliseText(
        invoice?.pricingMode ||
          "exclusive"
      ),

    items:
      (
        Array.isArray(
          invoice?.items
        )
          ? invoice.items
          : []
      ).map(
        getFinancialItemSnapshot
      ),
  };
};

export const hasInvoiceFinancialChanges =
  (
    originalInvoice,
    updatedInvoice
  ) => {
    return (
      JSON.stringify(
        getInvoiceFinancialSnapshot(
          originalInvoice
        )
      ) !==
      JSON.stringify(
        getInvoiceFinancialSnapshot(
          updatedInvoice
        )
      )
    );
  };

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const initialiseInvoices = () => {
  const storedInvoices =
    localStorage.getItem(
      STORAGE_KEY
    );

  if (storedInvoices) {
    try {
      const parsedInvoices =
        JSON.parse(
          storedInvoices
        );

      if (
        Array.isArray(
          parsedInvoices
        )
      ) {
        return parsedInvoices;
      }
    } catch (error) {
      console.error(
        "Unable to read saved invoices:",
        error
      );
    }
  }

  const initialInvoices =
    cloneData(
      defaultInvoices
    );

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      initialInvoices
    )
  );

  return initialInvoices;
};

export const getInvoices = () => {
  return initialiseInvoices();
};

export const getInvoiceById = (
  invoiceId
) => {
  return (
    getInvoices().find(
      (invoice) =>
        String(invoice.id) ===
        String(invoiceId)
    ) || null
  );
};

export const saveInvoices = (
  invoices
) => {
  if (
    !Array.isArray(invoices)
  ) {
    throw new Error(
      "Invoices must be stored as an array."
    );
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(invoices)
  );

  return invoices;
};

const replaceInvoiceInStorage = (
  invoiceId,
  replacement
) => {
  const invoices =
    getInvoices();

  const invoiceExists =
    invoices.some(
      (invoice) =>
        String(invoice.id) ===
        String(invoiceId)
    );

  if (!invoiceExists) {
    throw new Error(
      "Invoice not found."
    );
  }

  const updatedInvoices =
    invoices.map(
      (invoice) =>
        String(invoice.id) ===
        String(invoiceId)
          ? replacement
          : invoice
    );

  saveInvoices(
    updatedInvoices
  );

  return replacement;
};

/*
|--------------------------------------------------------------------------
| Invoice numbering
|--------------------------------------------------------------------------
*/

const calculateNextInvoiceNumber = (
  invoices
) => {
  const highestNumber =
    invoices.reduce(
      (highest, invoice) => {
        const numericPart =
          Number(
            String(
              invoice.invoiceNumber ||
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

  return `INV-${
    highestNumber + 1
  }`;
};

export const getNextInvoiceNumber =
  () => {
    return calculateNextInvoiceNumber(
      getInvoices()
    );
  };

const calculateNextInvoiceId = (
  invoices
) => {
  const numericIds =
    invoices
      .map(
        (invoice) =>
          Number(invoice.id)
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

const applyInvoiceAccountingTransition =
  (
    existingInvoice,
    updatedInvoice,
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
        existingInvoice?.status
      );

    const isNowFinancial =
      isFinancialStatus(
        updatedInvoice?.status
      );

    if (
      !wasFinancial &&
      isNowFinancial
    ) {
      const result =
        postInvoiceAccounting(
          updatedInvoice
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
        reverseInvoiceAccounting(
          existingInvoice,
          `Invoice status changed from ${existingInvoice.status} to ${updatedInvoice.status}.`
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
| Create invoice
|--------------------------------------------------------------------------
*/

export const createInvoice = (
  invoiceData,
  statusOrOptions = "Draft",
  maybeOptions = {}
) => {
  if (
    !invoiceData ||
    typeof invoiceData !==
      "object"
  ) {
    throw new Error(
      "Invoice data is required."
    );
  }

  let status =
    invoiceData.status ||
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

  const invoices =
    getInvoices();

  const now =
    new Date();

  const newInvoice = {
    ...cloneData(
      invoiceData
    ),

    id:
      invoiceData.id ??
      calculateNextInvoiceId(
        invoices
      ),

    invoiceNumber:
      invoiceData.invoiceNumber ||
      calculateNextInvoiceNumber(
        invoices
      ),

    customerId:
      invoiceData.customerId ??
      null,

    customer:
      invoiceData.customer ||
      invoiceData.customerName ||
      "",

    customerEmail:
      invoiceData.customerEmail ||
      "",

    customerAddress:
      cloneData(
        invoiceData.customerAddress ||
          []
      ),

    amountPaid: 0,

    payments: [],

    issueDate:
      invoiceData.issueDate,

    dueDate:
      invoiceData.dueDate,

    reference:
      invoiceData.reference ||
      "",

    status,

    currency:
      invoiceData.currency ||
      "GBP",

    pricingMode:
      invoiceData.pricingMode ||
      "exclusive",

    items:
      cloneData(
        invoiceData.items ||
          []
      ),

    notes:
      invoiceData.notes || "",

    sourceQuoteId:
      invoiceData.sourceQuoteId ??
      null,

    sourceQuoteNumber:
      invoiceData.sourceQuoteNumber ||
      "",

    emails: [],

    lastEmailedAt: null,

    accountingJournalId: null,

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
            ? "Invoice approved"
            : "Invoice created",

        description:
          isFinancialStatus(
            status
          )
            ? "Invoice was created and approved for payment."
            : "Invoice was created as a draft.",

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
    assertInvoicePeriodOpen(
      newInvoice,
      "create this invoice",
      options
    );
  }

  let accountingResult =
    null;

  try {
    if (
      isFinancialStatus(
        newInvoice.status
      ) &&
      !options.skipAccounting
    ) {
      accountingResult =
        postInvoiceAccounting(
          newInvoice
        );

      newInvoice.accountingJournalId =
        getAccountingJournalId(
          accountingResult
        );
    }

    saveInvoices([
      ...invoices,
      newInvoice,
    ]);

    return newInvoice;
  } catch (error) {
    if (accountingResult) {
      safelyRollbackInvoiceAccounting(
        newInvoice.id,
        getAccountingJournalId(
          accountingResult
        )
      );
    }

    throw new Error(
      error.message ||
        "The invoice could not be created.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Update invoice
|--------------------------------------------------------------------------
*/

export const updateInvoice = (
  invoiceId,
  updatedFields,
  options = {}
) => {
  const existingInvoice =
    getInvoiceById(
      invoiceId
    );

  if (!existingInvoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  const now =
    new Date();

  const updatedInvoice = {
    ...existingInvoice,

    ...cloneData(
      updatedFields || {}
    ),

    id:
      existingInvoice.id,

    createdAt:
      existingInvoice.createdAt,

    updatedAt:
      updatedFields?.updatedAt ||
      now.toISOString(),
  };

  if (
    !options.skipPeriodLock
  ) {
    assertInvoiceChangePeriodOpen(
      existingInvoice,
      updatedInvoice,
      options.action ||
        "edit this invoice",
      options
    );
  }

  const financialChanges =
    hasInvoiceFinancialChanges(
      existingInvoice,
      updatedInvoice
    );

  const hasPayments =
    calculateInvoiceAmountPaid(
      existingInvoice
    ) > 0.005;

  if (
    financialChanges &&
    hasPayments
  ) {
    throw new Error(
      "This invoice has recorded payments. Reverse the payments before changing invoice amounts, dates, currency, VAT or line items."
    );
  }

  if (
    financialChanges &&
    isFinancialStatus(
      existingInvoice.status
    )
  ) {
    throw new Error(
      "This invoice has already been posted to accounting. Return it to Draft before changing amounts, VAT, currency, invoice date or line items."
    );
  }

  const transition =
    applyInvoiceAccountingTransition(
      existingInvoice,
      updatedInvoice,
      options
    );

  if (
    transition.action ===
    "posted"
  ) {
    updatedInvoice.accountingJournalId =
      getAccountingJournalId(
        transition.result
      );
  }

  if (
    transition.action ===
    "reversed"
  ) {
    updatedInvoice.accountingJournalId =
      null;
  }

  try {
    return replaceInvoiceInStorage(
      invoiceId,
      updatedInvoice
    );
  } catch (error) {
    if (
      transition.action !==
      "none"
    ) {
      safelyRollbackInvoiceAccounting(
        existingInvoice.id,
        getAccountingJournalId(
          transition.result
        )
      );
    }

    throw new Error(
      error.message ||
        "The invoice could not be updated.",
      { cause: error }
    );
  }
};

export const editInvoice = (
  invoiceId,
  invoiceData,
  options = {}
) => {
  const invoice =
    getInvoiceById(
      invoiceId
    );

  if (!invoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  const now =
    new Date();

  const activityEntry = {
    id: createRecordId(),

    title:
      "Invoice updated",

    description:
      "Invoice details were edited and saved.",

    date:
      formatActivityDate(
        now
      ),
  };

  return updateInvoice(
    invoiceId,
    {
      ...invoiceData,

      activity: [
        activityEntry,
        ...(invoice.activity ||
          []),
      ],

      updatedAt:
        now.toISOString(),
    },
    {
      ...options,

      action:
        "edit this invoice",
    }
  );
};

/*
|--------------------------------------------------------------------------
| Invoice status
|--------------------------------------------------------------------------
*/

export const changeInvoiceStatus = (
  invoiceId,
  nextStatus,
  options = {}
) => {
  const invoice =
    getInvoiceById(
      invoiceId
    );

  if (!invoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  const cleanedStatus =
    String(nextStatus || "")
      .trim();

  if (!cleanedStatus) {
    throw new Error(
      "Select an invoice status."
    );
  }

  if (
    normaliseText(
      invoice.status
    ) ===
    normaliseText(
      cleanedStatus
    )
  ) {
    return invoice;
  }

  const hasPayments =
    calculateInvoiceAmountPaid(
      invoice
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
      "This invoice has recorded payments. Reverse the payments before changing it to this status."
    );
  }

  const now =
    new Date();

  const statusDescription =
    isVoidStatus(
      cleanedStatus
    )
      ? `Invoice was changed to ${cleanedStatus} and removed from the payment workflow.`
      : `Invoice status changed from ${invoice.status || "Draft"} to ${cleanedStatus}.`;

  return updateInvoice(
    invoiceId,
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
              ? "Invoice voided"
              : "Invoice status updated",

          description:
            statusDescription,

          date:
            formatActivityDate(
              now
            ),
        },

        ...(invoice.activity ||
          []),
      ],

      updatedAt:
        now.toISOString(),
    },
    {
      ...options,

      action:
        "change the status of this invoice",
    }
  );
};

export const updateInvoiceStatus =
  changeInvoiceStatus;

export const approveInvoice = (
  invoiceId,
  options = {}
) => {
  return changeInvoiceStatus(
    invoiceId,
    "Awaiting payment",
    options
  );
};

export const voidInvoice = (
  invoiceId,
  options = {}
) => {
  return changeInvoiceStatus(
    invoiceId,
    "Voided",
    options
  );
};

/*
|--------------------------------------------------------------------------
| Delete invoice
|--------------------------------------------------------------------------
*/

export const deleteInvoice = (
  invoiceId,
  options = {}
) => {
  const invoices =
    getInvoices();

  const invoice =
    invoices.find(
      (currentInvoice) =>
        String(
          currentInvoice.id
        ) ===
        String(invoiceId)
    );

  if (!invoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  if (
    !options.skipPeriodLock
  ) {
    assertInvoicePeriodOpen(
      invoice,
      "delete this invoice",
      options
    );
  }

  const hasPayments =
    (
      invoice.payments ||
      []
    ).length > 0 ||
    calculateInvoiceAmountPaid(
      invoice
    ) > 0.005;

  if (hasPayments) {
    throw new Error(
      "This invoice has recorded payments. Reverse the payments before deleting the invoice."
    );
  }

  let reversalResult =
    null;

  try {
    if (
      isFinancialStatus(
        invoice.status
      ) &&
      !options.skipAccounting
    ) {
      reversalResult =
        reverseInvoiceAccounting(
          invoice,
          "Invoice deleted."
        );
    }

    const updatedInvoices =
      invoices.filter(
        (currentInvoice) =>
          String(
            currentInvoice.id
          ) !==
          String(invoiceId)
      );

    saveInvoices(
      updatedInvoices
    );

    return updatedInvoices;
  } catch (error) {
    if (reversalResult) {
      safelyRollbackInvoiceAccounting(
        invoice.id,
        getAccountingJournalId(
          reversalResult
        )
      );
    }

    throw new Error(
      error.message ||
        "The invoice could not be deleted.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Duplicate invoice
|--------------------------------------------------------------------------
*/

export const duplicateInvoice = (
  invoiceId,
  options = {}
) => {
  const sourceInvoice =
    getInvoiceById(
      invoiceId
    );

  if (!sourceInvoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  const invoices =
    getInvoices();

  const now =
    new Date();

  const duplicatedInvoice = {
    ...cloneData(
      sourceInvoice
    ),

    id:
      calculateNextInvoiceId(
        invoices
      ),

    invoiceNumber:
      calculateNextInvoiceNumber(
        invoices
      ),

    status: "Draft",

    amountPaid: 0,

    payments: [],

    emails: [],

    lastEmailedAt: null,

    accountingJournalId: null,

    sourceQuoteId: null,

    sourceQuoteNumber: "",

    createdAt:
      now.toISOString(),

    updatedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          "Invoice duplicated",

        description:
          `Invoice was duplicated from ${sourceInvoice.invoiceNumber} and saved as a draft.`,

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
    assertInvoicePeriodOpen(
      duplicatedInvoice,
      "duplicate this invoice",
      options
    );
  }

  saveInvoices([
    ...invoices,
    duplicatedInvoice,
  ]);

  return duplicatedInvoice;
};

/*
|--------------------------------------------------------------------------
| Record customer payment
|--------------------------------------------------------------------------
*/

export const recordInvoicePayment = (
  invoiceId,
  payment,
  options = {}
) => {
  const invoice =
    getInvoiceById(
      invoiceId
    );

  if (!invoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  if (
    isVoidStatus(
      invoice.status
    )
  ) {
    throw new Error(
      "A payment cannot be recorded against a voided or cancelled invoice."
    );
  }

  if (
    !isFinancialStatus(
      invoice.status
    )
  ) {
    throw new Error(
      "Approve the invoice before recording a customer payment."
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
      invoice.payments
    )
      ? invoice.payments
      : [];

  const invoiceTotal =
    calculateInvoiceTotal(
      invoice
    );

  const legacyAmountPaid =
    calculateLegacyAmountPaid(
      invoice
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
        invoiceTotal -
          existingAmountPaid,
        0
      )
    );

  if (
    outstanding <= 0.005
  ) {
    throw new Error(
      "This invoice has already been paid in full."
    );
  }

  if (
    amount >
    outstanding + 0.005
  ) {
    throw new Error(
      `The payment cannot exceed ${formatCurrency(
        outstanding,
        invoice.currency
      )}.`
    );
  }

  if (
    payment?.bankTransactionId
  ) {
    const transactionAlreadyLinked =
      getInvoices().some(
        (currentInvoice) =>
          (
            currentInvoice.payments ||
            []
          ).some(
            (currentPayment) =>
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
        "This bank transaction is already linked to an invoice payment."
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
      ) !== "Money in"
    ) {
      throw new Error(
        "An invoice payment must be linked to a money-in bank transaction."
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
        "The invoice payment amount does not match the linked bank transaction."
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

    accountingJournalId: null,
  };

  if (
    !options.skipPeriodLock
  ) {
    assertInvoicePaymentPeriodOpen(
      paymentRecord,
      invoice,
      "record this customer payment",
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
    getInvoicePaymentStatus(
      invoice,
      invoiceTotal,
      amountPaid
    );

  const accountName =
    paymentRecord.bankAccountName ||
    paymentRecord.bankAccount ||
    "the selected account";

  const updatedInvoice = {
    ...invoice,

    payments,

    amountPaid,

    status,

    updatedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          "Payment received",

        description:
          `${formatCurrency(
            paymentRecord.amount,
            invoice.currency
          )} was recorded by ${
            paymentRecord.paymentMethod ||
            "payment"
          } into ${accountName}.`,

        date:
          `${paymentRecord.paymentDate} · Reference: ${
            paymentRecord.reference ||
            "No reference"
          }`,
      },

      ...(invoice.activity ||
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
        postInvoicePaymentAccounting(
          updatedInvoice,
          paymentRecord
        );

      paymentRecord.accountingJournalId =
        getAccountingJournalId(
          accountingResult
        );

      updatedInvoice.payments =
        payments.map(
          (currentPayment) =>
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

    return replaceInvoiceInStorage(
      invoiceId,
      updatedInvoice
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
        "The customer payment could not be recorded.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Reverse customer payment
|--------------------------------------------------------------------------
*/

export const reverseInvoicePayment = (
  invoiceId,
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

  const invoice =
    getInvoiceById(
      invoiceId
    );

  if (!invoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  const payments =
    Array.isArray(
      invoice.payments
    )
      ? invoice.payments
      : [];

  const payment =
    payments.find(
      (currentPayment) =>
        String(
          currentPayment.id
        ) ===
        String(paymentId)
    );

  if (!payment) {
    throw new Error(
      "Invoice payment not found."
    );
  }

  if (
    !options.skipPeriodLock
  ) {
    assertInvoicePaymentPeriodOpen(
      payment,
      invoice,
      "reverse this customer payment",
      options
    );
  }

  const remainingPayments =
    payments.filter(
      (currentPayment) =>
        String(
          currentPayment.id
        ) !==
        String(paymentId)
    );

  const legacyAmountPaid =
    calculateLegacyAmountPaid(
      invoice
    );

  const amountPaid =
    roundMoney(
      legacyAmountPaid +
        calculatePaymentsTotal(
          remainingPayments
        )
    );

  const invoiceTotal =
    calculateInvoiceTotal(
      invoice
    );

  const status =
    getInvoicePaymentStatus(
      invoice,
      invoiceTotal,
      amountPaid
    );

  const now =
    new Date();

  const updatedInvoice = {
    ...invoice,

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
            invoice.currency
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

      ...(invoice.activity ||
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
        reverseInvoicePaymentAccounting(
          invoice,
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

      if (linkedTransaction) {
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

    return replaceInvoiceInStorage(
      invoiceId,
      updatedInvoice
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
        "The payment reversal failed and the invoice was not changed.",
      { cause: error }
    );
  }
};

/*
|--------------------------------------------------------------------------
| Email invoice
|--------------------------------------------------------------------------
*/

export const emailInvoice = (
  invoiceId,
  emailData
) => {
  const invoice =
    getInvoiceById(
      invoiceId
    );

  if (!invoice) {
    throw new Error(
      "Invoice not found."
    );
  }

  const to =
    String(
      emailData?.to || ""
    ).trim();

  const subject =
    String(
      emailData?.subject ||
        ""
    ).trim();

  const message =
    String(
      emailData?.message ||
        ""
    ).trim();

  if (!to) {
    throw new Error(
      "Enter the recipient email address."
    );
  }

  if (!subject) {
    throw new Error(
      "Enter an email subject."
    );
  }

  if (!message) {
    throw new Error(
      "Enter an email message."
    );
  }

  const now =
    new Date();

  const emailRecord = {
    id: createRecordId(),

    to,

    cc:
      String(
        emailData?.cc ||
          ""
      ).trim(),

    subject,

    message,

    sentAt:
      now.toISOString(),
  };

  const updatedInvoice = {
    ...invoice,

    emails: [
      emailRecord,
      ...(invoice.emails ||
        []),
    ],

    lastEmailedAt:
      now.toISOString(),

    activity: [
      {
        id: createRecordId(),

        title:
          "Invoice emailed",

        description:
          `${invoice.invoiceNumber} was emailed to ${emailRecord.to}.`,

        date:
          formatActivityDate(
            now
          ),
      },

      ...(invoice.activity ||
        []),
    ],

    updatedAt:
      now.toISOString(),
  };

  /*
   * Emailing does not change accounting
   * values, so it does not require a
   * period-lock or journal transition.
   */
  return replaceInvoiceInStorage(
    invoiceId,
    updatedInvoice
  );
};

/*
|--------------------------------------------------------------------------
| Create invoice from quote
|--------------------------------------------------------------------------
*/

export const createInvoiceFromQuote = (
  quote,
  options = {}
) => {
  if (!quote) {
    throw new Error(
      "Quote is required."
    );
  }

  const today =
    new Date();

  const dueDate =
    new Date(
      today.getTime() +
        14 *
          24 *
          60 *
          60 *
          1000
    );

  return createInvoice(
    {
      customerId:
        quote.customerId ??
        null,

      customer:
        quote.customer ||
        quote.customerName ||
        "",

      customerEmail:
        quote.customerEmail ||
        "",

      customerAddress:
        cloneData(
          quote.customerAddress ||
            []
        ),

      issueDate:
        formatDisplayDate(
          today
        ),

      dueDate:
        formatDisplayDate(
          dueDate
        ),

      reference:
        quote.reference ||
        quote.quoteNumber ||
        "",

      currency:
        quote.currency ||
        "GBP",

      pricingMode:
        quote.pricingMode ||
        "exclusive",

      notes:
        quote.notes ||
        "Please use the invoice number as your payment reference.",

      items:
        (
          quote.items || []
        ).map(
          (item) => ({
            ...cloneData(
              item
            ),

            id:
              createRecordId(),
          })
        ),

      sourceQuoteId:
        quote.id,

      sourceQuoteNumber:
        quote.quoteNumber ||
        "",
    },
    "Awaiting payment",
    options
  );
};

/*
|--------------------------------------------------------------------------
| Development reset
|--------------------------------------------------------------------------
*/

export const resetInvoices = () => {
  const initialInvoices =
    cloneData(
      defaultInvoices
    );

  saveInvoices(
    initialInvoices
  );

  return initialInvoices;
};
