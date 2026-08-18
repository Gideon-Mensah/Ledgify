import {
  getAccounts,
} from "./accountService";

import {
  getJournals,
} from "./journalService";

const POSTED_STATUSES =
  new Set([
    "posted",
    "reversed",
  ]);

const roundMoney = (
  value
) => {
  return (
    Math.round(
      ((Number(value) ||
        0) +
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
      parsedDate.getMonth() +
        1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      parsedDate.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
};

const getAccountNormalBalance =
  (
    account
  ) => {
    const configured =
      normaliseText(
        account?.normalBalance
      );

    if (
      configured ===
      "debit"
    ) {
      return "Debit";
    }

    if (
      configured ===
      "credit"
    ) {
      return "Credit";
    }

    const accountType =
      normaliseText(
        account?.type
      );

    if (
      [
        "asset",
        "expense",
      ].includes(
        accountType
      )
    ) {
      return "Debit";
    }

    return "Credit";
  };

const getBalanceMovement = (
  account,
  debit,
  credit
) => {
  const normalBalance =
    getAccountNormalBalance(
      account
    );

  return normalBalance ===
    "Debit"
    ? roundMoney(
        Number(debit || 0) -
          Number(credit || 0)
      )
    : roundMoney(
        Number(credit || 0) -
          Number(debit || 0)
      );
};

const getBalanceSide = (
  account,
  balance
) => {
  const normalBalance =
    getAccountNormalBalance(
      account
    );

  if (
    Number(balance) >= 0
  ) {
    return normalBalance;
  }

  return normalBalance ===
    "Debit"
    ? "Credit"
    : "Debit";
};

const getJournalStatus =
  (
    journal
  ) => {
    return normaliseText(
      journal?.status
    );
  };

const isPostedJournal =
  (
    journal
  ) => {
    return POSTED_STATUSES.has(
      getJournalStatus(
        journal
      )
    );
  };

const isReversalJournal =
  (
    journal
  ) => {
    return Boolean(
      journal?.reversesJournalId ||
        journal?.reversalOfJournalId ||
        journal?.isReversal
    );
  };

const isOpeningBalanceJournal =
  (
    journal
  ) => {
    const sourceType =
      normaliseText(
        journal?.sourceType ||
          journal?.source ||
          journal?.systemType
      );

    const description =
      normaliseText(
        journal?.description
      );

    const reference =
      normaliseText(
        journal?.reference
      );

    if (
      sourceType.includes(
        "opening balance"
      ) ||
      sourceType.includes(
        "opening balances"
      )
    ) {
      return true;
    }

    if (
      description.includes(
        "opening balance"
      )
    ) {
      return true;
    }

    if (
      reference.startsWith(
        "ob-"
      )
    ) {
      return true;
    }

    return false;
  };

const getAccountsState =
  () => {
    const accounts =
      getAccounts({
        status: "All",
      }) || [];

    const byId =
      new Map();

    const byCode =
      new Map();

    accounts.forEach(
      (
        account
      ) => {
        if (
          account?.id !==
            undefined &&
          account?.id !== null
        ) {
          byId.set(
            String(
              account.id
            ),
            account
          );
        }

        if (
          account?.code !==
            undefined &&
          account?.code !==
            null
        ) {
          byCode.set(
            String(
              account.code
            ),
            account
          );
        }
      }
    );

    return {
      accounts,
      byId,
      byCode,
    };
  };

const resolveLineAccount =
  (
    line,
    accountState
  ) => {
    if (
      line?.accountId !==
        undefined &&
      line?.accountId !==
        null &&
      line.accountId !==
        ""
    ) {
      const matchedById =
        accountState.byId.get(
          String(
            line.accountId
          )
        );

      if (
        matchedById
      ) {
        return matchedById;
      }
    }

    const accountCode =
      line?.accountCode ||
      line?.code;

    if (
      accountCode !==
        undefined &&
      accountCode !==
        null &&
      accountCode !==
        ""
    ) {
      const matchedByCode =
        accountState.byCode.get(
          String(
            accountCode
          )
        );

      if (
        matchedByCode
      ) {
        return matchedByCode;
      }
    }

    return null;
  };

const getOpeningBalanceJournalAccounts =
  (
    journals,
    accountState
  ) => {
    const representedAccounts =
      new Set();

    journals
      .filter(
        (
          journal
        ) =>
          isPostedJournal(
            journal
          ) &&
          isOpeningBalanceJournal(
            journal
          )
      )
      .forEach(
        (
          journal
        ) => {
          const lines =
            Array.isArray(
              journal.lines
            )
              ? journal.lines
              : [];

          lines.forEach(
            (
              line
            ) => {
              const account =
                resolveLineAccount(
                  line,
                  accountState
                );

              if (
                !account
              ) {
                return;
              }

              representedAccounts.add(
                String(
                  account.id
                )
              );
            }
          );
        }
      );

    return representedAccounts;
  };

const getInitialAccountBalance =
  (
    account,
    openingBalanceJournalAccounts
  ) => {
    /*
    |--------------------------------------------------------------------------
    | Prevent opening balance double-counting
    |--------------------------------------------------------------------------
    |
    | Some accounts have a stored openingBalance property.
    |
    | Ledgify's Opening Balances feature also creates a real system journal.
    | When that journal exists for an account, the journal itself must create
    | the ledger balance. Starting the ledger with account.openingBalance as
    | well would count the same opening position twice.
    |
    | Accounts without an Opening Balance journal still use their configured
    | account.openingBalance. This preserves compatibility with bank accounts
    | and older Ledgify data.
    |
    */

    if (
      openingBalanceJournalAccounts.has(
        String(
          account.id
        )
      )
    ) {
      return 0;
    }

    return roundMoney(
      account.openingBalance
    );
  };

const compareLedgerEntriesAscending =
  (
    first,
    second
  ) => {
    const dateDifference =
      String(
        first.date || ""
      ).localeCompare(
        String(
          second.date || ""
        )
      );

    if (
      dateDifference !== 0
    ) {
      return dateDifference;
    }

    const createdDifference =
      String(
        first.journalCreatedAt ||
          ""
      ).localeCompare(
        String(
          second.journalCreatedAt ||
            ""
        )
      );

    if (
      createdDifference !==
      0
    ) {
      return createdDifference;
    }

    const journalDifference =
      String(
        first.journalNumber ||
          ""
      ).localeCompare(
        String(
          second.journalNumber ||
            ""
        ),
        undefined,
        {
          numeric: true,
        }
      );

    if (
      journalDifference !==
      0
    ) {
      return journalDifference;
    }

    if (
      first.lineIndex !==
      second.lineIndex
    ) {
      return (
        first.lineIndex -
        second.lineIndex
      );
    }

    return String(
      first.id
    ).localeCompare(
      String(
        second.id
      )
    );
  };

const compareLedgerEntriesDescending =
  (
    first,
    second
  ) => {
    return compareLedgerEntriesAscending(
      second,
      first
    );
  };

const buildLedgerEntries =
  () => {
    const accountState =
      getAccountsState();

    const {
      accounts,
    } = accountState;

    const journals =
      (
        getJournals({
          status: "All",
        }) || []
      ).filter(
        isPostedJournal
      );

    const openingBalanceJournalAccounts =
      getOpeningBalanceJournalAccounts(
        journals,
        accountState
      );

    const entries = [];

    journals.forEach(
      (
        journal,
        journalIndex
      ) => {
        const journalDate =
          normaliseDate(
            journal.date ||
              journal.journalDate
          );

        /*
        |--------------------------------------------------------------------------
        | Invalid journal dates
        |--------------------------------------------------------------------------
        |
        | A journal without a valid accounting date cannot be placed correctly
        | in the ledger and therefore should not contribute to running
        | balances.
        |
        */

        if (
          !journalDate
        ) {
          return;
        }

        const lines =
          Array.isArray(
            journal.lines
          )
            ? journal.lines
            : [];

        lines.forEach(
          (
            line,
            lineIndex
          ) => {
            const account =
              resolveLineAccount(
                line,
                accountState
              );

            /*
            |--------------------------------------------------------------------------
            | Orphaned journal line
            |--------------------------------------------------------------------------
            |
            | Do not invent an account when the referenced Chart of Accounts
            | record no longer exists.
            |
            */

            if (
              !account
            ) {
              return;
            }

            const debit =
              roundMoney(
                line.debit
              );

            const credit =
              roundMoney(
                line.credit
              );

            /*
            |--------------------------------------------------------------------------
            | Zero-value lines
            |--------------------------------------------------------------------------
            */

            if (
              debit === 0 &&
              credit === 0
            ) {
              return;
            }

            const sourceType =
              journal.sourceType ||
              journal.source ||
              journal.systemType ||
              (
                journal.isSystem
                  ? "System journal"
                  : "Manual journal"
              );

            entries.push({
              id:
                line.id
                  ? `${journal.id}-${line.id}`
                  : `${journal.id}-line-${lineIndex}-${journalIndex}`,

              lineId:
                line.id ||
                null,

              journalId:
                journal.id,

              journalNumber:
                journal.journalNumber ||
                journal.number ||
                journal.reference ||
                "",

              journalStatus:
                journal.status,

              journalCreatedAt:
                journal.createdAt ||
                journal.postedAt ||
                "",

              isSystem:
                Boolean(
                  journal.isSystem ||
                    journal.sourceType ||
                    journal.systemType
                ),

              isReversal:
                isReversalJournal(
                  journal
                ),

              reversesJournalId:
                journal.reversesJournalId ||
                journal.reversalOfJournalId ||
                null,

              reversedByJournalId:
                journal.reversedByJournalId ||
                null,

              isOpeningBalance:
                isOpeningBalanceJournal(
                  journal
                ),

              date:
                journalDate,

              reference:
                journal.reference ||
                "",

              journalDescription:
                journal.description ||
                "",

              sourceType,

              sourceId:
                journal.sourceId ||
                null,

              sourceNumber:
                journal.sourceNumber ||
                journal.reference ||
                "",

              lineDescription:
                line.description ||
                journal.description ||
                "",

              accountId:
                account.id,

              accountCode:
                account.code,

              accountName:
                account.name,

              accountType:
                account.type,

              accountSubtype:
                account.subtype ||
                "",

              accountStatus:
                account.status,

              normalBalance:
                getAccountNormalBalance(
                  account
                ),

              currency:
                account.currency ||
                "GBP",

              debit,

              credit,

              lineIndex,
            });
          }
        );
      }
    );

    entries.sort(
      compareLedgerEntriesAscending
    );

    /*
    |--------------------------------------------------------------------------
    | True chronological running balances
    |--------------------------------------------------------------------------
    |
    | Running balances are calculated across the complete ledger BEFORE any
    | report filters are applied.
    |
    | This is critical. A report filtered to July must still know the account
    | balance brought forward from all activity before July.
    |
    */

    const runningBalances =
      new Map();

    accounts.forEach(
      (
        account
      ) => {
        runningBalances.set(
          String(
            account.id
          ),
          getInitialAccountBalance(
            account,
            openingBalanceJournalAccounts
          )
        );
      }
    );

    return entries.map(
      (
        entry
      ) => {
        const account =
          accountState.byId.get(
            String(
              entry.accountId
            )
          ) ||
          accountState.byCode.get(
            String(
              entry.accountCode
            )
          );

        if (
          !account
        ) {
          return entry;
        }

        const previousBalance =
          roundMoney(
            runningBalances.get(
              String(
                account.id
              )
            ) || 0
          );

        const movement =
          getBalanceMovement(
            account,
            entry.debit,
            entry.credit
          );

        const runningBalance =
          roundMoney(
            previousBalance +
              movement
          );

        runningBalances.set(
          String(
            account.id
          ),
          runningBalance
        );

        return {
          ...entry,

          previousBalance,

          movement,

          runningBalance,

          balanceSide:
            getBalanceSide(
              account,
              runningBalance
            ),

          runningBalanceAbsolute:
            roundMoney(
              Math.abs(
                runningBalance
              )
            ),
        };
      }
    );
  };

const matchesAccountFilter =
  (
    entry,
    accountId
  ) => {
    if (
      !accountId ||
      accountId ===
        "All"
    ) {
      return true;
    }

    return (
      String(
        entry.accountId
      ) ===
        String(
          accountId
        ) ||
      String(
        entry.accountCode
      ) ===
        String(
          accountId
        )
    );
  };

const matchesSearchFilter =
  (
    entry,
    searchValue
  ) => {
    if (
      !searchValue
    ) {
      return true;
    }

    return [
      entry.journalNumber,
      entry.reference,
      entry.journalDescription,
      entry.lineDescription,
      entry.accountCode,
      entry.accountName,
      entry.accountType,
      entry.accountSubtype,
      entry.sourceType,
      entry.sourceNumber,
      entry.journalStatus,
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

export const getGeneralLedger = ({
  search = "",
  accountId = "All",
  dateFrom = "",
  dateTo = "",
} = {}) => {
  const searchValue =
    normaliseText(
      search
    );

  const resolvedDateFrom =
    normaliseDate(
      dateFrom
    );

  const resolvedDateTo =
    normaliseDate(
      dateTo
    );

  if (
    dateFrom &&
    !resolvedDateFrom
  ) {
    throw new Error(
      "The ledger From date is invalid."
    );
  }

  if (
    dateTo &&
    !resolvedDateTo
  ) {
    throw new Error(
      "The ledger To date is invalid."
    );
  }

  if (
    resolvedDateFrom &&
    resolvedDateTo &&
    resolvedDateFrom >
      resolvedDateTo
  ) {
    throw new Error(
      "The ledger From date cannot be later than the To date."
    );
  }

  return buildLedgerEntries()
    .filter(
      (
        entry
      ) => {
        const matchesSearch =
          matchesSearchFilter(
            entry,
            searchValue
          );

        const matchesAccount =
          matchesAccountFilter(
            entry,
            accountId
          );

        const matchesDateFrom =
          !resolvedDateFrom ||
          entry.date >=
            resolvedDateFrom;

        const matchesDateTo =
          !resolvedDateTo ||
          entry.date <=
            resolvedDateTo;

        return (
          matchesSearch &&
          matchesAccount &&
          matchesDateFrom &&
          matchesDateTo
        );
      }
    )
    .sort(
      compareLedgerEntriesDescending
    );
};

export const getGeneralLedgerSummary =
  (
    filters = {}
  ) => {
    const entries =
      getGeneralLedger(
        filters
      );

    const totalDebit =
      roundMoney(
        entries.reduce(
          (
            total,
            entry
          ) =>
            total +
            Number(
              entry.debit ||
                0
            ),
          0
        )
      );

    const totalCredit =
      roundMoney(
        entries.reduce(
          (
            total,
            entry
          ) =>
            total +
            Number(
              entry.credit ||
                0
            ),
          0
        )
      );

    const accountIds =
      new Set(
        entries.map(
          (
            entry
          ) =>
            String(
              entry.accountId ||
                entry.accountCode
            )
        )
      );

    const journalIds =
      new Set(
        entries.map(
          (
            entry
          ) =>
            String(
              entry.journalId
            )
        )
      );

    return {
      entries:
        entries.length,

      totalDebit,

      totalCredit,

      difference:
        roundMoney(
          totalDebit -
            totalCredit
        ),

      isBalanced:
        Math.abs(
          roundMoney(
            totalDebit -
              totalCredit
          )
        ) < 0.01,

      accounts:
        accountIds.size,

      journals:
        journalIds.size,

      reversalEntries:
        entries.filter(
          (
            entry
          ) =>
            entry.isReversal
        ).length,

      openingBalanceEntries:
        entries.filter(
          (
            entry
          ) =>
            entry.isOpeningBalance
        ).length,

      systemEntries:
        entries.filter(
          (
            entry
          ) =>
            entry.isSystem
        ).length,
    };
  };