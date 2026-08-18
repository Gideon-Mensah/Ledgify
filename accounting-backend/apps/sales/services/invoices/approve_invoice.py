"""Approve an invoice and post revenue, tax, and Accounts Receivable entries."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError

from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import (
    create_journal_entry,
    post_journal_entry,
)
from apps.sales.models import Invoice
from apps.organisations.permissions import APPROVE_INVOICE
from apps.organisations.services import require_organisation_permission
from apps.tax.models import TaxTransaction
from apps.tax.services.ledger_service import record_tax_transactions
from apps.fx.services import convert_amount

from .helpers import money


@transaction.atomic
def approve_invoice(
    *,
    invoice,
    user,
):
    invoice = (
        Invoice.objects
        .select_for_update()
        .select_related(
            "organisation",
            "customer",
        )
        .prefetch_related(
            "lines__revenue_account",
            "lines__tax_rate_config__output_tax_account",
        )
        .get(pk=invoice.pk)
    )
    require_organisation_permission(
        organisation=invoice.organisation, user=user, permission=APPROVE_INVOICE,
    )
    if (
        invoice.organisation.require_separate_approver
        and invoice.created_by_id == user.id
    ):
        raise BusinessRuleError("You cannot approve a transaction you created.")

    if invoice.status not in {
        Invoice.Status.DRAFT,
        Invoice.Status.AWAITING_APPROVAL,
    }:
        raise BusinessRuleError(
            "Only draft or awaiting approval invoices "
            "can be approved."
        )

    if invoice.accounting_journal_id:
        raise BusinessRuleError(
            "This invoice already has an accounting journal."
        )

    if invoice.total <= Decimal("0.00"):
        raise BusinessRuleError(
            "Invoice total must be greater than zero."
        )

    lines = list(invoice.lines.all())

    if not lines:
        raise BusinessRuleError(
            "An invoice must contain at least one line "
            "before it can be approved."
        )

    receivable_accounts = Account.objects.filter(
        organisation=invoice.organisation,
        account_class=Account.AccountClass.RECEIVABLE,
        status=Account.Status.ACTIVE,
    )

    receivable_count = receivable_accounts.count()

    if receivable_count == 0:
        raise BusinessRuleError(
            "The organisation does not have an active "
            "Accounts Receivable account."
        )

    if receivable_count > 1:
        raise BusinessRuleError(
            "The organisation has more than one active "
            "Accounts Receivable account."
        )

    receivable_account = receivable_accounts.get()

    journal_lines = [
        {
            "account": receivable_account,
            "description": (
                f"Invoice {invoice.invoice_number} "
                f"- {invoice.customer.name}"
            ),
            "debit": convert_amount(amount=invoice.total, rate=invoice.exchange_rate),
            "credit": Decimal("0.00"),
        }
    ]

    revenue_totals = {}

    for line in lines:
        account = line.revenue_account

        if account.organisation_id != invoice.organisation_id:
            raise BusinessRuleError(
                f"Revenue account {account.code} does not "
                f"belong to this organisation."
            )

        if account.status != Account.Status.ACTIVE:
            raise BusinessRuleError(
                f"Revenue account {account.code} is not active."
            )

        if account.account_type != Account.AccountType.REVENUE:
            raise BusinessRuleError(
                f"Account {account.code} is not a revenue account."
            )

        revenue_amount = money(
            line.line_total - line.tax_amount
        )

        if account.id not in revenue_totals:
            revenue_totals[account.id] = {
                "account": account,
                "amount": Decimal("0.00"),
            }

        revenue_totals[account.id]["amount"] += revenue_amount

    total_revenue = Decimal("0.00")

    for item in revenue_totals.values():
        amount = money(item["amount"])

        total_revenue += amount

        journal_lines.append(
            {
                "account": item["account"],
                "description": (
                    f"Revenue - Invoice "
                    f"{invoice.invoice_number}"
                ),
                "debit": Decimal("0.00"),
                "credit": convert_amount(amount=amount, rate=invoice.exchange_rate),
            }
        )

    total_revenue = money(total_revenue)

    if total_revenue != money(invoice.subtotal):
        raise BusinessRuleError(
            "Invoice revenue does not match the invoice subtotal."
        )

    tax_totals = {}
    for line in lines:
        if not line.tax_amount:
            continue
        rate = line.tax_rate_config
        if rate is None or rate.output_tax_account is None:
            raise BusinessRuleError("Taxed invoice lines require a configured output tax account.")
        account = rate.output_tax_account
        if account.organisation_id != invoice.organisation_id or account.status != Account.Status.ACTIVE:
            raise BusinessRuleError("Output tax account is invalid for this organisation.")
        tax_totals.setdefault(account.id, [account, Decimal("0.00")])[1] += line.tax_amount
    for account, amount in tax_totals.values():
        journal_lines.append({"account": account, "description": f"Output tax - Invoice {invoice.invoice_number}",
                              "debit": Decimal("0.00"), "credit": convert_amount(amount=amount, rate=invoice.exchange_rate)})

    journal = create_journal_entry(
        organisation=invoice.organisation,
        date=invoice.issue_date,
        description=(
            f"Invoice {invoice.invoice_number} "
            f"- {invoice.customer.name}"
        ),
        lines=journal_lines,
        user=user,
        reference=invoice.invoice_number,
        source_type=JournalEntry.SourceType.INVOICE,
        source_id=invoice.id,
    )
    journal.transaction_currency=invoice.currency;journal.transaction_amount=invoice.total;journal.exchange_rate=invoice.exchange_rate
    journal.save(update_fields=["transaction_currency","transaction_amount","exchange_rate"])

    post_journal_entry(
        journal_entry=journal,
        user=user,
    )
    record_tax_transactions(document=invoice, lines=lines, journal_entry=journal,
                            source_type="invoice", direction=TaxTransaction.Direction.OUTPUT,
                            document_number=invoice.invoice_number, contact=invoice.customer)

    invoice.accounting_journal = journal
    invoice.status = Invoice.Status.APPROVED
    invoice.approved_at = timezone.now()
    invoice.approved_by = user

    invoice.save(
        update_fields=[
            "accounting_journal",
            "status",
            "approved_at",
            "approved_by",
            "updated_at",
        ]
    )

    return invoice
