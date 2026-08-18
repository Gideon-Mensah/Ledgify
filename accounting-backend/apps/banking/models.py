"""Bank statement records and reconciliation links kept separate from ledger history."""

from django.db import models

# Create your models here.
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.accounting.models import Account, JournalEntry
from apps.organisations.models import Organisation
from apps.contacts.models import Contact


class BankAccount(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="bank_accounts",
    )

    ledger_account = models.OneToOneField(
        Account,
        on_delete=models.PROTECT,
        related_name="bank_profile",
    )

    name = models.CharField(
        max_length=255,
    )

    bank_name = models.CharField(
        max_length=255,
        blank=True,
    )

    account_number = models.CharField(
        max_length=100,
        blank=True,
    )

    sort_code = models.CharField(
        max_length=50,
        blank=True,
    )

    iban = models.CharField(
        max_length=100,
        blank=True,
    )

    swift_bic = models.CharField(
        max_length=50,
        blank=True,
    )

    currency = models.CharField(
        max_length=3,
    )

    opening_balance = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    opening_balance_date = models.DateField(
        null=True,
        blank=True,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bank_accounts_created",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["name"]

        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "name"],
                name="unique_bank_account_name_per_organisation",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "status"],
            ),
            models.Index(
                fields=["organisation", "currency"],
            ),
        ]

    def __str__(self):
        return self.name


class BankTransaction(models.Model):
    class TransactionType(models.TextChoices):
        MONEY_IN = "money_in", "Money in"
        MONEY_OUT = "money_out", "Money out"

    class Status(models.TextChoices):
        UNRECONCILED = "unreconciled", "Unreconciled"
        RECONCILED = "reconciled", "Reconciled"
        IGNORED = "ignored", "Ignored"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="bank_transactions",
    )

    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.PROTECT,
        related_name="transactions",
    )

    transaction_date = models.DateField()

    description = models.CharField(
        max_length=255,
    )

    reference = models.CharField(
        max_length=100,
        blank=True,
    )

    transaction_type = models.CharField(
        max_length=20,
        choices=TransactionType.choices,
    )

    amount = models.DecimalField(
        max_digits=18,
        decimal_places=2,
    )

    currency = models.CharField(
        max_length=3,
    )

    external_id = models.CharField(
        max_length=255,
        blank=True,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.UNRECONCILED,
    )

    accounting_journal = models.ForeignKey(
        JournalEntry,
        on_delete=models.PROTECT,
        related_name="bank_transactions",
        null=True,
        blank=True,
    )

    reconciliation_type = models.CharField(
        max_length=50,
        blank=True,
    )

    reconciliation_object_id = models.UUIDField(
        null=True,
        blank=True,
    )

    reconciled_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    reconciled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bank_transactions_reconciled",
        null=True,
        blank=True,
    )

    unreconciled_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    unreconciled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bank_transactions_unreconciled",
        null=True,
        blank=True,
    )

    unreconciliation_reason = models.TextField(
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bank_transactions_created",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = [
            "-transaction_date",
            "-created_at",
        ]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="bank_transaction_amount_positive",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "bank_account"],
            ),
            models.Index(
                fields=["organisation", "status"],
            ),
            models.Index(
                fields=["organisation", "transaction_date"],
            ),
        ]

    def __str__(self):
        return (
            f"{self.transaction_date} - "
            f"{self.description} - "
            f"{self.amount} {self.currency}"
        )


