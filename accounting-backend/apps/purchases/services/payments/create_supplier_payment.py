from apps.finance.services.allocations.carrying import carrying_slice, require_revaluation_reversed
"""Pay a supplier bill, post the bank journal, and allocate the payable balance."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.purchases.models import Bill, SupplierPayment
from apps.fx.services import convert_amount,get_effective_rate


@transaction.atomic
def create_supplier_payment(*, organisation, supplier, bank_account, payment_date,
                            amount, user, currency, bill=None, reference="", notes="", withholdings=None):
    lock_ledger(organisation.id)
    if supplier.organisation_id != organisation.id or not supplier.is_supplier:
        raise BusinessRuleError("The selected supplier is invalid.")
    if bill is not None:
        bill = Bill.objects.select_for_update().get(pk=bill.pk)
        if (
            bill.organisation_id != organisation.id
            or bill.supplier_id != supplier.id
        ):
            raise BusinessRuleError("The selected bill is invalid.")
        if bill.status not in {Bill.Status.APPROVED, Bill.Status.PARTLY_PAID}:
            raise BusinessRuleError("Bill is not available for payment allocation.")
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
    if amount <= 0: raise BusinessRuleError("Payment amount must be greater than zero.")
    from common.currencies import require_currency_code
    currency = require_currency_code(currency or organisation.base_currency)
    if len(currency) != 3 or currency != bank_account.currency:
        raise BusinessRuleError(
            "Payment currency must match the bank account currency."
        )
    if bill is not None and currency != bill.currency:
        raise BusinessRuleError("Payment currency must match the bill currency.")
    if bill is not None and amount > bill.amount_due:
        raise BusinessRuleError("Payment exceeds the bill outstanding balance.")
    payables = Account.objects.filter(organisation=organisation,
        account_class=Account.AccountClass.PAYABLE, status=Account.Status.ACTIVE)
    if payables.count() != 1:
        raise BusinessRuleError("The organisation must have exactly one active Accounts Payable account.")
    require_revaluation_reversed(organisation,currency,payable=True)
    rate=get_effective_rate(organisation=organisation,base_currency=currency,target_currency=organisation.base_currency,date=payment_date)
    base_amount=convert_amount(amount=amount,rate=rate);payable_base=carrying_slice(bill,amount,payable=True) if bill else base_amount
    fx=payable_base-base_amount
    if fx:
        from apps.fx.account_validation import validate_fx_account
        validate_fx_account(organisation, organisation.fx_gain_account if fx>0 else organisation.fx_loss_account, "gain" if fx>0 else "loss")
    from apps.tax.withholding import prepare_withholding, withholding_journal_lines, record_withholding
    withheld, withheld_total = prepare_withholding(organisation=organisation,contact=supplier,point=payment_date,
        gross=amount,currency=currency,exchange_rate=rate,items=withholdings,supplier_payment=True,source=bill)
    cash_base = base_amount - sum((item['base_withheld'] for item in withheld), Decimal('0.00'))
    payment = SupplierPayment.objects.create(
        organisation=organisation, supplier=supplier, bill=bill,
        bank_account=bank_account, payment_date=payment_date, amount=amount,
        currency=currency, reference=reference, notes=notes,
        status=SupplierPayment.Status.DRAFT, created_by=user,
        exchange_rate=rate,base_currency_amount=base_amount,realised_fx_gain_loss=fx,
    )
    document = bill.bill_number if bill else supplier.name
    journal = create_journal_entry(
        organisation=organisation, date=payment_date,
        description=f"Supplier payment - {document}", reference=reference or document,
        source_type=JournalEntry.SourceType.PAYMENT, source_id=payment.id, user=user,
        lines=[
            {"account": payables.get(), "description": "Supplier payment",
             "debit": payable_base, "credit": Decimal("0.00")},
            {"account": bank_account, "description": "Supplier payment",
             "debit": Decimal("0.00"), "credit": cash_base},
        ] + withholding_journal_lines(withheld, True) + ([{"account":organisation.fx_gain_account if fx>0 else organisation.fx_loss_account,
               "description":"Realised FX","debit":Decimal("0.00") if fx>0 else abs(fx),"credit":fx if fx>0 else Decimal("0.00")}] if fx else []),
    )
    post_journal_entry(journal_entry=journal, user=user)
    payment.accounting_journal = journal; payment.status = SupplierPayment.Status.POSTED
    payment.save(update_fields=["accounting_journal", "status", "updated_at"])
    record_withholding(payment, withheld, True, user)
    if bill is not None:
        from apps.finance.services.allocations import allocate_supplier_payment
        allocate_supplier_payment(organisation=organisation, payment=payment,
                                  bill=bill, amount=amount, user=user, effective_date=payment_date)
    return payment
