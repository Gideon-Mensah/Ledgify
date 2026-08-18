import {
  getAccounts,
} from "./accountService";

import {
  createSystemJournal,
  reverseSystemJournal,
  rollbackSystemJournal,
} from "./journalService";

const SOURCE_TYPE =
  "Invoice";

const SOURCE_ACTION =
  "Invoice approval";

const ACCOUNTING_STATUSES =
  new Set([
    "Approved",
    "Sent",
    "Awaiting payment",
    "Partly paid",
    "Paid",
    "Overdue",
  ]);

const roundMoney = (
  amount
) => {
  return (
    Math.round(
      ((Number(amount) || 0) +
        Number.EPSILON) *
        100
    ) / 100
  );
};

const normaliseText = (
  value
) => {
  return String(value || "")
    .trim()
    .toLowerCase();
};

const toJournalDate = (
  value
) => {
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

const getActiveAccounts = () => {
  return getAccounts({
    status: "Active",
  });
};

const requireAccountByCode = (
  accounts,
  code,
  label
) => {
  const account =
    accounts.find(
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

const resolveRevenueAccount = (
  accounts,
  item
) => {
  const requestedAccount =
    normaliseText(
      item.salesAccount
    );

  if (requestedAccount) {
    const matchingAccount =
      accounts.find(
        (account) =>
          normaliseText(
            account.code
          ) ===
            requestedAccount ||
          normaliseText(
            account.name
          ) ===
            requestedAccount
      );

    if (
      matchingAccount &&
      matchingAccount.type ===
        "Income"
    ) {
      return matchingAccount;
    }
  }

  const aliases = {
    sales: "500",
    "sales revenue": "500",
    revenue: "500",
    "service income": "510",
    services: "510",
  };

  const aliasedCode =
    aliases[requestedAccount];

  if (aliasedCode) {
    return requireAccountByCode(
      accounts,
      aliasedCode,
      "Revenue"
    );
  }

  return requireAccountByCode(
    accounts,
    item.itemType ===
      "Service"
      ? "510"
      : "500",
    "Revenue"
  );
};

const calculateInvoiceLine = (
  item,
  pricingMode
) => {
  const quantity =
    Number(item.quantity) || 0;

  const unitPrice =
    Number(item.unitPrice) || 0;

  const discountRate =
    Math.min(
      Math.max(
        Number(
          item.discountRate
        ) || 0,
        0
      ),
      100
    );

  const vatRate =
    Math.max(
      Number(item.vatRate) || 0,
      0
    );

  const grossAmount =
    quantity * unitPrice;

  const discountedAmount =
    grossAmount *
    (1 -
      discountRate / 100);

  let netAmount =
    discountedAmount;

  let vatAmount =
    discountedAmount *
    (vatRate / 100);

  if (
    pricingMode ===
    "inclusive"
  ) {
    netAmount =
      vatRate > 0
        ? discountedAmount /
          (1 + vatRate / 100)
        : discountedAmount;

    vatAmount =
      discountedAmount -
      netAmount;
  }

  return {
    netAmount:
      roundMoney(netAmount),

    vatAmount:
      roundMoney(vatAmount),
  };
};

const buildInvoiceJournalLines = (
  invoice
) => {
  const accounts =
    getActiveAccounts();

  const receivablesAccount =
    requireAccountByCode(
      accounts,
      "110",
      "Accounts Receivable"
    );

  const vatControlAccount =
    requireAccountByCode(
      accounts,
      "210",
      "VAT Control"
    );

  const inventoryAccount =
    requireAccountByCode(
      accounts,
      "120",
      "Inventory"
    );

  const costOfSalesAccount =
    requireAccountByCode(
      accounts,
      "300",
      "Cost of Goods Sold"
    );

  const revenueTotals =
    new Map();

  let totalNet = 0;
  let totalVat = 0;

  const items = Array.isArray(
    invoice.items
  )
    ? invoice.items
    : [];

  items.forEach((item) => {
    const lineAmounts =
      calculateInvoiceLine(
        item,
        invoice.pricingMode ||
          "exclusive"
      );

    const revenueAccount =
      resolveRevenueAccount(
        accounts,
        item
      );

    totalNet =
      roundMoney(
        totalNet +
          lineAmounts.netAmount
      );

    totalVat =
      roundMoney(
        totalVat +
          lineAmounts.vatAmount
      );

    const accountKey =
      String(
        revenueAccount.id
      );

    const existingRevenue =
      revenueTotals.get(
        accountKey
      );

    revenueTotals.set(
      accountKey,
      {
        account:
          revenueAccount,

        amount:
          roundMoney(
            (existingRevenue?.amount ||
              0) +
              lineAmounts.netAmount
          ),
      }
    );
  });

  const totalReceivable =
    roundMoney(
      totalNet + totalVat
    );

  if (
    totalReceivable <= 0
  ) {
    throw new Error(
      "An approved invoice must have a total greater than zero."
    );
  }

  const lines = [
    {
      accountId:
        receivablesAccount.id,

      description:
        `${invoice.invoiceNumber} – ${invoice.customer}`,

      debit:
        totalReceivable,

      credit: 0,
    },
  ];

  revenueTotals.forEach(
    ({
      account,
      amount,
    }) => {
      if (amount <= 0) {
        return;
      }

      lines.push({
        accountId:
          account.id,

        description:
          `${invoice.invoiceNumber} revenue`,

        debit: 0,

        credit:
          amount,
      });
    }
  );

  if (totalVat > 0) {
    lines.push({
      accountId:
        vatControlAccount.id,

      description:
        `${invoice.invoiceNumber} output VAT`,

      debit: 0,

      credit:
        totalVat,
    });
  }

  const inventoryCost =
    roundMoney(
      (
        invoice.inventoryCommitments ||
        []
      ).reduce(
        (
          total,
          commitment
        ) =>
          total +
          Number(
            commitment.quantity
          ) *
            Number(
              commitment.unitCost
            ),
        0
      )
    );

  if (inventoryCost > 0) {
    lines.push(
      {
        accountId:
          costOfSalesAccount.id,

        description:
          `${invoice.invoiceNumber} inventory cost`,

        debit:
          inventoryCost,

        credit: 0,
      },
      {
        accountId:
          inventoryAccount.id,

        description:
          `${invoice.invoiceNumber} inventory issued`,

        debit: 0,

        credit:
          inventoryCost,
      }
    );
  }

  return lines;
};

export const invoiceStatusAffectsAccounting =
  (status) => {
    return (
      ACCOUNTING_STATUSES.has(
        status
      )
    );
  };

export const postInvoiceAccounting = (
  invoice
) => {
  if (
    String(
      invoice.currency ||
        "GBP"
    ).toUpperCase() !==
    "GBP"
  ) {
    throw new Error(
      "Automatic accounting posting currently supports GBP invoices only."
    );
  }

  const journal =
    createSystemJournal({
      sourceType:
        SOURCE_TYPE,

      sourceId:
        invoice.id,

      sourceNumber:
        invoice.invoiceNumber,

      sourceAction:
        SOURCE_ACTION,

      date:
        toJournalDate(
          invoice.issueDate
        ),

      reference:
        invoice.reference ||
        invoice.invoiceNumber,

      description:
        `Sales invoice ${invoice.invoiceNumber} for ${invoice.customer}.`,

      currency:
        invoice.currency ||
        "GBP",

      lines:
        buildInvoiceJournalLines(
          invoice
        ),
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

export const reverseInvoiceAccounting = (
  invoice,
  reason =
    "Invoice reversed"
) => {
  const result =
    reverseSystemJournal(
      SOURCE_TYPE,
      invoice.id,
      SOURCE_ACTION,
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

export const rollbackInvoiceAccounting = (
  accountingJournalId
) => {
  if (!accountingJournalId) {
    return null;
  }

  return rollbackSystemJournal(
    accountingJournalId
  );
};