from decimal import Decimal


ZERO = Decimal("0.00")


def normal_balance(
    debit,
    credit,
):
    debit = debit or ZERO
    credit = credit or ZERO

    net = debit - credit

    if net > ZERO:
        return net, ZERO

    if net < ZERO:
        return ZERO, abs(net)

    return ZERO, ZERO


def balance_position(debit, credit):
    """Return one canonical debit/credit position from base-currency totals."""
    debit = debit or ZERO
    credit = credit or ZERO
    debit_balance, credit_balance = normal_balance(debit, credit)
    return {
        "net_balance": debit - credit,
        "debit_balance": debit_balance,
        "credit_balance": credit_balance,
        "balance_side": "debit" if debit_balance else "credit" if credit_balance else "balanced",
    }


def statement_amount(account_type, debit, credit):
    """Return the conventional positive report amount for an account type."""
    from apps.accounting.models import Account

    if account_type in {
        Account.AccountType.LIABILITY,
        Account.AccountType.EQUITY,
        Account.AccountType.REVENUE,
    }:
        return (credit or ZERO) - (debit or ZERO)
    return (debit or ZERO) - (credit or ZERO)
