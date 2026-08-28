"""Ledger accounts, journals, periods, and safeguards for immutable posted accounting."""

import uuid

from django.conf import settings
from django.db import models

from apps.organisations.models import Organisation


class Account(models.Model):
    class AccountType(models.TextChoices):
        ASSET = "asset", "Asset"
        LIABILITY = "liability", "Liability"
        EQUITY = "equity", "Equity"
        REVENUE = "revenue", "Revenue"
        EXPENSE = "expense", "Expense"

    class AccountClass(models.TextChoices):
        BANK = "bank", "Bank"
        CURRENT_ASSET = "current_asset", "Current Asset"
        FIXED_ASSET = "fixed_asset", "Fixed Asset"
        RECEIVABLE = "receivable", "Accounts Receivable"

        CURRENT_LIABILITY = "current_liability", "Current Liability"
        LONG_TERM_LIABILITY = "long_term_liability", "Long-term Liability"
        PAYABLE = "payable", "Accounts Payable"

        EQUITY = "equity", "Equity"
        RETAINED_EARNINGS = "retained_earnings", "Retained earnings"

        SALES = "sales", "Sales"
        OTHER_INCOME = "other_income", "Other Income"

        COST_OF_SALES = "cost_of_sales", "Cost of Sales"
        OPERATING_EXPENSE = "operating_expense", "Operating Expense"
        OTHER_EXPENSE = "other_expense", "Other Expense"

    class CashFlowCategory(models.TextChoices):
        OPERATING = "operating", "Operating activities"
        INVESTING = "investing", "Investing activities"
        FINANCING = "financing", "Financing activities"
        CASH = "cash", "Cash and cash equivalents"
        NOT_APPLICABLE = "not_applicable", "Not applicable"

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
        related_name="accounts",
    )

    code = models.CharField(
        max_length=20,
    )

    name = models.CharField(
        max_length=255,
    )

    account_type = models.CharField(
        max_length=20,
        choices=AccountType.choices,
    )

    account_class = models.CharField(
        max_length=30,
        choices=AccountClass.choices,
    )

    cash_flow_category = models.CharField(
        max_length=30,
        choices=CashFlowCategory.choices,
        default=CashFlowCategory.NOT_APPLICABLE,
    )

    description = models.TextField(
        blank=True,
    )

    currency = models.CharField(
        max_length=3,
        blank=True,
    )

    is_system_account = models.BooleanField(
        default=False,
    )

    allow_manual_journals = models.BooleanField(
        default=True,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accounts_created",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["code"]

        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "code"],
                name="unique_account_code_per_organisation",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "account_type"],
            ),
            models.Index(
                fields=["organisation", "account_class"],
            ),
            models.Index(
                fields=["organisation", "status"],
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"


class AccountImportBatch(models.Model):
    class Status(models.TextChoices):
        READY = "ready", "Ready"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name="account_import_batches")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="account_imports_uploaded")
    confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="account_imports_confirmed")
    original_filename = models.CharField(max_length=255)
    checksum = models.CharField(max_length=64)
    template_version = models.CharField(max_length=20, default="1")
    import_mode = models.CharField(max_length=30, default="stop_on_existing")
    rows = models.JSONField(default=list)
    total_rows = models.PositiveIntegerField(default=0)
    valid_rows = models.PositiveIntegerField(default=0)
    invalid_rows = models.PositiveIntegerField(default=0)
    existing_rows = models.PositiveIntegerField(default=0)
    created_account_ids = models.JSONField(default=list)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.READY)
    failure_reason = models.TextField(blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-uploaded_at"]

class JournalEntry(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        REVERSED = "reversed", "Reversed"

    class SourceType(models.TextChoices):
        MANUAL = "manual", "Manual"
        INVOICE = "invoice", "Invoice"
        BILL = "bill", "Bill"
        PAYMENT = "payment", "Payment"
        BANK = "bank", "Bank"
        ADJUSTMENT = "adjustment", "Adjustment"
        CUSTOMER_CREDIT = "customer_credit", "Customer Credit"
        SUPPLIER_CREDIT = "supplier_credit", "Supplier Credit"
        CUSTOMER_REFUND = "customer_refund", "Customer Refund"
        BAD_DEBT = "bad_debt", "Bad Debt"
        SUPPLIER_REFUND = "supplier_refund", "Supplier Refund"
        BANK_TRANSFER = "bank_transfer", "Bank Transfer"
        YEAR_END_CLOSE = "year_end_close", "Year-end Close"
        INVENTORY_ADJUSTMENT = "inventory_adjustment", "Inventory adjustment"
        INVENTORY_RECEIPT = "inventory_receipt", "Inventory receipt"
        INVENTORY_ISSUE = "inventory_issue", "Inventory issue"
        CUSTOMER_RETURN = "customer_return", "Customer return"
        SUPPLIER_RETURN = "supplier_return", "Supplier return"
        STOCK_COUNT = "stock_count", "Stock count"
        FIXED_ASSET_ACQUISITION = "fixed_asset_acquisition", "Fixed asset acquisition"
        DEPRECIATION = "depreciation", "Depreciation"
        FIXED_ASSET_DISPOSAL = "fixed_asset_disposal", "Fixed asset disposal"
        PAYROLL = "payroll", "Payroll"
        PAYROLL_PAYMENT = "payroll_payment", "Payroll payment"
        FX_REVALUATION = "fx_revaluation", "FX revaluation"
        FX_REALISED = "fx_realised", "Realised FX"
        MANUFACTURING_MATERIAL_ISSUE = "manufacturing_material_issue", "Manufacturing material issue"
        MANUFACTURING_COMPLETION = "manufacturing_completion", "Manufacturing completion"
        MANUFACTURING_COST = "manufacturing_cost", "Manufacturing cost"
        MANUFACTURING_VARIANCE = "manufacturing_variance", "Manufacturing variance"
        OPENING_BALANCE = "opening_balance", "Opening Balance"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="journal_entries",
    )

    entry_number = models.CharField(
        max_length=50,
    )

    date = models.DateField()

    reference = models.CharField(
        max_length=100,
        blank=True,
    )

    description = models.TextField(
        blank=True,
    )

    source_type = models.CharField(
        max_length=30,
        choices=SourceType.choices,
        default=SourceType.MANUAL,
    )

    source_id = models.UUIDField(
        null=True,
        blank=True,
    )
    transaction_currency = models.CharField(max_length=3, blank=True)
    transaction_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=20, decimal_places=10, null=True, blank=True)

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="journal_entries_created",
    )

    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="journal_entries_posted",
        null=True,
        blank=True,
    )

    posted_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    reversal_of = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        related_name="reversal_entry",
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["-date", "-created_at"]

        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "entry_number"],
                name="unique_journal_entry_number_per_organisation",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "date"],
            ),
            models.Index(
                fields=["organisation", "status"],
            ),
            models.Index(
                fields=["organisation", "source_type"],
            ),
        ]

    def __str__(self):
        return f"{self.entry_number} - {self.date}"


