"""Record money returned by a supplier against available supplier credit."""

from decimal import Decimal

from django.db import transaction

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.purchases.models import SupplierCredit, SupplierRefund
from apps.organisations.permissions import CREATE_SUPPLIER_REFUND
from apps.organisations.services import require_organisation_permission


@transaction.atomic
def create_supplier_refund(*, organisation, supplier, supplier_credit,
                           bank_account, refund_date, amount, currency, user,
                           reference="", notes=""):
    require_organisation_permission(
        organisation=organisation, user=user, permission=CREATE_SUPPLIER_REFUND,
    )
    if supplier.organisation_id != organisation.id or not supplier.is_supplier:
        raise BusinessRuleError("The selected supplier is invalid.")
    if supplier_credit is None:
        raise BusinessRuleError("A supplier credit is required.")

    supplier_credit = SupplierCredit.objects.select_for_update().get(
        pk=supplier_credit.pk
    )
    if (supplier_credit.organisation_id != organisation.id
            or supplier_credit.supplier_id != supplier.id):
        raise BusinessRuleError("The selected supplier credit is invalid.")
    if supplier_credit.status in {
        SupplierCredit.Status.DRAFT,
        SupplierCredit.Status.VOID,
    }:
        raise BusinessRuleError("A draft or void supplier credit cannot be refunded.")

    try:
        amount = Decimal(str(amount))
    except (ValueError, TypeError, ArithmeticError) as error:
        raise BusinessRuleError("Refund amount is invalid.") from error

    if amount <= Decimal("0.00"):
        raise BusinessRuleError("Refund amount must be greater than zero.")
    if supplier_credit.available_credit <= Decimal("0.00"):
        raise BusinessRuleError("The supplier credit has no refundable balance.")
    if amount > supplier_credit.available_credit:
        raise BusinessRuleError("Refund exceeds the available supplier credit.")

    currency = str(currency).upper().strip()
    if currency != supplier_credit.currency:
        raise BusinessRuleError("Refund currency must match the supplier credit.")
    if bank_account.organisation_id != organisation.id:
        raise BusinessRuleError("The bank account does not belong to this organisation.")
    if bank_account.status != Account.Status.ACTIVE:
        raise BusinessRuleError("The bank account is not active.")
    if (
        bank_account.account_class != Account.AccountClass.BANK
        and bank_account.cash_flow_category != Account.CashFlowCategory.CASH
    ):
        raise BusinessRuleError(
            "The selected account is not classified as bank or cash."
        )
    if currency != bank_account.currency:
        raise BusinessRuleError("Refund currency must match the bank account currency.")

    payables = Account.objects.filter(
        organisation=organisation,
        account_class=Account.AccountClass.PAYABLE,
        status=Account.Status.ACTIVE,
    )
    if payables.count() != 1:
        raise BusinessRuleError(
            "The organisation must have exactly one active Accounts Payable account."
        )

    refund = SupplierRefund.objects.create(
        organisation=organisation,
        supplier=supplier,
        supplier_credit=supplier_credit,
        bank_account=bank_account,
        refund_date=refund_date,
        amount=amount,
        currency=currency,
        reference=reference,
        notes=notes,
        status=SupplierRefund.Status.DRAFT,
        created_by=user,
    )

    journal = create_journal_entry(
        organisation=organisation,
        date=refund_date,
        description=f"Supplier refund - {supplier.name}",
        reference=reference or supplier_credit.credit_number,
        source_type=JournalEntry.SourceType.SUPPLIER_REFUND,
        source_id=refund.id,
        user=user,
        lines=[
            {
                "account": bank_account,
                "description": "Supplier refund",
                "debit": amount,
                "credit": Decimal("0.00"),
            },
            {
                "account": payables.get(),
                "description": "Supplier refund",
                "debit": Decimal("0.00"),
                "credit": amount,
            },
        ],
    )
    post_journal_entry(journal_entry=journal, user=user)

    refund.accounting_journal = journal
    refund.status = SupplierRefund.Status.POSTED
    refund.save(update_fields=["accounting_journal", "status", "updated_at"])

    supplier_credit.amount_refunded += amount
    supplier_credit.save(update_fields=["amount_refunded", "updated_at"])

    return refund
