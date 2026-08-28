"""Record a customer receipt, post its journal, and allocate it to an invoice."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.sales.models import CustomerPayment, Invoice
from apps.fx.services import convert_amount,get_effective_rate


@transaction.atomic
def create_customer_payment(*, organisation, customer, bank_account, payment_date,
                            amount, user, currency, invoice=None, reference="",
                            notes=""):
    if customer.organisation_id != organisation.id or not customer.is_customer:
        raise BusinessRuleError("The selected customer is invalid.")
    if invoice is not None:
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if (
            invoice.organisation_id != organisation.id
            or invoice.customer_id != customer.id
        ):
            raise BusinessRuleError("The selected invoice is invalid.")
        if invoice.status not in {
            Invoice.Status.APPROVED, Invoice.Status.SENT, Invoice.Status.PARTLY_PAID,
        }:
            raise BusinessRuleError("Invoice is not available for payment allocation.")
    if (
        bank_account.organisation_id != organisation.id
        or bank_account.status != Account.Status.ACTIVE
    ):
        raise BusinessRuleError("A valid active organisation bank account is required.")
    if bank_account.account_class != Account.AccountClass.BANK:
        raise BusinessRuleError("The selected account must be a bank account.")
    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError("Payment amount is invalid.") from error
    if amount <= 0:
        raise BusinessRuleError("Payment amount must be greater than zero.")
    from common.currencies import require_currency_code
    currency = require_currency_code(currency)
    if len(currency) != 3 or currency != bank_account.currency:
        raise BusinessRuleError(
            "Payment currency must match the bank account currency."
        )
    if invoice is not None and currency != invoice.currency:
        raise BusinessRuleError("Payment currency must match the invoice currency.")
    if invoice is not None and amount > invoice.amount_due:
        raise BusinessRuleError("Payment exceeds the invoice outstanding balance.")
    receivables = Account.objects.filter(organisation=organisation,
        account_class=Account.AccountClass.RECEIVABLE, status=Account.Status.ACTIVE)
    if receivables.count() != 1:
        raise BusinessRuleError("The organisation must have exactly one active Accounts Receivable account.")
    rate=get_effective_rate(organisation=organisation,base_currency=currency,target_currency=organisation.base_currency,date=payment_date)
    base_amount=convert_amount(amount=amount,rate=rate);receivable_base=convert_amount(amount=amount,rate=invoice.exchange_rate) if invoice else base_amount
    fx=base_amount-receivable_base
    if fx and not (organisation.fx_gain_account if fx>0 else organisation.fx_loss_account):raise BusinessRuleError("Configure FX gain and loss accounts before foreign settlement.")
    payment = CustomerPayment.objects.create(
        organisation=organisation, customer=customer, invoice=invoice,
        bank_account=bank_account, payment_date=payment_date, amount=amount,
        currency=currency, reference=reference, notes=notes,
        status=CustomerPayment.Status.DRAFT, created_by=user,
        exchange_rate=rate,base_currency_amount=base_amount,realised_fx_gain_loss=fx,
    )
    document = invoice.invoice_number if invoice else customer.name
    journal = create_journal_entry(
        organisation=organisation, date=payment_date,
        description=f"Customer payment - {document}", reference=reference or document,
        source_type=JournalEntry.SourceType.PAYMENT, source_id=payment.id, user=user,
        lines=[
            {"account": bank_account, "description": "Payment received",
             "debit": base_amount, "credit": Decimal("0.00")},
            {"account": receivables.get(), "description": "Payment received",
             "debit": Decimal("0.00"), "credit": receivable_base},
        ] + ([{"account":organisation.fx_gain_account if fx>0 else organisation.fx_loss_account,
               "description":"Realised FX","debit":Decimal("0.00") if fx>0 else abs(fx),"credit":fx if fx>0 else Decimal("0.00")}] if fx else []),
    )
    post_journal_entry(journal_entry=journal, user=user)
    payment.accounting_journal = journal; payment.status = CustomerPayment.Status.POSTED
    payment.save(update_fields=["accounting_journal", "status", "updated_at"])
    if invoice is not None:
        from apps.finance.services.allocations import allocate_customer_payment
        allocate_customer_payment(organisation=organisation, payment=payment,
                                  invoice=invoice, amount=amount, user=user)
    return payment
