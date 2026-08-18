import {
    accounts as defaultAccounts,
} from "../data/accounts";

const STORAGE_KEY =
    "ledgify_chart_of_accounts";

export const ACCOUNT_TYPES = [
    "Asset",
    "Liability",
    "Equity",
    "Income",
    "Expense",
];

export const ACCOUNT_SUBTYPES = {
    Asset: [
        "Bank",
        "Current Asset",
        "Fixed Asset",
        "Other Asset",
    ],

    Liability: [
        "Current Liability",
        "Long-term Liability",
        "Other Liability",
    ],

    Equity: [
        "Owner's Equity",
        "Retained Earnings",
        "Share Capital",
        "Other Equity",
    ],

    Income: [
        "Revenue",
        "Other Income",
    ],

    Expense: [
        "Direct Cost",
        "Operating Expense",
        "Depreciation",
        "Other Expense",
    ],
};

export const TAX_RATE_OPTIONS = [
    "No VAT",
    "0",
    "5",
    "20",
];

const cloneData = (data) =>
    JSON.parse(JSON.stringify(data));

const roundMoney = (value) =>
    Math.round(
        ((Number(value) || 0) +
            Number.EPSILON) *
        100
    ) / 100;

const initialiseAccounts = () => {
    const storedAccounts =
        localStorage.getItem(
            STORAGE_KEY
        );

    if (storedAccounts) {
        try {
            const parsedAccounts =
                JSON.parse(storedAccounts);

            if (
                Array.isArray(
                    parsedAccounts
                )
            ) {
                return parsedAccounts;
            }
        } catch (error) {
            console.error(
                "Unable to read chart of accounts:",
                error
            );
        }
    }

    const initialAccounts =
        cloneData(defaultAccounts);

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
            initialAccounts
        )
    );

    return initialAccounts;
};

const saveAccounts = (
    accounts
) => {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(accounts)
    );

    return accounts;
};

const normaliseText = (
    value
) =>
    String(value || "")
        .trim()
        .toLowerCase();

const getNextId = (
    accounts
) => {
    return (
        accounts.reduce(
            (highest, account) =>
                Math.max(
                    highest,
                    Number(account.id) || 0
                ),
            0
        ) + 1
    );
};

const validateAccount = (
    accountData,
    existingAccounts,
    editingAccountId = null
) => {
    const code = String(
        accountData.code || ""
    ).trim();

    const name = String(
        accountData.name || ""
    ).trim();

    if (!code) {
        throw new Error(
            "Enter an account code."
        );
    }

    if (!name) {
        throw new Error(
            "Enter an account name."
        );
    }

    if (
        !ACCOUNT_TYPES.includes(
            accountData.type
        )
    ) {
        throw new Error(
            "Select a valid account type."
        );
    }

    const validSubtypes =
        ACCOUNT_SUBTYPES[
        accountData.type
        ] || [];

    if (
        !validSubtypes.includes(
            accountData.subtype
        )
    ) {
        throw new Error(
            "Select a valid account subtype."
        );
    }

    const duplicateCode =
        existingAccounts.some(
            (account) =>
                String(account.id) !==
                String(
                    editingAccountId
                ) &&
                normaliseText(
                    account.code
                ) === normaliseText(code)
        );

    if (duplicateCode) {
        throw new Error(
            "An account with this code already exists."
        );
    }

    const duplicateName =
        existingAccounts.some(
            (account) =>
                String(account.id) !==
                String(
                    editingAccountId
                ) &&
                normaliseText(
                    account.name
                ) === normaliseText(name)
        );

    if (duplicateName) {
        throw new Error(
            "An account with this name already exists."
        );
    }
};

const enrichAccount = (
    account
) => {
    const balance =
        roundMoney(
            account.balance ??
            account.openingBalance ??
            0
        );

    const normalBalance =
        [
            "Asset",
            "Expense",
        ].includes(account.type)
            ? "Debit"
            : "Credit";

    return {
        ...account,
        balance,
        normalBalance,
    };
};

export const getAccounts = ({
    search = "",
    type = "All",
    status = "All",
} = {}) => {
    const searchValue =
        normaliseText(search);

    return initialiseAccounts()
        .map(enrichAccount)
        .filter((account) => {
            const matchesSearch =
                !searchValue ||
                [
                    account.code,
                    account.name,
                    account.type,
                    account.subtype,
                    account.description,
                ].some((value) =>
                    normaliseText(
                        value
                    ).includes(
                        searchValue
                    )
                );

            const matchesType =
                type === "All" ||
                account.type === type;

            const matchesStatus =
                status === "All" ||
                account.status === status;

            return (
                matchesSearch &&
                matchesType &&
                matchesStatus
            );
        })
        .sort((first, second) =>
            String(first.code).localeCompare(
                String(second.code),
                undefined,
                {
                    numeric: true,
                }
            )
        );
};

