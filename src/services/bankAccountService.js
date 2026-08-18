import {
  createAccount,
  getAccountById,
  getAccounts as getLedgerAccounts,
  setAccountOpeningBalance,
  updateAccount,
} from "./accountService";

const STORAGE_KEY =
  "ledgify_bank_accounts";

const DEFAULT_BANK_ACCOUNTS = [
  {
    id: "bank-001",
    accountName:
      "Business Current Account",

    bankName: "Barclays",

    accountType:
      "Current account",

    accountNumber:
      "12345678",

    sortCode: "20-00-00",

    currency: "GBP",

    openingBalance: 8500,

    currentBalance: 12540.32,

    feedStatus: "Connected",

    lastSync:
      "Today, 09:32",

    isDefault: true,

    status: "Active",

    ledgerAccountId: null,

    ledgerAccountCode: "100",

    ledgerOpeningBalanceInitialised:
      false,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "bank-002",

    accountName:
      "Business Savings",

    bankName: "Lloyds Bank",

    accountType:
      "Savings account",

    accountNumber:
      "87654321",

    sortCode: "30-00-00",

    currency: "GBP",

    openingBalance: 15000,

    currentBalance: 18420,

    feedStatus: "Manual",

    lastSync:
      "Not connected",

    isDefault: false,

    status: "Active",

    ledgerAccountId: null,

    ledgerAccountCode: "",

    ledgerOpeningBalanceInitialised:
      false,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "bank-003",

    accountName: "Petty Cash",

    bankName:
      "Cash account",

    accountType:
      "Cash account",

    accountNumber: "",

    sortCode: "",

    currency: "GBP",

    openingBalance: 300,

    currentBalance: 184.5,

    feedStatus: "Manual",

    lastSync:
      "Not applicable",

    isDefault: false,

    status: "Active",

    ledgerAccountId: null,

    ledgerAccountCode: "",

    ledgerOpeningBalanceInitialised:
      false,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString(),
  },
];

const cloneData = (data) => {
  return JSON.parse(
    JSON.stringify(data)
  );
};

