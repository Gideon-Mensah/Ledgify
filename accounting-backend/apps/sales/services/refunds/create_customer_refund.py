from common.ledger_integrity import lock_ledger
from apps.finance.services.allocations.carrying import source_slice
from apps.fx.services import get_effective_rate, convert_amount
from apps.fx.account_validation import validate_fx_account
from django.db.models import DateField
"""Return approved customer credit through a bank journal without changing old entries."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.sales.models import CustomerCreditNote, CustomerRefund
from apps.organisations.permissions import CREATE_CUSTOMER_REFUND
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def create_customer_refund(*, organisation, customer, bank_account, refund_date,
                           amount, currency, user, credit_note=None,
                           reference="", notes=""):
    lock_ledger(organisation.pk)
    require_organisation_permission(
        organisation=organisation, user=user, permission=CREATE_CUSTOMER_REFUND,
    )
    if customer.organisation_id != organisation.id or not customer.is_customer:
        raise BusinessRuleError("The selected customer is invalid.")
    if bank_account.organisation_id != organisation.id:
        raise BusinessRuleError("The bank account does not belong to this organisation.")
    if bank_account.status != Account.Status.ACTIVE:
        raise BusinessRuleError("The bank account is not active.")
    if (bank_account.account_class != Account.AccountClass.BANK
            and bank_account.cash_flow_category != Account.CashFlowCategory.CASH):
        raise BusinessRuleError("The selected account is not classified as bank or cash.")
    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError("Refund amount is invalid.") from error
    if amount <= Decimal("0.00"):
        raise BusinessRuleError("Refund amount must be greater than zero.")
    from common.currencies import require_currency_code
    currency = require_currency_code(currency or organisation.base_currency)
    if currency != bank_account.currency:
        raise BusinessRuleError("Refund currency must match the bank account currency.")
    if credit_note is not None:
        credit_note = CustomerCreditNote.objects.select_for_update().get(pk=credit_note.pk)
        if (credit_note.organisation_id != organisation.id
                or credit_note.customer_id != customer.id
                or credit_note.currency != currency):
            raise BusinessRuleError("The selected credit note is invalid.")
        if credit_note.status not in {
            CustomerCreditNote.Status.APPROVED,
            CustomerCreditNote.Status.PARTLY_APPLIED,
            CustomerCreditNote.Status.APPLIED,
        }:
            raise BusinessRuleError("Only an approved credit note can be refunded.")
        if amount > credit_note.available_credit:
            raise BusinessRuleError("Refund exceeds the available credit.")
    receivables = Account.objects.filter(
        organisation=organisation,
        account_class=Account.AccountClass.RECEIVABLE, is_current_control=True, account_type="asset",
        status=Account.Status.ACTIVE,
    )
    if receivables.count() != 1:
        raise BusinessRuleError(
            "The organisation must have exactly one active Accounts Receivable account."
        )
    refund_date=DateField().to_python(refund_date)
    if credit_note is not None and refund_date < credit_note.issue_date:
        raise BusinessRuleError("Refund date cannot precede the credit.")
    rate=get_effective_rate(organisation=organisation,base_currency=currency,target_currency=organisation.base_currency,date=refund_date)
    cash_base=convert_amount(amount=amount,rate=rate)
    credit_base=source_slice(credit_note,amount,payable=False,credit=True) if credit_note is not None else cash_base
    difference=credit_base-cash_base
    fx_lines=[]
    if difference:
        kind="gain" if difference>0 else "loss"
        fx_account=organisation.fx_gain_account if difference>0 else organisation.fx_loss_account
        validate_fx_account(organisation,fx_account,kind)
        fx_lines=[{"account":fx_account,"description":"Realised FX on credit refund","debit":max(-difference,Decimal("0")),"credit":max(difference,Decimal("0"))}]
    refund = CustomerRefund.objects.create(
        organisation=organisation, customer=customer, credit_note=credit_note,
        bank_account=bank_account, refund_date=refund_date, amount=amount,
        currency=currency, reference=reference, notes=notes,
        status=CustomerRefund.Status.DRAFT, created_by=user,
    )
    journal = create_journal_entry(
        organisation=organisation, date=refund_date,
        description=f"Customer refund - {customer.name}", reference=reference,
        source_type=JournalEntry.SourceType.CUSTOMER_REFUND,
        source_id=refund.id, user=user,
        lines=[
            {"account": receivables.get(), "description": "Customer refund",
             "debit": credit_base, "credit": Decimal("0.00")},
            {"account": bank_account, "description": "Customer refund",
             "debit": Decimal("0.00"), "credit": cash_base},
        ] + fx_lines,
    )
    journal.transaction_currency=currency;journal.transaction_amount=amount;journal.exchange_rate=rate
    journal.save(update_fields=["transaction_currency","transaction_amount","exchange_rate"])
    post_journal_entry(journal_entry=journal, user=user)
    refund.accounting_journal = journal
    refund.status = CustomerRefund.Status.POSTED
    refund.save(update_fields=["accounting_journal", "status", "updated_at"])
    if credit_note is not None:
        credit_note.amount_refunded += amount
        credit_note.save(update_fields=["amount_refunded", "updated_at"])
    return refund
