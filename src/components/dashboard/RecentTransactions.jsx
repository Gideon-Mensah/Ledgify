import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
} from "lucide-react";
import {
  Link,
} from "react-router-dom";

import {
  getBankTransactions,
} from "../../services/bankTransactionServices";

import {
  getBankAccounts,
} from "../../services/bankAccountService";

// Formats currency.
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
    ).format(Number(amount) || 0);
  } catch {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency: "GBP",
      }
    ).format(Number(amount) || 0);
  }
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

  const parsedDate =
    new Date(value);

  return Number.isNaN(
    parsedDate.getTime()
  )
    ? null
    : parsedDate;
};

// Formats date.
const formatDate = (
  dateValue
) => {
  const parsedDate =
    parseDateValue(dateValue);

  if (!parsedDate) {
    return dateValue
      ? String(dateValue)
      : "—";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(parsedDate);
};

// Gets transaction sort time.
const getTransactionSortTime = (
  transaction
) => {
  const dateValue =
    transaction.date ||
    transaction.createdAt ||
    transaction.updatedAt;

  const parsedDate =
    parseDateValue(dateValue);

  return parsedDate
    ? parsedDate.getTime()
    : 0;
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
    transactionType ===
      "money in" ||
    transactionType ===
      "income" ||
    transactionType ===
      "credit"
  ) {
    return "Money in";
  }

  return "Money out";
};

// Renders the recent transactions component.
function RecentTransactions() {
  const [
    transactions,
    setTransactions,
  ] = useState([]);

  const [
    accounts,
    setAccounts,
  ] = useState([]);

  // Loads data.
  const loadData = () => {
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
        "Recent bank transactions could not be loaded:",
        error
      );

      setTransactions([]);
      setAccounts([]);
    }
  };

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(loadData);

    window.addEventListener(
      "focus",
      loadData
    );

    return () => {
      window.cancelAnimationFrame(initialLoad);
      window.removeEventListener(
        "focus",
        loadData
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

  const recentTransactions =
    // Recalculates this value only when its inputs change.
    useMemo(() => {
      return transactions
        .map((transaction) => {
          const account =
            accountMap[
              String(
                transaction.bankAccountId
              )
            ] || null;

          const transactionType =
            getTransactionType(
              transaction
            );

          return {
            ...transaction,

            account,

            transactionType,

            accountName:
              account?.accountName ||
              "Unknown account",

            bankName:
              account?.bankName ||
              "",

            currency:
              account?.currency ||
              transaction.currency ||
              "GBP",

            isMoneyIn:
              transactionType ===
              "Money in",
          };
        })
        .sort(
          (first, second) =>
            getTransactionSortTime(
              second
            ) -
            getTransactionSortTime(
              first
            )
        )
        .slice(0, 5);
    }, [
      transactions,
      accountMap,
    ]);

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>
            Recent transactions
          </h2>

          <p>
            Your latest bank activity
            across all accounts.
          </p>
        </div>

        <Link
          to="/banking/transactions"
          className="dashboard-text-link"
        >
          View all
        </Link>
      </div>

      {recentTransactions.length >
      0 ? (
        <div className="transaction-list">
          {recentTransactions.map(
            (transaction) => (
              <div
                className="transaction-item"
                key={transaction.id}
              >
                <div className="transaction-details">
                  <div className="dashboard-transaction-title">
                    <span
                      className={
                        transaction.isMoneyIn
                          ? "dashboard-transaction-icon dashboard-transaction-icon-income"
                          : "dashboard-transaction-icon dashboard-transaction-icon-expense"
                      }
                    >
                      {transaction.isMoneyIn ? (
                        <ArrowDownLeft
                          size={17}
                        />
                      ) : (
                        <ArrowUpRight
                          size={17}
                        />
                      )}
                    </span>

                    <div>
                      <strong>
                        {transaction.description ||
                          "Bank transaction"}
                      </strong>

                      <span>
                        {
                          transaction.accountName
                        }{" "}
                        ·{" "}
                        {formatDate(
                          transaction.date
                        )}
                      </span>
                    </div>
                  </div>

                  {(transaction.contact ||
                    transaction.reference ||
                    transaction.category) && (
                    <small>
                      {[
                        transaction.contact,
                        transaction.reference,
                        transaction.category,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </div>

                <div className="dashboard-transaction-amount">
                  <span
                    className={
                      transaction.isMoneyIn
                        ? "transaction-amount transaction-income"
                        : "transaction-amount transaction-expense"
                    }
                  >
                    {transaction.isMoneyIn
                      ? "+"
                      : "-"}
                    {formatCurrency(
                      transaction.amount,
                      transaction.currency
                    )}
                  </span>

                  <small
                    className={
                      transaction.status ===
                      "Reconciled"
                        ? "transaction-status transaction-status-reconciled"
                        : "transaction-status transaction-status-unreconciled"
                    }
                  >
                    {transaction.status ||
                      "Unreconciled"}
                  </small>
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        <div className="invoice-empty-state">
          <Landmark size={30} />

          <h3>
            No bank transactions yet
          </h3>

          <p>
            Add or import bank
            transactions to see your
            latest activity here.
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

export default RecentTransactions;