# Reversal accounting is additive: the original posted entry remains effective
# alongside the separate entry that reverses it.
LEDGER_EFFECTIVE_JOURNAL_STATUSES = (
    JournalEntry.Status.POSTED,
    JournalEntry.Status.REVERSED,
)


class JournalLine(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    journal_entry = models.ForeignKey(
        JournalEntry,
        on_delete=models.CASCADE,
        related_name="lines",
    )

    account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="journal_lines",
    )

    description = models.CharField(
        max_length=255,
        blank=True,
    )

    debit = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=0,
    )

    credit = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=0,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = ["created_at"]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(debit__gte=0),
                name="journal_line_debit_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(credit__gte=0),
                name="journal_line_credit_non_negative",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(debit__gt=0, credit=0)
                    | models.Q(credit__gt=0, debit=0)
                ),
                name="journal_line_has_debit_or_credit",
            ),
        ]

    def __str__(self):
        return f"{self.journal_entry.entry_number} - {self.account}"
    
    def save(self, *args, **kwargs):
        if self.pk:
            previous = JournalEntry.objects.filter(
                pk=self.pk
            ).first()

            if (
                previous
                and previous.status == JournalEntry.Status.POSTED
                and self.status == JournalEntry.Status.POSTED
            ):
                protected_fields = [
                    "organisation_id",
                    "entry_number",
                    "date",
                    "reference",
                    "description",
                    "source_type",
                    "source_id",
                ]

                for field in protected_fields:
                    if getattr(previous, field) != getattr(self, field):
                        from common.exceptions import BusinessRuleError

                        raise BusinessRuleError(
                            "Posted journal entries cannot be edited. "
                            "Reverse the journal instead."
                        )

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status in {
            JournalEntry.Status.POSTED,
            JournalEntry.Status.REVERSED,
        }:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Posted or reversed journal entries cannot be deleted."
            )

        return super().delete(*args, **kwargs)
    def save(self, *args, **kwargs):
        if (
            self.journal_entry_id
            and self.journal_entry.status
            in {
                JournalEntry.Status.POSTED,
                JournalEntry.Status.REVERSED,
            }
        ):
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Lines belonging to posted or reversed journals "
                "cannot be edited."
            )

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.journal_entry.status in {
            JournalEntry.Status.POSTED,
            JournalEntry.Status.REVERSED,
        }:
            from common.exceptions import BusinessRuleError

            raise BusinessRuleError(
                "Lines belonging to posted or reversed journals "
                "cannot be deleted."
            )

        return super().delete(*args, **kwargs)

