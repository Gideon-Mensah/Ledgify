import {
    getAccounts,
} from "./accountService";

import {
    getProductById,
} from "./productService";

import {
    createSystemJournal,
    reverseSystemJournal,
    rollbackSystemJournal,
} from "./journalService";

const SOURCE_TYPE = "Bill";

const SOURCE_ACTION =
    "Bill approval";

const ACCOUNTING_STATUSES =
    new Set([
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

const normaliseFinancialItem = (
    item
) => {
    return {
        productId:
            item?.productId ?? null,

        description:
            String(
                item?.description || ""
            ).trim(),

        quantity:
            roundMoney(
                item?.quantity
            ),

        unitPrice:
            roundMoney(
                item?.unitPrice
            ),

        discountRate:
            roundMoney(
                item?.discountRate
            ),

        vatRate:
            roundMoney(
                item?.vatRate
            ),

        accountCode:
            String(
                item?.accountCode || ""
            ).trim(),

        accountName:
            String(
                item?.accountName || ""
            ).trim(),

        purchaseAccount:
            String(
                item?.purchaseAccount || ""
            ).trim(),

        trackInventory:
            Boolean(
                item?.trackInventory
            ),
    };
};

export const hasBillFinancialChanges = (
    currentBill,
    nextBill
) => {
    const currentFinancialData = {
        billNumber:
            currentBill?.billNumber || "",

        supplierId:
            currentBill?.supplierId ??
            null,

        supplier:
            currentBill?.supplier || "",

        issueDate:
            currentBill?.issueDate || "",

        currency:
            currentBill?.currency ||
            "GBP",

        pricingMode:
            currentBill?.pricingMode ||
            "exclusive",

        items: (
            currentBill?.items || []
        ).map(
            normaliseFinancialItem
        ),
    };

    const nextFinancialData = {
        billNumber:
            nextBill?.billNumber || "",

        supplierId:
            nextBill?.supplierId ??
            null,

        supplier:
            nextBill?.supplier || "",

        issueDate:
            nextBill?.issueDate || "",

        currency:
            nextBill?.currency ||
            "GBP",

        pricingMode:
            nextBill?.pricingMode ||
            "exclusive",

        items: (
            nextBill?.items || []
        ).map(
            normaliseFinancialItem
        ),
    };

    return (
        JSON.stringify(
            currentFinancialData
        ) !==
        JSON.stringify(
            nextFinancialData
        )
    );
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

const resolveExpenseAccount = (
    accounts,
    item
) => {
    const requestedValues = [
        item.accountCode,
        item.accountName,
        item.purchaseAccount,
    ]
        .map(normaliseText)
        .filter(Boolean);

    const requestedCodes =
        requestedValues
            .map((value) => {
                const match =
                    value.match(
                        /^(\d+)/
                    );

                return match
                    ? match[1]
                    : value;
            })
            .filter(Boolean);

    const matchingAccount =
        accounts.find(
            (account) =>
                requestedCodes.includes(
                    normaliseText(
                        account.code
                    )
                ) ||
                requestedValues.includes(
                    normaliseText(
                        account.name
                    )
                ) ||
                requestedValues.some(
                    (value) =>
                        value.includes(
                            normaliseText(
                                account.name
                            )
                        )
                )
        );

    if (matchingAccount) {
        if (
            ![
                "Expense",
                "Asset",
            ].includes(
                matchingAccount.type
            )
        ) {
            throw new Error(
                `${matchingAccount.name} cannot be used as a bill expense account.`
            );
        }

        return matchingAccount;
    }

    return requireAccountByCode(
        accounts,
        "490",
        "Other Expenses"
    );
};

const calculateBillLine = (
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

const isTrackedInventoryItem = (
    item
) => {
    if (!item.productId) {
        return Boolean(
            item.trackInventory
        );
    }

    const product =
        getProductById(
            item.productId
        );

    if (!product) {
        throw new Error(
            `The product linked to ${item.description ||
            "a bill line"
            } could not be found.`
        );
    }

    return (
        product.type ===
        "Product" &&
        product.trackInventory
    );
};

const buildBillJournalLines = (
    bill
) => {
    const accounts =
        getAccounts({
            status: "Active",
        });

    const payableAccount =
        requireAccountByCode(
            accounts,
            "200",
            "Accounts Payable"
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

    const debitTotals =
        new Map();

    let inventoryTotal = 0;
    let totalVat = 0;
    let totalNet = 0;

    const items = Array.isArray(
        bill.items
    )
        ? bill.items
        : [];

    items.forEach((item) => {
        const lineAmounts =
            calculateBillLine(
                item,
                bill.pricingMode ||
                "exclusive"
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

        if (
            isTrackedInventoryItem(
                item
            )
        ) {
            inventoryTotal =
                roundMoney(
                    inventoryTotal +
                    lineAmounts.netAmount
                );

            return;
        }

        const expenseAccount =
            resolveExpenseAccount(
                accounts,
                item
            );

        const accountKey =
            String(
                expenseAccount.id
            );

        const existingAmount =
            debitTotals.get(
                accountKey
            );

        debitTotals.set(
            accountKey,
            {
                account:
                    expenseAccount,

                amount:
                    roundMoney(
                        (existingAmount?.amount ||
                            0) +
                        lineAmounts.netAmount
                    ),
            }
        );
    });

    const totalPayable =
        roundMoney(
            totalNet + totalVat
        );

    if (totalPayable <= 0) {
        throw new Error(
            "An approved bill must have a total greater than zero."
        );
    }

    const lines = [];

    if (inventoryTotal > 0) {
        lines.push({
            accountId:
                inventoryAccount.id,

            description:
                `${bill.billNumber} inventory purchased`,

            debit:
                inventoryTotal,

            credit: 0,
        });
    }

    debitTotals.forEach(
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
                    `${bill.billNumber} expense`,

                debit:
                    amount,

                credit: 0,
            });
        }
    );

    if (totalVat > 0) {
        lines.push({
            accountId:
                vatControlAccount.id,

            description:
                `${bill.billNumber} input VAT`,

            debit:
                totalVat,

            credit: 0,
        });
    }

    lines.push({
        accountId:
            payableAccount.id,

        description:
            `${bill.billNumber} – ${bill.supplier}`,

        debit: 0,

        credit:
            totalPayable,
    });

    return lines;
};

export const billStatusAffectsAccounting =
    (status) => {
        return (
            ACCOUNTING_STATUSES.has(
                status
            )
        );
    };

export const postBillAccounting = (
    bill
) => {
    if (
        String(
            bill.currency || "GBP"
        ).toUpperCase() !== "GBP"
    ) {
        throw new Error(
            "Automatic accounting posting currently supports GBP bills only."
        );
    }

    const journal =
        createSystemJournal({
            sourceType:
                SOURCE_TYPE,

            sourceId:
                bill.id,

            sourceNumber:
                bill.billNumber,

            sourceAction:
                SOURCE_ACTION,

            date:
                toJournalDate(
                    bill.issueDate
                ),

            reference:
                bill.supplierReference ||
                bill.billNumber,

            description:
                `Supplier bill ${bill.billNumber} from ${bill.supplier}.`,

            currency:
                bill.currency || "GBP",

            lines:
                buildBillJournalLines(
                    bill
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

export const reverseBillAccounting = (
    bill,
    reason =
        "Bill reversed"
) => {
    const result =
        reverseSystemJournal(
            SOURCE_TYPE,
            bill.id,
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
                ?.id || null,
    };
};

export const rollbackBillAccounting = (
    accountingJournalId
) => {
    if (!accountingJournalId) {
        return null;
    }

    return rollbackSystemJournal(
        accountingJournalId
    );
};