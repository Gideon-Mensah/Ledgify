import {
  getAccounts,
} from "./accountService";

import {
  createSystemJournal,
  getJournals,
  reverseJournal,
  rollbackSystemJournal,
} from "./journalService";

import {
  getCurrentFinancialYear,
  getFinancialYearForDate,
  getFinancialYearOptions,
  getFinancialYearRange,
} from "./financialYearService";

import {
  assertDateIsOpen,
  PERIOD_LOCK_AREAS,
} from "./periodLockService";

const STORAGE_KEY =
  "ledgify_year_end_closes";

const RETAINED_EARNINGS_CODE =
  "610";

const YEAR_END_SOURCE_TYPE =
  "Year-end close";

const YEAR_END_STATUS = {
  OPEN: "Open",
  CLOSED: "Closed",
};

const createId = () => {
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

const cloneData = (
  value
) => {
  return JSON.parse(
    JSON.stringify(value)
  );
};

const roundMoney = (
  value
) => {
  return Math.round(
    (Number(value) +
      Number.EPSILON) *
      100
  ) / 100;
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

const getToday = () => {
  const today =
    new Date();

  const year =
    today.getFullYear();

  const month =
    String(
      today.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      today.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
};

const readYearEndCloses =
  () => {
    const storedValue =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (!storedValue) {
      return [];
    }

    try {
      const parsedValue =
        JSON.parse(
          storedValue
        );

      return Array.isArray(
        parsedValue
      )
        ? parsedValue
        : [];
    } catch (
      error
    ) {
      console.error(
        "Unable to read year-end closes:",
        error
      );

      return [];
    }
  };

const writeYearEndCloses =
  (
    closes
  ) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        closes
      )
    );

    return cloneData(
      closes
    );
  };

const validateFinancialYearEndYear =
  (
    year
  ) => {
    if (
      year === undefined ||
      year === null ||
      year === ""
    ) {
      const current =
        getCurrentFinancialYear();

      return Number(
        current.endYear
      );
    }

    const resolvedYear =
      Number(year);

    if (
      !Number.isInteger(
        resolvedYear
      ) ||
      resolvedYear < 1900 ||
      resolvedYear > 9999
    ) {
      throw new Error(
        "A valid financial year is required."
      );
    }

    return resolvedYear;
  };

const getFinancialYearDefinition =
  (
    year
  ) => {
    const resolvedYear =
      validateFinancialYearEndYear(
        year
      );

    const financialYear =
      getFinancialYearRange(
        resolvedYear
      );

    if (
      !financialYear ||
      !financialYear.startDate ||
      !financialYear.endDate
    ) {
      throw new Error(
        "The financial year could not be determined."
      );
    }

    return {
      ...financialYear,

      endYear:
        Number(
          financialYear.endYear ||
            resolvedYear
        ),
    };
  };

const financialYearHasEnded =
  (
    financialYear
  ) => {
    return (
      normaliseDate(
        financialYear.endDate
      ) <= getToday()
    );
  };