class JournalSequence(models.Model):
    organisation = models.OneToOneField(
        Organisation,
        on_delete=models.CASCADE,
        related_name="journal_sequence",
    )

    last_number = models.PositiveBigIntegerField(
        default=0,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def __str__(self):
        return (
            f"{self.organisation.name} - "
            f"Last journal number: {self.last_number}"
        )
        
class AccountingPeriod(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        LOCKED = "locked", "Locked"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="accounting_periods",
    )

    name = models.CharField(
        max_length=100,
    )

    start_date = models.DateField()

    end_date = models.DateField()

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )

    locked_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    locked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accounting_periods_locked",
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["start_date"]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="accounting_period_end_after_start",
            )
        ]

        indexes = [
            models.Index(
                fields=["organisation", "start_date", "end_date"],
            ),
            models.Index(
                fields=["organisation", "status"],
            ),
        ]

    def __str__(self):
        return f"{self.name} - {self.organisation.name}"


class FinancialYear(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name="financial_years",
    )
    name = models.CharField(max_length=100)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    closing_journal = models.OneToOneField(
        JournalEntry,
        on_delete=models.PROTECT,
        related_name="financial_year_closed",
        null=True,
        blank=True,
    )
    closing_reversal_journal = models.OneToOneField(
        JournalEntry,
        on_delete=models.PROTECT,
        related_name="financial_year_reopened",
        null=True,
        blank=True,
    )
    profit_or_loss = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        null=True,
        blank=True,
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="financial_years_closed",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="financial_year_end_after_start",
            ),
            models.UniqueConstraint(
                fields=["organisation", "name"],
                name="unique_financial_year_name_per_organisation",
            ),
        ]
        indexes = [
            models.Index(fields=["organisation", "status"]),
            models.Index(fields=["organisation", "start_date", "end_date"]),
        ]

    def __str__(self):
        return f"{self.name} - {self.organisation.name}"


class FinancialYearHistory(models.Model):
    class Action(models.TextChoices):
        CLOSED = "closed", "Closed"
        REOPENED = "reopened", "Reopened"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.PROTECT,
        related_name="financial_year_history",
    )
    financial_year = models.ForeignKey(
        FinancialYear,
        on_delete=models.PROTECT,
        related_name="history",
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="financial_year_actions",
    )
    performed_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True)
    accounting_journal = models.ForeignKey(
        JournalEntry,
        on_delete=models.PROTECT,
        related_name="financial_year_history",
        null=True,
        blank=True,
    )
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-performed_at", "-id"]
        indexes = [models.Index(fields=["organisation", "financial_year"])]

    def __str__(self):
        return f"{self.financial_year} - {self.action}"


class AccountingPeriodHistory(models.Model):
    class Action(models.TextChoices):
        LOCKED = "locked", "Locked"
        REOPENED = "reopened", "Reopened"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.PROTECT,
        related_name="accounting_period_history",
    )
    accounting_period = models.ForeignKey(
        AccountingPeriod,
        on_delete=models.PROTECT,
        related_name="history",
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accounting_period_actions",
    )
    performed_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-performed_at", "-id"]
        indexes = [models.Index(fields=["organisation", "accounting_period"])]


class OpeningBalance(models.Model):
    class Status(models.TextChoices):
        DRAFT="draft","Draft";SUBMITTED="submitted","Submitted for approval";POSTED="posted","Posted";REJECTED="rejected","Rejected";REVERSED="reversed","Reversed"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    organisation=models.ForeignKey(Organisation,on_delete=models.CASCADE,related_name="opening_balances")
    opening_date=models.DateField();reference=models.CharField(max_length=100,blank=True);description=models.TextField(blank=True)
    status=models.CharField(max_length=20,choices=Status.choices,default=Status.DRAFT)
    journal=models.OneToOneField(JournalEntry,on_delete=models.PROTECT,null=True,blank=True,related_name="opening_balance_record")
    reversal_journal=models.OneToOneField(JournalEntry,on_delete=models.PROTECT,null=True,blank=True,related_name="opening_balance_reversal_record")
    created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="opening_balances_created")
    updated_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="opening_balances_updated")
    posted_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,null=True,blank=True,related_name="opening_balances_posted")
    created_at=models.DateTimeField(auto_now_add=True);updated_at=models.DateTimeField(auto_now=True);posted_at=models.DateTimeField(null=True,blank=True)
    class Meta:
        ordering=["-opening_date","-created_at"];indexes=[models.Index(fields=["organisation","status"]),models.Index(fields=["organisation","opening_date"])]


class OpeningBalanceLine(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    opening_balance=models.ForeignKey(OpeningBalance,on_delete=models.CASCADE,related_name="lines")
    account=models.ForeignKey(Account,on_delete=models.PROTECT,related_name="opening_balance_lines")
    debit=models.DecimalField(max_digits=18,decimal_places=2,default=0);credit=models.DecimalField(max_digits=18,decimal_places=2,default=0)
    unusual_side_confirmed=models.BooleanField(default=False)
    class Meta:
        ordering=["account__code"];constraints=[models.UniqueConstraint(fields=["opening_balance","account"],name="unique_opening_balance_account")]
