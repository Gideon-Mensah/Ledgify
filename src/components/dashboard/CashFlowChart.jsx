import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Landmark,
} from "lucide-react";
import {
  Link,
} from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getBankTransactions,
} from "../../services/bankTransactionServices";

import {
  getBankAccounts,
} from "../../services/bankAccountService";

const REPORTING_CURRENCY = "GBP";

const RANGE_OPTIONS = {
  "6-months": {
    label: "Last 6 months",
    monthCount: 6,
  },

  "12-months": {
    label: "Last 12 months",
    monthCount: 12,
  },

  "current-year": {
    label: "Current year",
    monthCount: null,
  },
};

// Formats currency.
const formatCurrency = (
  amount,
  currency = REPORTING_CURRENCY
) => {
  try {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          currency ||
          REPORTING_CURRENCY,
        maximumFractionDigits: 0,
      }
    ).format(Number(amount) || 0);
  } catch {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          REPORTING_CURRENCY,
        maximumFractionDigits: 0,
      }
    ).format(Number(amount) || 0);
  }
};

// Formats compact currency.
const formatCompactCurrency = (
  amount
) => {
  const numericAmount =
    Number(amount) || 0;

  const absoluteAmount =
    Math.abs(numericAmount);

  if (absoluteAmount >= 1000000) {
    return `£${(
      numericAmount / 1000000
    ).toFixed(
      absoluteAmount >= 10000000
        ? 0
        : 1
    )}m`;
  }

  if (absoluteAmount >= 1000) {
    return `£${(
      numericAmount / 1000
    ).toFixed(
      absoluteAmount >= 10000
        ? 0
        : 1
    )}k`;
  }

  return `£${Math.round(
    numericAmount
  )}`;
};

// Parses date value.
const parseDateValue = (
  dateValue
) => {
  if (!dateValue) {
    return null;
  }

  const value =
    String(dateValue).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    const parsedDate = new Date(
      `${value}T00:00:00`
    );

    return Number.isNaN(
      parsedDate.getTime()
    )
      ? null
      : parsedDate;
  }

  const displayDateMatch =
    value.match(
      /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
    );

  if (displayDateMatch) {
    const monthNumbers = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };

    const day = Number(
      displayDateMatch[1]
    );

    const month =
      monthNumbers[
        displayDateMatch[2]
          .toLowerCase()
      ];

    const year = Number(
      displayDateMatch[3]
    );

    if (
      month !== undefined
    ) {
      return new Date(
        year,
        month,
        day
      );
    }
  }

  const parsedDate =
    new Date(value);

  return Number.isNaN(
    parsedDate.getTime()
  )
    ? null
    : parsedDate;
};

// Gets transaction type.
const getTransactionType = (
  transaction
) => {
  const transactionType =
    String(
      transaction.transactionType ||
        transaction.type ||
        ""
    )
      .trim()
      .toLowerCase();

  if (
    [
      "money in",
      "income",
      "credit",
      "receipt",
    ].includes(transactionType)
  ) {
    return "Money in";
  }

  return "Money out";
};

// Gets month key.
const getMonthKey = (date) => {
  const year =
    date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  return `${year}-${month}`;
};

// Gets month label.
const getMonthLabel = (
  date,
  includeYear
) => {
  return new Intl.DateTimeFormat(
    "en-GB",
    includeYear
      ? {
          month: "short",
          year: "2-digit",
        }
      : {
          month: "short",
        }
  ).format(date);
};

// Gets month range.
const getMonthRange = (
  selectedRange
) => {
  const today = new Date();

  const currentMonth =
    new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

  if (
    selectedRange ===
    "current-year"
  ) {
    return Array.from(
      {
        length:
          today.getMonth() + 1,
      },
      (_, index) =>
        new Date(
          today.getFullYear(),
          index,
          1
        )
    );
  }

  const monthCount =
    RANGE_OPTIONS[
      selectedRange
    ]?.monthCount || 6;

  return Array.from(
    {
      length: monthCount,
    },
    (_, index) => {
      const monthsBack =
        monthCount - 1 - index;

      return new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() -
          monthsBack,
        1
      );
    }
  );
};