class BankReconciliationHistory(models.Model):
    class Action(models.TextChoices):
        RECONCILED = "reconciled", "Reconciled"
        UNRECONCILED = "unreconciled", "Unreconciled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.PROTECT,
        related_name="bank_reconciliation_history",
    )
    bank_transaction = models.ForeignKey(
        BankTransaction,
        on_delete=models.PROTECT,
        related_name="reconciliation_history",
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    reconciliation_type = models.CharField(max_length=50)
    reconciliation_object_id = models.UUIDField(null=True, blank=True)
    accounting_journal = models.ForeignKey(
        JournalEntry,
        on_delete=models.PROTECT,
        related_name="bank_reconciliation_history",
        null=True,
        blank=True,
    )
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="bank_reconciliation_actions",
    )
    performed_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-performed_at", "-id"]
        indexes = [
            models.Index(fields=["organisation", "bank_transaction"]),
            models.Index(fields=["organisation", "action"]),
        ]

    def __str__(self):
        return f"{self.bank_transaction_id} - {self.action}"


class BankStatementImport(models.Model):
    class Status(models.TextChoices):
        PENDING="pending", "Pending"; PREVIEWED="previewed", "Previewed"
        COMPLETED="completed", "Completed"; FAILED="failed", "Failed"
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation=models.ForeignKey(Organisation, on_delete=models.PROTECT, related_name="bank_statement_imports")
    bank_account=models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="statement_imports")
    file_name=models.CharField(max_length=255); file_type=models.CharField(max_length=20, default="csv")
    imported_by=models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bank_statement_imports")
    imported_at=models.DateTimeField(null=True, blank=True)
    status=models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    total_rows=models.PositiveIntegerField(default=0); imported_rows=models.PositiveIntegerField(default=0)
    duplicate_rows=models.PositiveIntegerField(default=0); rejected_rows=models.PositiveIntegerField(default=0)
    metadata=models.JSONField(default=dict, blank=True)
    created_at=models.DateTimeField(auto_now_add=True); updated_at=models.DateTimeField(auto_now=True)
    class Meta: ordering=["-created_at"]


class BankStatementImportRow(models.Model):
    class Status(models.TextChoices):
        PENDING="pending", "Pending"; READY="ready", "Ready"; DUPLICATE="duplicate", "Duplicate"
        IMPORTED="imported", "Imported"; REJECTED="rejected", "Rejected"
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    import_batch=models.ForeignKey(BankStatementImport, on_delete=models.PROTECT, related_name="rows")
    row_number=models.PositiveIntegerField(); transaction_date=models.DateField(null=True, blank=True)
    description=models.CharField(max_length=255, blank=True); reference=models.CharField(max_length=100, blank=True)
    amount=models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    transaction_type=models.CharField(max_length=20, choices=BankTransaction.TransactionType.choices, blank=True)
    currency=models.CharField(max_length=3, blank=True); external_id=models.CharField(max_length=255, blank=True)
    fingerprint=models.CharField(max_length=64, blank=True, db_index=True)
    status=models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    bank_transaction=models.OneToOneField(BankTransaction, on_delete=models.PROTECT, null=True, blank=True, related_name="import_row")
    error_message=models.TextField(blank=True); created_at=models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering=["row_number"]
        constraints=[models.UniqueConstraint(fields=["import_batch", "row_number"], name="unique_bank_import_row")]


class BankRule(models.Model):
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation=models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name="bank_rules")
    name=models.CharField(max_length=255); priority=models.PositiveIntegerField(default=100); is_active=models.BooleanField(default=True)
    bank_account=models.ForeignKey(BankAccount, on_delete=models.PROTECT, null=True, blank=True, related_name="rules")
    direction=models.CharField(max_length=20, choices=BankTransaction.TransactionType.choices, blank=True)
    description_contains=models.CharField(max_length=255, blank=True); reference_contains=models.CharField(max_length=100, blank=True)
    min_amount=models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    max_amount=models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    target_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="bank_rules")
    contact=models.ForeignKey(Contact, on_delete=models.PROTECT, null=True, blank=True, related_name="bank_rules")
    memo_template=models.CharField(max_length=255, blank=True)
    created_by=models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bank_rules_created")
    created_at=models.DateTimeField(auto_now_add=True); updated_at=models.DateTimeField(auto_now=True)
    class Meta: ordering=["priority", "id"]
