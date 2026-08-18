import {
  getAccounts,
} from "./accountService";

import {
  getBankAccountById,
  getBankLedgerAccount,
} from "./bankAccountService";

import {
  createSystemJournal,
  reverseSystemJournal,
  rollbackSystemJournal,
} from "./journalService";

const INVOICE_PAYMENT_SOURCE_TYPE =
  "Invoice payment";

const INVOICE_PAYMENT_SOURCE_ACTION =
  "Customer receipt";

const BILL_PAYMENT_SOURCE_TYPE =
  "Bill payment";

const BILL_PAYMENT_SOURCE_ACTION =
  "Supplier payment";

const roundMoney = (value) => {
  return (
    Math.round(
      ((Number(value) || 0) +
        Number.EPSILON) *
        100
    ) / 100
  );
};

const toJournalDate = (value) => {
  if (!value) {
    return new Date()
      .toISOString()
      .slice(0, 10);
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

  const dateMatch =
    text.match(
      /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
    );

  if (dateMatch) {
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
        dateMatch[2]
          .toLowerCase()
      ];

    if (month) {
      return `${dateMatch[3]}-${String(
        month
      ).padStart(2, "0")}-${String(
        dateMatch[1]
      ).padStart(2, "0")}`;
    }
  }

  const parsedDate =
    new Date(text);

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }

  return parsedDate
    .toISOString()
    .slice(0, 10);
};

const requireAccountByCode = (
  code,
  label
) => {
  const account =
    getAccounts({
      status: "Active",
    }).find(
      (currentAccount) =>
        String(
          currentAccount.code
        ) === String(code)
    );

  if (!account) {
    throw new Error(
      `${label} account ${code} could not be found in the Chart of Accounts.`
    );
  }

  return account;
};

const validatePayment = (
  payment,
  documentCurrency
) => {
  if (!payment) {
    throw new Error(
      "Payment details are required."
    );
  }

  if (!payment.id) {
    throw new Error(
      "The payment must have an ID before accounting can be posted."
    );
  }

  const amount =
    roundMoney(
      payment.amount
    );

  if (amount <= 0) {
    throw new Error(
      "The payment amount must be greater than zero."
    );
  }

  if (!payment.bankAccountId) {
    throw new Error(
      "Select a bank account for the payment."
    );
  }

  const currency =
    String(
      documentCurrency ||
        payment.accountCurrency ||
        "GBP"
    ).toUpperCase();

  if (currency !== "GBP") {
    throw new Error(
      "Automatic payment accounting currently supports GBP transactions only."
    );
  }

  const bankAccount =
    getBankAccountById(
      payment.bankAccountId
    );

  if (!bankAccount) {
    throw new Error(
      "The selected bank account could not be found."
    );
  }

  if (
    bankAccount.status ===
    "Archived"
  ) {
    throw new Error(
      `${bankAccount.accountName} is archived and cannot receive new payments.`
    );
  }

  if (
    String(
      bankAccount.currency ||
        "GBP"
    ).toUpperCase() !==
    currency
  ) {
    throw new Error(
      `The ${bankAccount.accountName} currency does not match the payment currency.`
    );
  }

  const ledgerAccount =
    getBankLedgerAccount(
      bankAccount.id
    );

  if (
    ledgerAccount.status !==
    "Active"
  ) {
    throw new Error(
      `${ledgerAccount.name} is archived in the Chart of Accounts.`
    );
  }

  return {
    amount,
    currency,
    bankAccount,
    ledgerAccount,
  };
};

export const postInvoicePaymentAccounting = (
  invoice,
  payment
) => {
  if (!invoice) {
    throw new Error(
      "Invoice details are required."
    );
  }

  const {
    amount,
    currency,
    bankAccount,
    ledgerAccount,
  } = validatePayment(
    payment,
    invoice.currency
  );

  const receivablesAccount =
    requireAccountByCode(
      "110",
      "Accounts Receivable"
    );

  const journal =
    createSystemJournal({
      sourceType:
        INVOICE_PAYMENT_SOURCE_TYPE,

      sourceId:
        payment.id,

      sourceNumber:
        invoice.invoiceNumber,

      sourceAction:
        INVOICE_PAYMENT_SOURCE_ACTION,

      date:
        toJournalDate(
          payment.paymentDate
        ),

      reference:
        payment.reference ||
        invoice.invoiceNumber,

      description:
        `Customer receipt for ${invoice.invoiceNumber} from ${
          invoice.customer ||
          "customer"
        } into ${bankAccount.accountName}.`,

      currency,

      lines: [
        {
          accountId:
            ledgerAccount.id,

          description:
            `${invoice.invoiceNumber} customer receipt`,

          debit: amount,

          credit: 0,
        },
        {
          accountId:
            receivablesAccount.id,

          description:
            `${invoice.invoiceNumber} receivable settled`,

          debit: 0,

          credit: amount,
        },
      ],
    });

  return {
    accountingPosted:
      true,

    accountingJournalId:
      journal.id,

    accountingPostedAt:
      journal.postedAt ||
      journal.createdAt,

    accountingReversedAt:
      null,

    accountingReversalJournalId:
      null,
  };
};