// Renders the cash flow chart component.
function CashFlowChart() {
  const [
    selectedRange,
    setSelectedRange,
  ] = useState("6-months");

  const [
    transactions,
    setTransactions,
  ] = useState([]);

  const [
    accounts,
    setAccounts,
  ] = useState([]);

  // Loads cash flow data.
  const loadCashFlowData = () => {
    try {
      const storedTransactions =
        getBankTransactions();

      const storedAccounts =
        getBankAccounts();

      setTransactions(
        Array.isArray(
          storedTransactions
        )
          ? storedTransactions
          : []
      );

      setAccounts(
        Array.isArray(
          storedAccounts
        )
          ? storedAccounts
          : []
      );
    } catch (error) {
      console.error(
        "Cash flow data could not be loaded:",
        error
      );

      setTransactions([]);
      setAccounts([]);
    }
  };

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(loadCashFlowData);

    window.addEventListener(
      "focus",
      loadCashFlowData
    );

    return () => {
      window.cancelAnimationFrame(initialLoad);
      window.removeEventListener(
        "focus",
        loadCashFlowData
      );
    };
  }, []);

  const accountMap =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return accounts.reduce(
        (map, account) => {
          map[
            String(account.id)
          ] = account;

          return map;
        },
        {}
      );
    }, [accounts]);

  const cashFlowResult =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      const months =
        getMonthRange(
          selectedRange
        );

      const includeYear =
        selectedRange !==
        "current-year";

      const monthMap =
        months.reduce(
          (map, monthDate) => {
            const monthKey =
              getMonthKey(
                monthDate
              );

            map[monthKey] = {
              monthKey,

              month:
                getMonthLabel(
                  monthDate,
                  includeYear
                ),

              fullMonth:
                new Intl.DateTimeFormat(
                  "en-GB",
                  {
                    month: "long",
                    year: "numeric",
                  }
                ).format(
                  monthDate
                ),

              moneyIn: 0,

              moneyOut: 0,

              transactionCount: 0,
            };

            return map;
          },
          {}
        );

      let excludedCurrencyCount =
        0;

      let invalidDateCount = 0;

      transactions.forEach(
        (transaction) => {
          const transactionDate =
            parseDateValue(
              transaction.date ||
                transaction.createdAt
            );

          if (!transactionDate) {
            invalidDateCount += 1;
            return;
          }

          const monthKey =
            getMonthKey(
              transactionDate
            );

          if (!monthMap[monthKey]) {
            return;
          }

          const account =
            accountMap[
              String(
                transaction.bankAccountId
              )
            ];

          const currency =
            String(
              account?.currency ||
                transaction.currency ||
                REPORTING_CURRENCY
            ).toUpperCase();

          if (
            currency !==
            REPORTING_CURRENCY
          ) {
            excludedCurrencyCount +=
              1;

            return;
          }

          const amount =
            Math.abs(
              Number(
                transaction.amount
              ) || 0
            );

          const transactionType =
            getTransactionType(
              transaction
            );

          if (
            transactionType ===
            "Money in"
          ) {
            monthMap[
              monthKey
            ].moneyIn += amount;
          } else {
            monthMap[
              monthKey
            ].moneyOut += amount;
          }

          monthMap[
            monthKey
          ].transactionCount += 1;
        }
      );

      const chartData =
        months.map(
          (monthDate) =>
            monthMap[
              getMonthKey(
                monthDate
              )
            ]
        );

      const totals =
        chartData.reduce(
          (summary, month) => {
            summary.moneyIn +=
              month.moneyIn;

            summary.moneyOut +=
              month.moneyOut;

            summary.transactionCount +=
              month.transactionCount;

            return summary;
          },
          {
            moneyIn: 0,
            moneyOut: 0,
            transactionCount: 0,
          }
        );

      return {
        chartData,

        excludedCurrencyCount,

        invalidDateCount,

        totals: {
          ...totals,

          netCashFlow:
            totals.moneyIn -
            totals.moneyOut,
        },
      };
    }, [
      transactions,
      accountMap,
      selectedRange,
    ]);

  const hasCashFlowData =
    cashFlowResult.totals
      .transactionCount > 0;

  const selectedRangeLabel =
    RANGE_OPTIONS[
      selectedRange
    ]?.label ||
    "Last 6 months";

  return (
    <section className="dashboard-panel cash-flow-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Cash flow</h2>

          <p>
            Money received and spent
            across your GBP bank
            accounts.
          </p>
        </div>

        <select
          className="dashboard-select"
          value={selectedRange}
          onChange={(event) =>
            setSelectedRange(
              event.target.value
            )
          }
          aria-label="Select cash flow period"
        >
          <option value="6-months">
            Last 6 months
          </option>

          <option value="12-months">
            Last 12 months
          </option>

          <option value="current-year">
            Current year
          </option>
        </select>
      </div>

      {hasCashFlowData ? (
        <>
          <div className="cash-flow-summary">
            <div>
              <span>
                Money in
              </span>

              <strong>
                {formatCurrency(
                  cashFlowResult
                    .totals.moneyIn
                )}
              </strong>
            </div>

            <div>
              <span>
                Money out
              </span>

              <strong>
                {formatCurrency(
                  cashFlowResult
                    .totals.moneyOut
                )}
              </strong>
            </div>

            <div>
              <span>
                Net cash flow
              </span>

              <strong>
                {formatCurrency(
                  cashFlowResult
                    .totals
                    .netCashFlow
                )}
              </strong>
            </div>
          </div>

          <div className="cash-flow-chart">
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <LineChart
                data={
                  cashFlowResult.chartData
                }
                margin={{
                  top: 10,
                  right: 10,
                  left: -10,
                  bottom: 0,
                }}
              >
                <CartesianGrid
                  strokeDasharray="4 4"
                  vertical={false}
                />

                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                />

                <YAxis
                  tickFormatter={
                    formatCompactCurrency
                  }
                  tickLine={false}
                  axisLine={false}
                />

                <Tooltip
                  labelFormatter={(
                    _label,
                    payload
                  ) => {
                    return (
                      payload?.[0]
                        ?.payload
                        ?.fullMonth ||
                      _label
                    );
                  }}
                  formatter={(
                    value,
                    name
                  ) => [
                    formatCurrency(
                      value
                    ),
                    name,
                  ]}
                />

                <Legend />

                <Line
                  type="monotone"
                  dataKey="moneyIn"
                  name="Money in"
                  stroke="var(--success-color)"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{
                    r: 6,
                  }}
                  connectNulls
                />

                <Line
                  type="monotone"
                  dataKey="moneyOut"
                  name="Money out"
                  stroke="var(--danger-color)"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{
                    r: 6,
                  }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="cash-flow-footer">
            <span>
              {
                cashFlowResult
                  .totals
                  .transactionCount
              }{" "}
              {cashFlowResult
                .totals
                .transactionCount === 1
                ? "transaction"
                : "transactions"}{" "}
              included for{" "}
              {selectedRangeLabel.toLowerCase()}.
            </span>

            {cashFlowResult
              .excludedCurrencyCount >
              0 && (
              <span>
                {
                  cashFlowResult
                    .excludedCurrencyCount
                }{" "}
                non-GBP{" "}
                {cashFlowResult
                  .excludedCurrencyCount ===
                1
                  ? "transaction was"
                  : "transactions were"}{" "}
                excluded.
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="invoice-empty-state">
          <Landmark size={30} />

          <h3>
            No cash flow activity
          </h3>

          <p>
            No GBP bank transactions
            were found for{" "}
            {selectedRangeLabel.toLowerCase()}.
          </p>

          <Link
            to="/banking/transactions"
            className="page-primary-button"
          >
            View bank transactions
          </Link>
        </div>
      )}
    </section>
  );
}

export default CashFlowChart;