export const getAccountById = (
    accountId
) => {
    const account =
        initialiseAccounts().find(
            (currentAccount) =>
                String(
                    currentAccount.id
                ) === String(accountId)
        );

    return account
        ? enrichAccount(account)
        : null;
};

export const getAccountSummary =
    () => {
        const accounts =
            getAccounts();

        const activeAccounts =
            accounts.filter(
                (account) =>
                    account.status ===
                    "Active"
            );

        const totalsByType =
            ACCOUNT_TYPES.reduce(
                (totals, type) => {
                    totals[type] =
                        roundMoney(
                            activeAccounts
                                .filter(
                                    (account) =>
                                        account.type ===
                                        type
                                )
                                .reduce(
                                    (
                                        total,
                                        account
                                    ) =>
                                        total +
                                        Number(
                                            account.balance
                                        ),
                                    0
                                )
                        );

                    return totals;
                },
                {}
            );

        return {
            total:
                accounts.length,

            active:
                activeAccounts.length,

            archived:
                accounts.filter(
                    (account) =>
                        account.status ===
                        "Archived"
                ).length,

            system:
                accounts.filter(
                    (account) =>
                        account.isSystem
                ).length,

            totalsByType,
        };
    };

export const createAccount = (
    accountData
) => {
    const accounts =
        initialiseAccounts();

    validateAccount(
        accountData,
        accounts
    );

    const now = new Date();

    const newAccount = {
        id: getNextId(accounts),

        code: String(
            accountData.code
        ).trim(),

        name: String(
            accountData.name
        ).trim(),

        type: accountData.type,

        subtype:
            accountData.subtype,

        description: String(
            accountData.description ||
            ""
        ).trim(),

        taxRate:
            accountData.taxRate ||
            "No VAT",

        currency:
            accountData.currency ||
            "GBP",

        openingBalance:
            roundMoney(
                accountData.openingBalance
            ),

        balance:
            roundMoney(
                accountData.openingBalance
            ),

        status: "Active",

        isSystem: false,

        createdAt:
            now.toISOString(),

        updatedAt:
            now.toISOString(),
    };

    saveAccounts([
        ...accounts,
        newAccount,
    ]);

    return enrichAccount(
        newAccount
    );
};

export const updateAccount = (
    accountId,
    accountData
) => {
    const accounts =
        initialiseAccounts();

    const existingAccount =
        accounts.find(
            (account) =>
                String(account.id) ===
                String(accountId)
        );

    if (!existingAccount) {
        throw new Error(
            "Account not found."
        );
    }

    validateAccount(
        accountData,
        accounts,
        accountId
    );

    const existingOpeningBalance =
        roundMoney(
            existingAccount.openingBalance
        );

    const requestedOpeningBalance =
        accountData.openingBalance ===
            undefined
            ? existingOpeningBalance
            : roundMoney(
                accountData.openingBalance
            );

    const nextOpeningBalance =
        existingAccount.isSystem
            ? existingOpeningBalance
            : requestedOpeningBalance;

    const currentBalance =
        roundMoney(
            existingAccount.balance ??
            existingOpeningBalance
        );

    const openingBalanceChange =
        roundMoney(
            nextOpeningBalance -
            existingOpeningBalance
        );

    const updatedAccount = {
        ...existingAccount,

        code: String(
            accountData.code
        ).trim(),

        name: String(
            accountData.name
        ).trim(),

        type: accountData.type,

        subtype:
            accountData.subtype,

        description: String(
            accountData.description || ""
        ).trim(),

        taxRate:
            accountData.taxRate ||
            "No VAT",

        currency:
            accountData.currency ||
            "GBP",

        openingBalance:
            nextOpeningBalance,

        balance:
            existingAccount.isSystem
                ? currentBalance
                : roundMoney(
                    currentBalance +
                    openingBalanceChange
                ),

        updatedAt:
            new Date().toISOString(),
    };

    saveAccounts(
        accounts.map((account) =>
            String(account.id) ===
                String(accountId)
                ? updatedAccount
                : account
        )
    );

    return enrichAccount(
        updatedAccount
    );
};