export const reverseInvoicePaymentAccounting = (
  invoice,
  payment,
  reason =
    "Customer receipt reversed"
) => {
  if (!payment?.id) {
    return {
      accountingPosted:
        false,

      accountingReversedAt:
        new Date().toISOString(),

      accountingReversalJournalId:
        null,
    };
  }

  const result =
    reverseSystemJournal(
      INVOICE_PAYMENT_SOURCE_TYPE,
      payment.id,
      INVOICE_PAYMENT_SOURCE_ACTION,
      reason
    );

  if (!result) {
    return {
      accountingPosted:
        false,

      accountingReversedAt:
        new Date().toISOString(),

      accountingReversalJournalId:
        null,
    };
  }

  return {
    accountingPosted:
      false,

    accountingReversedAt:
      result.reversalJournal
        ?.postedAt ||
      result.reversalJournal
        ?.createdAt ||
      new Date().toISOString(),

    accountingReversalJournalId:
      result.reversalJournal
        ?.id ||
      null,
  };
};

export const rollbackInvoicePaymentAccounting = (
  accountingJournalId
) => {
  if (!accountingJournalId) {
    return null;
  }

  return rollbackSystemJournal(
    accountingJournalId
  );
};

export const postBillPaymentAccounting = (
  bill,
  payment
) => {
  if (!bill) {
    throw new Error(
      "Bill details are required."
    );
  }

  const {
    amount,
    currency,
    bankAccount,
    ledgerAccount,
  } = validatePayment(
    payment,
    bill.currency
  );

  const payableAccount =
    requireAccountByCode(
      "200",
      "Accounts Payable"
    );

  const journal =
    createSystemJournal({
      sourceType:
        BILL_PAYMENT_SOURCE_TYPE,

      sourceId:
        payment.id,

      sourceNumber:
        bill.billNumber,

      sourceAction:
        BILL_PAYMENT_SOURCE_ACTION,

      date:
        toJournalDate(
          payment.paymentDate
        ),

      reference:
        payment.reference ||
        bill.billNumber,

      description:
        `Supplier payment for ${bill.billNumber} to ${
          bill.supplier ||
          "supplier"
        } from ${bankAccount.accountName}.`,

      currency,

      lines: [
        {
          accountId:
            payableAccount.id,

          description:
            `${bill.billNumber} payable settled`,

          debit: amount,

          credit: 0,
        },
        {
          accountId:
            ledgerAccount.id,

          description:
            `${bill.billNumber} supplier payment`,

          debit: 0,

          credit: amount,
        },
      ],
    });

  return {
    accountingPosted:
      true,

    accountingJournalId:
      journal.id,

    accountingPostedAt:
      journal.postedAt ||
      journal.createdAt,

    accountingReversedAt:
      null,

    accountingReversalJournalId:
      null,
  };
};

export const reverseBillPaymentAccounting = (
  bill,
  payment,
  reason =
    "Supplier payment reversed"
) => {
  if (!payment?.id) {
    return {
      accountingPosted:
        false,

      accountingReversedAt:
        new Date().toISOString(),

      accountingReversalJournalId:
        null,
    };
  }

  const result =
    reverseSystemJournal(
      BILL_PAYMENT_SOURCE_TYPE,
      payment.id,
      BILL_PAYMENT_SOURCE_ACTION,
      reason
    );

  if (!result) {
    return {
      accountingPosted:
        false,

      accountingReversedAt:
        new Date().toISOString(),

      accountingReversalJournalId:
        null,
    };
  }

  return {
    accountingPosted:
      false,

    accountingReversedAt:
      result.reversalJournal
        ?.postedAt ||
      result.reversalJournal
        ?.createdAt ||
      new Date().toISOString(),

    accountingReversalJournalId:
      result.reversalJournal
        ?.id ||
      null,
  };
};

export const rollbackBillPaymentAccounting = (
  accountingJournalId
) => {
  if (!accountingJournalId) {
    return null;
  }

  return rollbackSystemJournal(
    accountingJournalId
  );
};