const normaliseCloseRecord =
  (
    record
  ) => {
    if (!record) {
      return null;
    }

    const resolvedYear =
      Number(
        record.financialYearEndYear ||
          record.year
      );

    /*
    |--------------------------------------------------------------------------
    | Modern financial-year close
    |--------------------------------------------------------------------------
    */

    if (
      record.financialYearStartDate &&
      record.financialYearEndDate
    ) {
      return {
        ...record,

        year:
          String(
            resolvedYear
          ),

        financialYearEndYear:
          resolvedYear,

        financialYearLabel:
          record.financialYearLabel ||
          String(
            resolvedYear
          ),

        financialYearStartDate:
          normaliseDate(
            record.financialYearStartDate
          ),

        financialYearEndDate:
          normaliseDate(
            record.financialYearEndDate
          ),

        financialYearKey:
          record.financialYearKey ||
          `${normaliseDate(
            record.financialYearStartDate
          )}:${normaliseDate(
            record.financialYearEndDate
          )}`,

        financialYearBasis:
          record.financialYearBasis ||
          "configured-financial-year",

        closeSequence:
          Number(
            record.closeSequence
          ) || 1,

        history:
          Array.isArray(
            record.history
          )
            ? record.history
            : [],

        closePeriodLockOverrideUsed:
          Boolean(
            record.closePeriodLockOverrideUsed ??
              record.periodLockOverrideUsed
          ),

        reopenPeriodLockOverrideUsed:
          Boolean(
            record.reopenPeriodLockOverrideUsed
          ),
      };
    }

    /*
    |--------------------------------------------------------------------------
    | Legacy year-end close
    |--------------------------------------------------------------------------
    |
    | Older Ledgify versions used calendar years only. We preserve the
    | original 1 January to 31 December meaning rather than silently
    | reinterpreting that old close after a user changes financial year
    | settings.
    |
    */

    if (
      Number.isInteger(
        resolvedYear
      )
    ) {
      const startDate =
        `${resolvedYear}-01-01`;

      const endDate =
        `${resolvedYear}-12-31`;

      return {
        ...record,

        year:
          String(
            resolvedYear
          ),

        financialYearEndYear:
          resolvedYear,

        financialYearLabel:
          record.financialYearLabel ||
          String(
            resolvedYear
          ),

        financialYearStartDate:
          startDate,

        financialYearEndDate:
          endDate,

        financialYearKey:
          `${startDate}:${endDate}`,

        financialYearBasis:
          "legacy-calendar-year",

        closeSequence:
          Number(
            record.closeSequence
          ) || 1,

        history:
          Array.isArray(
            record.history
          )
            ? record.history
            : [],

        closePeriodLockOverrideUsed:
          Boolean(
            record.closePeriodLockOverrideUsed ??
              record.periodLockOverrideUsed
          ),

        reopenPeriodLockOverrideUsed:
          Boolean(
            record.reopenPeriodLockOverrideUsed
          ),
      };
    }

    return {
      ...record,

      history:
        Array.isArray(
          record.history
        )
          ? record.history
          : [],
    };
  };

const isDateInsideRange = (
  date,
  startDate,
  endDate
) => {
  const resolvedDate =
    normaliseDate(
      date
    );

  if (
    !resolvedDate ||
    !startDate ||
    !endDate
  ) {
    return false;
  }

  return (
    resolvedDate >=
      startDate &&
    resolvedDate <=
      endDate
  );
};

const isPostedJournal = (
  journal
) => {
  const status =
    String(
      journal?.status ||
        ""
    ).toLowerCase();

  /*
  |--------------------------------------------------------------------------
  | Include Posted and Reversed originals
  |--------------------------------------------------------------------------
  |
  | A reversed journal may still represent valid historical activity in the
  | period in which it was originally posted. Its separate reversal journal
  | offsets it on the reversal date.
  |
  */

  return (
    status === "posted" ||
    status === "reversed"
  );
};

