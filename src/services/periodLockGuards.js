import {
  assertDateIsOpen,
  PERIOD_LOCK_AREAS,
} from "./periodLockService";

const resolveDate = (
  source,
  fields
) => {
  if (!source) {
    return "";
  }

  for (const field of fields) {
    const value = source[field];

    if (value) {
      return value;
    }
  }

  return "";
};

const requireTransactionDate = (
  date,
  documentName
) => {
  if (!date) {
    throw new Error(
      `${documentName} must have a transaction date before period-lock validation can be completed.`
    );
  }

  return date;
};

const buildOptions = (
  action,
  {
    allowPeriodLockOverride = false,
  } = {}
) => ({
  action,

  allowOverride:
    Boolean(
      allowPeriodLockOverride
    ),
});

const assertOriginalAndNewDatesOpen = ({
  originalDate,
  nextDate,
  area,
  action,
  documentName,
  options,
}) => {
  const resolvedOriginalDate =
    requireTransactionDate(
      originalDate,
      documentName
    );

  assertDateIsOpen(
    resolvedOriginalDate,
    area,
    buildOptions(
      action,
      options
    )
  );

  if (
    nextDate &&
    nextDate !==
      resolvedOriginalDate
  ) {
    assertDateIsOpen(
      nextDate,
      area,
      buildOptions(
        action,
        options
      )
    );
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| Sales
|--------------------------------------------------------------------------
*/

export const getInvoiceLockDate = (
  invoice
) => {
  return resolveDate(
    invoice,
    [
      "issueDate",
      "invoiceDate",
      "date",
      "createdAt",
    ]
  );
};

export const assertInvoicePeriodOpen = (
  invoice,
  action =
    "change this invoice",
  options = {}
) => {
  const invoiceDate =
    requireTransactionDate(
      getInvoiceLockDate(
        invoice
      ),
      "The invoice"
    );

  return assertDateIsOpen(
    invoiceDate,
    PERIOD_LOCK_AREAS.SALES,
    buildOptions(
      action,
      options
    )
  );
};

export const assertInvoiceChangePeriodOpen = (
  existingInvoice,
  updatedInvoice,
  action =
    "edit this invoice",
  options = {}
) => {
  return assertOriginalAndNewDatesOpen({
    originalDate:
      getInvoiceLockDate(
        existingInvoice
      ),

    nextDate:
      getInvoiceLockDate(
        updatedInvoice
      ),

    area:
      PERIOD_LOCK_AREAS.SALES,

    action,

    documentName:
      "The invoice",

    options,
  });
};

export const assertInvoicePaymentPeriodOpen = (
  payment,
  invoice,
  action =
    "record this customer payment",
  options = {}
) => {
  const paymentDate =
    resolveDate(
      payment,
      [
        "date",
        "paymentDate",
        "paidAt",
        "transactionDate",
        "createdAt",
      ]
    ) ||
    getInvoiceLockDate(
      invoice
    );

  requireTransactionDate(
    paymentDate,
    "The customer payment"
  );

  return assertDateIsOpen(
    paymentDate,
    PERIOD_LOCK_AREAS.SALES,
    buildOptions(
      action,
      options
    )
  );
};

/*
|--------------------------------------------------------------------------
| Purchases
|--------------------------------------------------------------------------
*/

export const getBillLockDate = (
  bill
) => {
  return resolveDate(
    bill,
    [
      "issueDate",
      "billDate",
      "date",
      "createdAt",
    ]
  );
};

export const assertBillPeriodOpen = (
  bill,
  action =
    "change this supplier bill",
  options = {}
) => {
  const billDate =
    requireTransactionDate(
      getBillLockDate(
        bill
      ),
      "The supplier bill"
    );

  return assertDateIsOpen(
    billDate,
    PERIOD_LOCK_AREAS.PURCHASES,
    buildOptions(
      action,
      options
    )
  );
};

export const assertBillChangePeriodOpen = (
  existingBill,
  updatedBill,
  action =
    "edit this supplier bill",
  options = {}
) => {
  return assertOriginalAndNewDatesOpen({
    originalDate:
      getBillLockDate(
        existingBill
      ),

    nextDate:
      getBillLockDate(
        updatedBill
      ),

    area:
      PERIOD_LOCK_AREAS.PURCHASES,

    action,

    documentName:
      "The supplier bill",

    options,
  });
};

export const assertBillPaymentPeriodOpen = (
  payment,
  bill,
  action =
    "record this supplier payment",
  options = {}
) => {
  const paymentDate =
    resolveDate(
      payment,
      [
        "date",
        "paymentDate",
        "paidAt",
        "transactionDate",
        "createdAt",
      ]
    ) ||
    getBillLockDate(bill);

  requireTransactionDate(
    paymentDate,
    "The supplier payment"
  );

  return assertDateIsOpen(
    paymentDate,
    PERIOD_LOCK_AREAS.PURCHASES,
    buildOptions(
      action,
      options
    )
  );
};

/*
|--------------------------------------------------------------------------
| Banking
|--------------------------------------------------------------------------
*/

export const getBankTransactionLockDate = (
  transaction
) => {
  return resolveDate(
    transaction,
    [
      "date",
      "transactionDate",
      "valueDate",
      "postedDate",
      "createdAt",
    ]
  );
};

export const assertBankTransactionPeriodOpen = (
  transaction,
  action =
    "change this bank transaction",
  options = {}
) => {
  const transactionDate =
    requireTransactionDate(
      getBankTransactionLockDate(
        transaction
      ),
      "The bank transaction"
    );

  return assertDateIsOpen(
    transactionDate,
    PERIOD_LOCK_AREAS.BANKING,
    buildOptions(
      action,
      options
    )
  );
};

export const assertBankTransactionChangePeriodOpen = (
  existingTransaction,
  updatedTransaction,
  action =
    "edit this bank transaction",
  options = {}
) => {
  return assertOriginalAndNewDatesOpen({
    originalDate:
      getBankTransactionLockDate(
        existingTransaction
      ),

    nextDate:
      getBankTransactionLockDate(
        updatedTransaction
      ),

    area:
      PERIOD_LOCK_AREAS.BANKING,

    action,

    documentName:
      "The bank transaction",

    options,
  });
};

/*
|--------------------------------------------------------------------------
| Manual journals
|--------------------------------------------------------------------------
*/

export const getJournalLockDate = (
  journal
) => {
  return resolveDate(
    journal,
    [
      "date",
      "journalDate",
      "postedAt",
      "createdAt",
    ]
  );
};

export const assertManualJournalPeriodOpen = (
  journal,
  action =
    "change this manual journal",
  options = {}
) => {
  const journalDate =
    requireTransactionDate(
      getJournalLockDate(
        journal
      ),
      "The manual journal"
    );

  return assertDateIsOpen(
    journalDate,
    PERIOD_LOCK_AREAS.JOURNALS,
    buildOptions(
      action,
      options
    )
  );
};

export const assertManualJournalChangePeriodOpen = (
  existingJournal,
  updatedJournal,
  action =
    "edit this manual journal",
  options = {}
) => {
  return assertOriginalAndNewDatesOpen({
    originalDate:
      getJournalLockDate(
        existingJournal
      ),

    nextDate:
      getJournalLockDate(
        updatedJournal
      ),

    area:
      PERIOD_LOCK_AREAS.JOURNALS,

    action,

    documentName:
      "The manual journal",

    options,
  });
};