export const applyAccountBalanceChanges = (
    changes,
    {
        allowArchived = false,
    } = {}
) => {
    if (!Array.isArray(changes)) {
        throw new Error(
            "Account balance changes must be supplied as an array."
        );
    }

    const accounts =
        initialiseAccounts();

    const accountMap = new Map(
        accounts.map((account) => [
            String(account.id),
            account,
        ])
    );

    const changesByAccount =
        new Map();

    changes.forEach((change) => {
        const accountId =
            String(
                change.accountId || ""
            );

        const account =
            accountMap.get(accountId);

        if (!account) {
            throw new Error(
                "A journal account could not be found."
            );
        }

        if (
            account.status !==
            "Active" &&
            !allowArchived
        ) {
            throw new Error(
                `${account.name} is archived and cannot receive new journal entries.`
            );
        }

        const debit =
            roundMoney(change.debit);

        const credit =
            roundMoney(change.credit);

        if (
            debit < 0 ||
            credit < 0
        ) {
            throw new Error(
                "Debit and credit amounts cannot be negative."
            );
        }

        const isDebitNormal =
            [
                "Asset",
                "Expense",
            ].includes(account.type);

        const naturalBalanceChange =
            isDebitNormal
                ? debit - credit
                : credit - debit;

        changesByAccount.set(
            accountId,
            roundMoney(
                (changesByAccount.get(
                    accountId
                ) || 0) +
                naturalBalanceChange
            )
        );
    });

    const now =
        new Date().toISOString();

    const updatedAccounts =
        accounts.map((account) => {
            const balanceChange =
                changesByAccount.get(
                    String(account.id)
                );

            if (
                balanceChange ===
                undefined
            ) {
                return account;
            }

            return {
                ...account,

                balance:
                    roundMoney(
                        Number(
                            account.balance ??
                            account.openingBalance
                        ) +
                        balanceChange
                    ),

                updatedAt: now,
            };
        });

    saveAccounts(
        updatedAccounts
    );

    return updatedAccounts
        .filter((account) =>
            changesByAccount.has(
                String(account.id)
            )
        )
        .map(enrichAccount);
};

export const setAccountOpeningBalance = (
    accountId,
    openingBalance
) => {
    const accounts =
        initialiseAccounts();

    const existingAccount =
        accounts.find(
            (account) =>
                String(account.id) ===
                String(accountId)
        );

    if (!existingAccount) {
        throw new Error(
            "Account not found."
        );
    }

    const previousOpeningBalance =
        roundMoney(
            existingAccount.openingBalance
        );

    const nextOpeningBalance =
        roundMoney(openingBalance);

    const currentBalance =
        roundMoney(
            existingAccount.balance ??
            previousOpeningBalance
        );

    const openingBalanceDifference =
        roundMoney(
            nextOpeningBalance -
            previousOpeningBalance
        );

    const updatedAccount = {
        ...existingAccount,

        openingBalance:
            nextOpeningBalance,

        balance:
            roundMoney(
                currentBalance +
                openingBalanceDifference
            ),

        updatedAt:
            new Date().toISOString(),
    };

    saveAccounts(
        accounts.map((account) =>
            String(account.id) ===
                String(accountId)
                ? updatedAccount
                : account
        )
    );

    return enrichAccount(
        updatedAccount
    );
};

export const archiveAccount = (
    accountId
) => {
    const account =
        getAccountById(accountId);

    if (!account) {
        throw new Error(
            "Account not found."
        );
    }

    if (account.isSystem) {
        throw new Error(
            "System accounts cannot be archived."
        );
    }

    return updateAccountStatus(
        accountId,
        "Archived"
    );
};

export const restoreAccount = (
    accountId
) => {
    return updateAccountStatus(
        accountId,
        "Active"
    );
};

const updateAccountStatus = (
    accountId,
    status
) => {
    const accounts =
        initialiseAccounts();

    const account =
        accounts.find(
            (currentAccount) =>
                String(
                    currentAccount.id
                ) === String(accountId)
        );

    if (!account) {
        throw new Error(
            "Account not found."
        );
    }

    const updatedAccount = {
        ...account,
        status,
        updatedAt:
            new Date().toISOString(),
    };

    saveAccounts(
        accounts.map(
            (currentAccount) =>
                String(
                    currentAccount.id
                ) === String(accountId)
                    ? updatedAccount
                    : currentAccount
        )
    );

    return enrichAccount(
        updatedAccount
    );
};

export const deleteAccount = (
    accountId
) => {
    const accounts =
        initialiseAccounts();

    const account =
        accounts.find(
            (currentAccount) =>
                String(
                    currentAccount.id
                ) === String(accountId)
        );

    if (!account) {
        throw new Error(
            "Account not found."
        );
    }

    if (account.isSystem) {
        throw new Error(
            "System accounts cannot be deleted."
        );
    }

    if (
        Math.abs(
            Number(account.balance) || 0
        ) > 0.005
    ) {
        throw new Error(
            "Accounts with a balance cannot be deleted. Archive the account instead."
        );
    }

    saveAccounts(
        accounts.filter(
            (currentAccount) =>
                String(
                    currentAccount.id
                ) !== String(accountId)
        )
    );

    return account;
};

export const resetAccounts =
    () => {
        const initialAccounts =
            cloneData(defaultAccounts);

        saveAccounts(
            initialAccounts
        );

        return initialAccounts;
    };