const isYearEndJournal = (
  journal
) => {
  const sourceType =
    String(
      journal?.sourceType ||
        journal?.source ||
        journal?.systemType ||
        ""
    ).toLowerCase();

  const description =
    String(
      journal?.description ||
        ""
    ).toLowerCase();

  const reference =
    String(
      journal?.reference ||
        ""
    ).toLowerCase();

  if (
    sourceType.includes(
      "year-end"
    ) ||
    sourceType.includes(
      "year end"
    )
  ) {
    return true;
  }

  if (
    description.includes(
      "year-end close"
    ) ||
    description.includes(
      "year end close"
    ) ||
    description.includes(
      "financial year was reopened"
    ) ||
    description.includes(
      "financial year reopened"
    )
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | The YE- reference is only used as a fallback
  |--------------------------------------------------------------------------
  */

  if (
    reference.startsWith(
      "ye-"
    ) &&
    (
      journal?.isSystem ||
      sourceType
    )
  ) {
    return true;
  }

  return false;
};

const getAccountLookup =
  () => {
    const accounts =
      getAccounts();

    const byId =
      new Map();

    const byCode =
      new Map();

    accounts.forEach(
      (
        account
      ) => {
        if (
          account.id !==
            undefined &&
          account.id !== null
        ) {
          byId.set(
            String(
              account.id
            ),
            account
          );
        }

        if (
          account.code !==
            undefined &&
          account.code !== null
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

const resolveJournalLineAccount =
  (
    line,
    lookup
  ) => {
    if (
      line?.accountId !==
        undefined &&
      line?.accountId !==
        null
    ) {
      const byId =
        lookup.byId.get(
          String(
            line.accountId
          )
        );

      if (byId) {
        return byId;
      }
    }

    const accountCode =
      line?.accountCode ||
      line?.code;

    if (
      accountCode !==
        undefined &&
      accountCode !==
        null
    ) {
      return (
        lookup.byCode.get(
          String(
            accountCode
          )
        ) ||
        null
      );
    }

    return null;
  };

const getAccountCategory =
  (
    account
  ) => {
    const type =
      String(
        account?.type ||
          ""
      )
        .trim()
        .toLowerCase();

    const subtype =
      String(
        account?.subtype ||
          ""
      )
        .trim()
        .toLowerCase();

    const combined =
      `${type} ${subtype}`;

    if (
      combined.includes(
        "revenue"
      ) ||
      combined.includes(
        "income"
      ) ||
      combined.includes(
        "sales"
      )
    ) {
      return "revenue";
    }

    if (
      combined.includes(
        "expense"
      ) ||
      combined.includes(
        "cost of sales"
      ) ||
      combined.includes(
        "cost of goods"
      ) ||
      combined.includes(
        "cost of revenue"
      )
    ) {
      return "expense";
    }

    return "";
  };

const createFinancialYearKey =
  (
    financialYear
  ) => {
    return `${financialYear.startDate}:${financialYear.endDate}`;
  };

export const calculateFinancialYear =
  (
    year
  ) => {
    const financialYear =
      getFinancialYearDefinition(
        year
      );

    const journals =
      getJournals();

    const lookup =
      getAccountLookup();

    const balances =
      new Map();

    journals
      .filter(
        (
          journal
        ) => {
          if (
            !isPostedJournal(
              journal
            )
          ) {
            return false;
          }

          if (
            isYearEndJournal(
              journal
            )
          ) {
            return false;
          }

          return isDateInsideRange(
            journal.date ||
              journal.journalDate,
            financialYear.startDate,
            financialYear.endDate
          );
        }
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
                resolveJournalLineAccount(
                  line,
                  lookup
                );

              if (!account) {
                return;
              }

              const category =
                getAccountCategory(
                  account
                );

              if (
                category !==
                  "revenue" &&
                category !==
                  "expense"
              ) {
                return;
              }

              const key =
                String(
                  account.id ??
                    account.code
                );

              const existing =
                balances.get(
                  key
                ) || {
                  account,

                  debit:
                    0,

                  credit:
                    0,
                };

              existing.debit =
                roundMoney(
                  existing.debit +
                    Number(
                      line.debit
                    )
                );

              existing.credit =
                roundMoney(
                  existing.credit +
                    Number(
                      line.credit
                    )
                );

              balances.set(
                key,
                existing
              );
            }
          );
        }
      );

    const accountRows =
      Array.from(
        balances.values()
      )
        .map(
          (
            item
          ) => {
            const {
              account,
              debit,
              credit,
            } = item;

            const category =
              getAccountCategory(
                account
              );

            /*
            |--------------------------------------------------------------------------
            | Normal presentation balance
            |--------------------------------------------------------------------------
            |
            | Revenue normally has a credit balance.
            | Expenses normally have a debit balance.
            |
            */

            const amount =
              category ===
              "revenue"
                ? roundMoney(
                    credit -
                      debit
                  )
                : roundMoney(
                    debit -
                      credit
                  );

            let closingDebit =
              0;

            let closingCredit =
              0;

            if (
              category ===
              "revenue"
            ) {
              if (
                amount > 0
              ) {
                closingDebit =
                  amount;
              } else if (
                amount < 0
              ) {
                closingCredit =
                  Math.abs(
                    amount
                  );
              }
            }

            if (
              category ===
              "expense"
            ) {
              if (
                amount > 0
              ) {
                closingCredit =
                  amount;
              } else if (
                amount < 0
              ) {
                closingDebit =
                  Math.abs(
                    amount
                  );
              }
            }

            return {
              accountId:
                account.id,

              code:
                account.code,

              name:
                account.name,

              type:
                account.type,

              subtype:
                account.subtype,

              category,

              debit:
                roundMoney(
                  debit
                ),

              credit:
                roundMoney(
                  credit
                ),

              amount:
                roundMoney(
                  amount
                ),

              closingDebit:
                roundMoney(
                  closingDebit
                ),

              closingCredit:
                roundMoney(
                  closingCredit
                ),
            };
          }
        )
        .filter(
          (
            row
          ) =>
            Math.abs(
              Number(
                row.amount
              )
            ) >= 0.005
        )
        .sort(
          (
            first,
            second
          ) =>
            String(
              first.code ||
                ""
            ).localeCompare(
              String(
                second.code ||
                  ""
              ),
              undefined,
              {
                numeric: true,
              }
            )
        );

    const totalRevenue =
      roundMoney(
        accountRows
          .filter(
            (
              row
            ) =>
              row.category ===
              "revenue"
          )
          .reduce(
            (
              total,
              row
            ) =>
              total +
              Number(
                row.amount
              ),
            0
          )
      );

    const totalExpenses =
      roundMoney(
        accountRows
          .filter(
            (
              row
            ) =>
              row.category ===
              "expense"
          )
          .reduce(
            (
              total,
              row
            ) =>
              total +
              Number(
                row.amount
              ),
            0
          )
      );

    const netProfit =
      roundMoney(
        totalRevenue -
          totalExpenses
      );

    return {
      year:
        String(
          financialYear.endYear
        ),

      financialYearEndYear:
        financialYear.endYear,

      financialYearLabel:
        financialYear.label,

      financialYearStartDate:
        financialYear.startDate,

      financialYearEndDate:
        financialYear.endDate,

      financialYearKey:
        createFinancialYearKey(
          financialYear
        ),

      totalRevenue,

      totalExpenses,

      netProfit,

      hasActivity:
        accountRows.length >
        0,

      accountRows,
    };
  };

export const getYearEndCloses =
  () => {
    return readYearEndCloses()
      .map(
        normaliseCloseRecord
      )
      .filter(Boolean)
      .sort(
        (
          first,
          second
        ) =>
          String(
            second.financialYearEndDate ||
              ""
          ).localeCompare(
            String(
              first.financialYearEndDate ||
                ""
            )
          )
      );
  };

export const getYearEndCloseById =
  (
    closeId
  ) => {
    return (
      getYearEndCloses().find(
        (
          record
        ) =>
          String(
            record.id
          ) ===
          String(
            closeId
          )
      ) ||
      null
    );
  };

export const getYearEndCloseByYear =
  (
    year
  ) => {
    const financialYear =
      getFinancialYearDefinition(
        year
      );

    return (
      getYearEndCloses().find(
        (
          record
        ) =>
          record.financialYearStartDate ===
            financialYear.startDate &&
          record.financialYearEndDate ===
            financialYear.endDate
      ) ||
      null
    );
  };

export const getFinancialYears =
  () => {
    const years =
      new Set();

    const currentFinancialYear =
      getCurrentFinancialYear();

    years.add(
      Number(
        currentFinancialYear.endYear
      )
    );

    /*
    |--------------------------------------------------------------------------
    | Configured nearby financial years
    |--------------------------------------------------------------------------
    */

    try {
      const options =
        getFinancialYearOptions({
          previousYears: 6,
          futureYears: 2,
        });

      options.forEach(
        (
          option
        ) => {
          const value =
            Number(
              option.endYear ??
                option.value
            );

          if (
            Number.isInteger(
              value
            )
          ) {
            years.add(
              value
            );
          }
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Unable to load financial year options:",
        error
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Financial years represented by journals
    |--------------------------------------------------------------------------
    */

    try {
      getJournals().forEach(
        (
          journal
        ) => {
          const date =
            normaliseDate(
              journal.date ||
                journal.journalDate
            );

          if (!date) {
            return;
          }

          try {
            const financialYear =
              getFinancialYearForDate(
                date
              );

            const endYear =
              Number(
                financialYear.endYear
              );

            if (
              Number.isInteger(
                endYear
              )
            ) {
              years.add(
                endYear
              );
            }
          } catch {
            // Ignore journals whose financial year cannot be resolved.
          }
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Unable to derive financial years from journals:",
        error
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Previously saved closes
    |--------------------------------------------------------------------------
    */

    getYearEndCloses().forEach(
      (
        record
      ) => {
        const endYear =
          Number(
            record.financialYearEndYear ||
              record.year
          );

        if (
          Number.isInteger(
            endYear
          )
        ) {
          years.add(
            endYear
          );
        }
      }
    );

    return Array.from(
      years
    )
      .filter(
        (
          year
        ) =>
          Number.isInteger(
            year
          )
      )
      .sort(
        (
          first,
          second
        ) =>
          second - first
      )
      .map(String);
  };

export const getYearEndSummary =
  (
    year
  ) => {
    const financialYear =
      getFinancialYearDefinition(
        year
      );

    const calculation =
      calculateFinancialYear(
        financialYear.endYear
      );

    const closeRecord =
      getYearEndCloseByYear(
        financialYear.endYear
      );

    const status =
      closeRecord?.status ===
      YEAR_END_STATUS.CLOSED
        ? YEAR_END_STATUS.CLOSED
        : YEAR_END_STATUS.OPEN;

    return {
      ...calculation,

      year:
        String(
          financialYear.endYear
        ),

      financialYearEndYear:
        financialYear.endYear,

      financialYearLabel:
        financialYear.label,

      financialYearStartDate:
        financialYear.startDate,

      financialYearEndDate:
        financialYear.endDate,

      startDate:
        financialYear.startDate,

      endDate:
        financialYear.endDate,

      yearHasEnded:
        financialYearHasEnded(
          financialYear
        ),

      status,

      closeRecord,
    };
  };

export const closeFinancialYear =
  (
    year,
    options = {}
  ) => {
    const resolvedYear =
      validateFinancialYearEndYear(
        year
      );

    const financialYear =
      getFinancialYearDefinition(
        resolvedYear
      );

    if (
      !financialYearHasEnded(
        financialYear
      )
    ) {
      throw new Error(
        `Financial year ${financialYear.label} cannot be closed until ${financialYear.endDate}.`
      );
    }

    const calculation =
      calculateFinancialYear(
        resolvedYear
      );

    if (
      !calculation.hasActivity
    ) {
      throw new Error(
        `There is no income or expense activity to close for financial year ${financialYear.label}.`
      );
    }

    const existingClose =
      getYearEndCloseByYear(
        resolvedYear
      );

    if (
      existingClose?.status ===
      YEAR_END_STATUS.CLOSED
    ) {
      throw new Error(
        `Financial year ${financialYear.label} is already closed.`
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Global accounting period lock
    |--------------------------------------------------------------------------
    |
    | Year-end close is a system accounting process, therefore it is governed
    | by the GLOBAL accounting lock rather than the manual-journals lock.
    |
    */

    const closeLockStatus =
      assertDateIsOpen(
        financialYear.endDate,
        PERIOD_LOCK_AREAS.GLOBAL,
        {
          allowOverride:
            Boolean(
              options.allowPeriodLockOverride
            ),

          action:
            `close financial year ${financialYear.label}`,
        }
      );

    const accounts =
      getAccounts();

    const retainedEarningsAccount =
      accounts.find(
        (
          account
        ) =>
          String(
            account.code
          ) ===
          RETAINED_EARNINGS_CODE
      );

    if (
      !retainedEarningsAccount
    ) {
      throw new Error(
        `Retained Earnings account ${RETAINED_EARNINGS_CODE} could not be found.`
      );
    }

    const closingLines =
      calculation.accountRows.map(
        (
          row
        ) => ({
          accountId:
            row.accountId,

          accountCode:
            row.code,

          accountName:
            row.name,

          description:
            `Close ${row.name} for ${financialYear.label}`,

          debit:
            roundMoney(
              row.closingDebit
            ),

          credit:
            roundMoney(
              row.closingCredit
            ),
        })
      );

    /*
    |--------------------------------------------------------------------------
    | Transfer profit/loss to retained earnings
    |--------------------------------------------------------------------------
    */

    if (
      calculation.netProfit >
      0
    ) {
      closingLines.push({
        accountId:
          retainedEarningsAccount.id,

        accountCode:
          retainedEarningsAccount.code,

        accountName:
          retainedEarningsAccount.name,

        description:
          `Transfer profit for ${financialYear.label} to retained earnings`,

        debit: 0,

        credit:
          roundMoney(
            calculation.netProfit
          ),
      });
    } else if (
      calculation.netProfit <
      0
    ) {
      closingLines.push({
        accountId:
          retainedEarningsAccount.id,

        accountCode:
          retainedEarningsAccount.code,

        accountName:
          retainedEarningsAccount.name,

        description:
          `Transfer loss for ${financialYear.label} to retained earnings`,

        debit:
          roundMoney(
            Math.abs(
              calculation.netProfit
            )
          ),

        credit: 0,
      });
    }

    const validClosingLines =
      closingLines.filter(
        (
          line
        ) =>
          Number(
            line.debit
          ) >
            0 ||
          Number(
            line.credit
          ) >
            0
      );

    if (
      validClosingLines.length <
      2
    ) {
      throw new Error(
        `There are not enough balances to create the year-end closing journal for ${financialYear.label}.`
      );
    }

    const now =
      new Date().toISOString();

    const recordId =
      existingClose?.id ||
      createId();

    const closeSequence =
      (
        Number(
          existingClose?.closeSequence
        ) || 0
      ) + 1;

    const sourceId =
      `${recordId}:close:${closeSequence}`;

    const reference =
      `YE-${String(
        financialYear.label
      ).replaceAll(
        "/",
        "-"
      )}`;

    let closingJournal =
      null;

    try {
      closingJournal =
        createSystemJournal({
          date:
            financialYear.endDate,

          reference,

          description:
            `Year-end close for financial year ${financialYear.label}`,

          sourceType:
            YEAR_END_SOURCE_TYPE,

          sourceId,

          lines:
            validClosingLines,
        });

      const history =
        Array.isArray(
          existingClose?.history
        )
          ? [
              ...existingClose.history,
            ]
          : [];

      history.push({
        id: createId(),

        action:
          "Closed",

        date:
          now,

        journalId:
          closingJournal.id,

        journalDate:
          financialYear.endDate,

        reference:
          closingJournal.reference ||
          reference,

        description:
          `Financial year ${financialYear.label} was closed.`,

        periodLockOverrideUsed:
          Boolean(
            closeLockStatus.isOverridden
          ),
      });

      const closeRecord = {
        ...(existingClose ||
          {}),

        id:
          recordId,

        year:
          String(
            resolvedYear
          ),

        financialYearEndYear:
          resolvedYear,

        financialYearLabel:
          financialYear.label,

        financialYearStartDate:
          financialYear.startDate,

        financialYearEndDate:
          financialYear.endDate,

        financialYearKey:
          createFinancialYearKey(
            financialYear
          ),

        financialYearBasis:
          "configured-financial-year",

        closeSequence,

        status:
          YEAR_END_STATUS.CLOSED,

        journalId:
          closingJournal.id,

        reference:
          closingJournal.reference ||
          reference,

        totalRevenue:
          calculation.totalRevenue,

        totalExpenses:
          calculation.totalExpenses,

        netProfit:
          calculation.netProfit,

        retainedEarningsAccountId:
          retainedEarningsAccount.id,

        retainedEarningsAccountCode:
          retainedEarningsAccount.code,

        retainedEarningsAccountName:
          retainedEarningsAccount.name,

        closedAt:
          now,

        reopenedAt:
          null,

        latestReopenReason:
          "",

        latestReversalDate:
          "",

        reversalJournalId:
          null,

        closePeriodLockOverrideUsed:
          Boolean(
            closeLockStatus.isOverridden
          ),

        /*
        |--------------------------------------------------------------------------
        | Legacy compatibility field
        |--------------------------------------------------------------------------
        */

        periodLockOverrideUsed:
          Boolean(
            closeLockStatus.isOverridden
          ),

        snapshot:
          cloneData(
            calculation
          ),

        history,
      };

      const storedCloses =
        readYearEndCloses();

      const existingIndex =
        storedCloses.findIndex(
          (
            record
          ) =>
            String(
              record.id
            ) ===
            String(
              recordId
            )
        );

      if (
        existingIndex >= 0
      ) {
        storedCloses[
          existingIndex
        ] =
          closeRecord;
      } else {
        storedCloses.push(
          closeRecord
        );
      }

      writeYearEndCloses(
        storedCloses
      );

      return cloneData(
        closeRecord
      );
    } catch (
      error
    ) {
      /*
      |--------------------------------------------------------------------------
      | Roll back journal if persistence fails
      |--------------------------------------------------------------------------
      */

      if (
        closingJournal?.id
      ) {
        try {
          rollbackSystemJournal(
            closingJournal.id
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "Unable to roll back year-end closing journal:",
            rollbackError
          );
        }
      }

      throw error;
    }
  };

export const reopenFinancialYear =
  (
    year,
    reason = "",
    options = {}
  ) => {
    const resolvedYear =
      validateFinancialYearEndYear(
        year
      );

    const financialYear =
      getFinancialYearDefinition(
        resolvedYear
      );

    const closeRecord =
      getYearEndCloseByYear(
        resolvedYear
      );

    if (
      !closeRecord
    ) {
      throw new Error(
        `Financial year ${financialYear.label} has not been closed.`
      );
    }

    if (
      closeRecord.status !==
      YEAR_END_STATUS.CLOSED
    ) {
      throw new Error(
        `Financial year ${financialYear.label} is already open.`
      );
    }

    if (
      !closeRecord.journalId
    ) {
      throw new Error(
        "The original year-end closing journal could not be found."
      );
    }

    const resolvedReason =
      String(
        reason || ""
      ).trim();

    if (
      !resolvedReason
    ) {
      throw new Error(
        "A reason is required to reopen a financial year."
      );
    }

    const resolvedReversalDate =
      normaliseDate(
        options.reversalDate ||
          getToday()
      );

    if (
      !resolvedReversalDate
    ) {
      throw new Error(
        "A valid reversal date is required."
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Global period-lock enforcement
    |--------------------------------------------------------------------------
    */

    const reopenLockStatus =
      assertDateIsOpen(
        resolvedReversalDate,
        PERIOD_LOCK_AREAS.GLOBAL,
        {
          allowOverride:
            Boolean(
              options.allowPeriodLockOverride
            ),

          action:
            `reopen financial year ${financialYear.label}`,
        }
      );

    let reversalJournal =
      null;

    try {
      reversalJournal =
        reverseJournal(
          closeRecord.journalId,
          resolvedReason,
          {
            allowSystem:
              true,

            reversalDate:
              resolvedReversalDate,

            allowPeriodLockOverride:
              Boolean(
                options.allowPeriodLockOverride
              ),
          }
        );

      const now =
        new Date().toISOString();

      const updatedRecord = {
        ...closeRecord,

        status:
          YEAR_END_STATUS.OPEN,

        reopenedAt:
          now,

        latestReopenReason:
          resolvedReason,

        latestReversalDate:
          resolvedReversalDate,

        reversalJournalId:
          reversalJournal.id,

        reopenPeriodLockOverrideUsed:
          Boolean(
            reopenLockStatus.isOverridden
          ),

        history: [
          ...(
            Array.isArray(
              closeRecord.history
            )
              ? closeRecord.history
              : []
          ),

          {
            id: createId(),

            action:
              "Reopened",

            date:
              now,

            journalId:
              reversalJournal.id,

            reversalDate:
              resolvedReversalDate,

            reason:
              resolvedReason,

            description:
              `Financial year ${financialYear.label} was reopened. ${resolvedReason}`,

            periodLockOverrideUsed:
              Boolean(
                reopenLockStatus.isOverridden
              ),
          },
        ],
      };

      const storedCloses =
        readYearEndCloses();

      const recordIndex =
        storedCloses.findIndex(
          (
            record
          ) =>
            String(
              record.id
            ) ===
            String(
              closeRecord.id
            )
        );

      if (
        recordIndex <
        0
      ) {
        throw new Error(
          "The year-end close record could not be updated."
        );
      }

      storedCloses[
        recordIndex
      ] =
        updatedRecord;

      writeYearEndCloses(
        storedCloses
      );

      return cloneData(
        updatedRecord
      );
    } catch (
      error
    ) {
      /*
      |--------------------------------------------------------------------------
      | Roll back newly-created reversal if saving the close record fails
      |--------------------------------------------------------------------------
      */

      if (
        reversalJournal?.id
      ) {
        try {
          rollbackSystemJournal(
            reversalJournal.id
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "Unable to roll back year-end reopening journal:",
            rollbackError
          );
        }
      }

      throw error;
    }
  };

export const getFinancialYearCloseStatus =
  (
    year
  ) => {
    const closeRecord =
      getYearEndCloseByYear(
        year
      );

    return closeRecord?.status ===
      YEAR_END_STATUS.CLOSED
      ? YEAR_END_STATUS.CLOSED
      : YEAR_END_STATUS.OPEN;
  };

export const resetYearEndCloses =
  () => {
    localStorage.removeItem(
      STORAGE_KEY
    );

    return [];
  };