const createId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `bank-${Date.now()}-${Math.random()
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

const saveAccounts = (
  accounts
) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(accounts)
  );

  return accounts;
};

const getNextBankLedgerCode =
  () => {
    const ledgerAccounts =
      getLedgerAccounts({
        status: "All",
      });

    const usedCodes = new Set(
      ledgerAccounts.map(
        (account) =>
          String(account.code)
      )
    );

    for (
      let code = 101;
      code <= 199;
      code += 1
    ) {
      if (
        !usedCodes.has(
          String(code)
        )
      ) {
        return String(code);
      }
    }

    throw new Error(
      "No available bank account codes remain between 101 and 199."
    );
  };

const findLedgerAccountByName = (
  bankAccount,
  claimedLedgerAccountIds
) => {
  const ledgerAccounts =
    getLedgerAccounts({
      status: "All",
    });

  return (
    ledgerAccounts.find(
      (account) =>
        account.type === "Asset" &&
        account.subtype ===
          "Bank" &&
        normaliseText(
          account.name
        ) ===
          normaliseText(
            bankAccount.accountName
          ) &&
        !claimedLedgerAccountIds.has(
          String(account.id)
        )
    ) || null
  );
};

const findDefaultLedgerAccount = (
  claimedLedgerAccountIds
) => {
  const account =
    getLedgerAccounts({
      status: "All",
    }).find(
      (currentAccount) =>
        String(
          currentAccount.code
        ) === "100"
    );

  if (
    !account ||
    claimedLedgerAccountIds.has(
      String(account.id)
    )
  ) {
    return null;
  }

  return account;
};

const createBankLedgerAccount = (
  bankAccount
) => {
  return createAccount({
    code:
      getNextBankLedgerCode(),

    name:
      bankAccount.accountName,

    type: "Asset",

    subtype: "Bank",

    description:
      `${bankAccount.bankName || "Bank"} – ${
        bankAccount.accountType ||
        "bank account"
      }`,

    taxRate: "No VAT",

    currency:
      bankAccount.currency ||
      "GBP",

    openingBalance:
      roundMoney(
        bankAccount.openingBalance
      ),
  });
};

const ensureLedgerAccountLink = (
  bankAccount,
  claimedLedgerAccountIds
) => {
  let ledgerAccount = null;

  if (
    bankAccount.ledgerAccountId
  ) {
    ledgerAccount =
      getAccountById(
        bankAccount.ledgerAccountId
      );
  }

  if (
    !ledgerAccount &&
    bankAccount.isDefault
  ) {
    ledgerAccount =
      findDefaultLedgerAccount(
        claimedLedgerAccountIds
      );
  }

  if (!ledgerAccount) {
    ledgerAccount =
      findLedgerAccountByName(
        bankAccount,
        claimedLedgerAccountIds
      );
  }

  if (!ledgerAccount) {
    ledgerAccount =
      createBankLedgerAccount(
        bankAccount
      );
  }

  if (
    !bankAccount
      .ledgerOpeningBalanceInitialised
  ) {
    ledgerAccount =
      setAccountOpeningBalance(
        ledgerAccount.id,
        bankAccount.openingBalance
      );
  }

  claimedLedgerAccountIds.add(
    String(ledgerAccount.id)
  );

  return {
    ledgerAccountId:
      ledgerAccount.id,

    ledgerAccountCode:
      ledgerAccount.code,

    ledgerOpeningBalanceInitialised:
      true,

    ledgerLinkedAt:
      bankAccount.ledgerLinkedAt ||
      new Date().toISOString(),
  };
};

const migrateLedgerLinks = (
  accounts
) => {
  const claimedLedgerAccountIds =
    new Set();

  const orderedAccounts = [
    ...accounts,
  ].sort(
    (first, second) =>
      Number(
        second.isDefault
      ) -
      Number(
        first.isDefault
      )
  );

  const linksByBankAccountId =
    new Map();

  orderedAccounts.forEach(
    (bankAccount) => {
      const linkFields =
        ensureLedgerAccountLink(
          bankAccount,
          claimedLedgerAccountIds
        );

      linksByBankAccountId.set(
        String(bankAccount.id),
        linkFields
      );
    }
  );

  let hasChanges = false;

  const migratedAccounts =
    accounts.map(
      (bankAccount) => {
        const linkFields =
          linksByBankAccountId.get(
            String(
              bankAccount.id
            )
          );

        const hasLinkChanged =
          String(
            bankAccount.ledgerAccountId ||
              ""
          ) !==
            String(
              linkFields
                .ledgerAccountId ||
                ""
            ) ||
          String(
            bankAccount.ledgerAccountCode ||
              ""
          ) !==
            String(
              linkFields
                .ledgerAccountCode ||
                ""
            ) ||
          !bankAccount
            .ledgerOpeningBalanceInitialised;

        if (hasLinkChanged) {
          hasChanges = true;
        }

        return {
          ...bankAccount,
          ...linkFields,
        };
      }
    );

  if (hasChanges) {
    saveAccounts(
      migratedAccounts
    );
  }

  return migratedAccounts;
};

const initialiseAccounts = () => {
  const storedAccounts =
    localStorage.getItem(
      STORAGE_KEY
    );

  let accounts;

  if (storedAccounts) {
    try {
      const parsedAccounts =
        JSON.parse(
          storedAccounts
        );

      accounts =
        Array.isArray(
          parsedAccounts
        )
          ? parsedAccounts
          : cloneData(
              DEFAULT_BANK_ACCOUNTS
            );
    } catch (error) {
      console.error(
        "Unable to read bank accounts:",
        error
      );

      accounts =
        cloneData(
          DEFAULT_BANK_ACCOUNTS
        );
    }
  } else {
    accounts =
      cloneData(
        DEFAULT_BANK_ACCOUNTS
      );

    saveAccounts(accounts);
  }

  return migrateLedgerLinks(
    accounts
  );
};

export const getBankAccounts = (
  includeArchived = false
) => {
  const accounts =
    initialiseAccounts();

  if (includeArchived) {
    return accounts;
  }

  return accounts.filter(
    (account) =>
      account.status !==
      "Archived"
  );
};

export const getBankAccountById = (
  accountId
) => {
  return (
    initialiseAccounts().find(
      (account) =>
        String(account.id) ===
        String(accountId)
    ) || null
  );
};

export const getBankLedgerAccount = (
  bankAccountId
) => {
  const bankAccount =
    getBankAccountById(
      bankAccountId
    );

  if (!bankAccount) {
    throw new Error(
      "Bank account not found."
    );
  }

  const ledgerAccount =
    getAccountById(
      bankAccount.ledgerAccountId
    );

  if (!ledgerAccount) {
    throw new Error(
      `${bankAccount.accountName} is not linked to the Chart of Accounts.`
    );
  }

  return ledgerAccount;
};

export const ensureBankAccountLedgerAccount =
  (bankAccountId) => {
    return getBankLedgerAccount(
      bankAccountId
    );
  };

export const createBankAccount = (
  accountData
) => {
  const accounts =
    initialiseAccounts();

  const accountName =
    String(
      accountData.accountName ||
        ""
    ).trim();

  const bankName =
    String(
      accountData.bankName || ""
    ).trim();

  if (!accountName) {
    throw new Error(
      "Enter an account name."
    );
  }

  if (!bankName) {
    throw new Error(
      "Enter a bank name."
    );
  }

  const duplicateName =
    accounts.some(
      (account) =>
        normaliseText(
          account.accountName
        ) ===
        normaliseText(
          accountName
        )
    );

  if (duplicateName) {
    throw new Error(
      "A bank account with this name already exists."
    );
  }

  const openingBalance =
    roundMoney(
      accountData.openingBalance
    );

  const now =
    new Date().toISOString();

  const provisionalAccount = {
    id: createId(),

    accountName,

    bankName,

    accountType:
      accountData.accountType ||
      "Current account",

    accountNumber:
      String(
        accountData.accountNumber ||
          ""
      ).trim(),

    sortCode:
      String(
        accountData.sortCode || ""
      ).trim(),

    currency:
      accountData.currency ||
      "GBP",

    openingBalance,

    currentBalance:
      openingBalance,

    feedStatus:
      accountData.feedStatus ||
      "Manual",

    lastSync:
      accountData.feedStatus ===
      "Connected"
        ? "Just now"
        : "Not connected",

    isDefault:
      Boolean(
        accountData.isDefault
      ),

    status: "Active",

    ledgerAccountId: null,

    ledgerAccountCode: "",

    ledgerOpeningBalanceInitialised:
      false,

    createdAt: now,

    updatedAt: now,
  };

  const claimedLedgerAccountIds =
    new Set(
      accounts
        .map(
          (account) =>
            account.ledgerAccountId
        )
        .filter(Boolean)
        .map(String)
    );

  const ledgerFields =
    ensureLedgerAccountLink(
      provisionalAccount,
      claimedLedgerAccountIds
    );

  const account = {
    ...provisionalAccount,
    ...ledgerFields,
  };

  const existingAccounts =
    account.isDefault
      ? accounts.map(
          (currentAccount) => ({
            ...currentAccount,
            isDefault: false,
            updatedAt: now,
          })
        )
      : accounts;

  saveAccounts([
    account,
    ...existingAccounts,
  ]);

  return account;
};

export const updateBankAccount = (
  accountId,
  changes
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
      "Bank account not found."
    );
  }

  const nextAccountName =
    changes.accountName !==
    undefined
      ? String(
          changes.accountName
        ).trim()
      : existingAccount.accountName;

  if (!nextAccountName) {
    throw new Error(
      "Enter an account name."
    );
  }

  const duplicateName =
    accounts.some(
      (account) =>
        String(account.id) !==
          String(accountId) &&
        normaliseText(
          account.accountName
        ) ===
          normaliseText(
            nextAccountName
          )
    );

  if (duplicateName) {
    throw new Error(
      "A bank account with this name already exists."
    );
  }

  const shouldBecomeDefault =
    changes.isDefault === true;

  const previousOpeningBalance =
    roundMoney(
      existingAccount.openingBalance
    );

  const nextOpeningBalance =
    changes.openingBalance !==
    undefined
      ? roundMoney(
          changes.openingBalance
        )
      : previousOpeningBalance;

  const openingBalanceDifference =
    roundMoney(
      nextOpeningBalance -
        previousOpeningBalance
    );

  const updatedAccounts =
    accounts.map((account) => {
      if (
        shouldBecomeDefault &&
        String(account.id) !==
          String(accountId)
      ) {
        return {
          ...account,
          isDefault: false,
          updatedAt:
            new Date().toISOString(),
        };
      }

      if (
        String(account.id) !==
        String(accountId)
      ) {
        return account;
      }

      return {
        ...account,
        ...changes,

        accountName:
          nextAccountName,

        openingBalance:
          nextOpeningBalance,

        currentBalance:
          changes.currentBalance !==
          undefined
            ? roundMoney(
                changes.currentBalance
              )
            : roundMoney(
                Number(
                  account.currentBalance
                ) +
                  openingBalanceDifference
              ),

        updatedAt:
          new Date().toISOString(),
      };
    });

  const updatedAccount =
    updatedAccounts.find(
      (account) =>
        String(account.id) ===
        String(accountId)
    );

  const ledgerAccount =
    getAccountById(
      updatedAccount.ledgerAccountId
    );

  if (ledgerAccount) {
    if (
      openingBalanceDifference !==
      0
    ) {
      setAccountOpeningBalance(
        ledgerAccount.id,
        nextOpeningBalance
      );
    }

    updateAccount(
      ledgerAccount.id,
      {
        code:
          ledgerAccount.code,

        name:
          updatedAccount.accountName,

        type: "Asset",

        subtype: "Bank",

        description:
          `${updatedAccount.bankName || "Bank"} – ${
            updatedAccount.accountType ||
            "bank account"
          }`,

        taxRate:
          ledgerAccount.taxRate ||
          "No VAT",

        currency:
          updatedAccount.currency ||
          "GBP",

        openingBalance:
          nextOpeningBalance,
      }
    );
  }

  saveAccounts(
    updatedAccounts
  );

  return updatedAccount;
};

export const archiveBankAccount = (
  accountId
) => {
  const account =
    getBankAccountById(
      accountId
    );

  if (!account) {
    throw new Error(
      "Bank account not found."
    );
  }

  if (account.isDefault) {
    throw new Error(
      "The default bank account cannot be archived. Set another account as default first."
    );
  }

  return updateBankAccount(
    accountId,
    {
      status: "Archived",
    }
  );
};

export const restoreBankAccount = (
  accountId
) => {
  return updateBankAccount(
    accountId,
    {
      status: "Active",
    }
  );
};

export const setDefaultBankAccount = (
  accountId
) => {
  return updateBankAccount(
    accountId,
    {
      isDefault: true,
    }
  );
};

export const deleteBankAccount = (
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
      "Bank account not found."
    );
  }

  if (account.isDefault) {
    throw new Error(
      "The default bank account cannot be deleted."
    );
  }

  if (
    Math.abs(
      Number(
        account.currentBalance
      ) || 0
    ) > 0.005
  ) {
    throw new Error(
      "A bank account with a balance cannot be deleted. Archive it instead."
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

  return true;
};