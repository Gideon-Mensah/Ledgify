from django.contrib import admin

from .models import BankAccount, BankReconciliationHistory, BankTransaction


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "organisation",
        "bank_name",
        "currency",
        "ledger_account",
        "status",
    )

    list_filter = (
        "status",
        "currency",
        "organisation",
    )

    search_fields = (
        "name",
        "bank_name",
        "account_number",
        "iban",
        "swift_bic",
    )

    autocomplete_fields = (
        "organisation",
        "ledger_account",
        "created_by",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )


@admin.register(BankTransaction)
class BankTransactionAdmin(admin.ModelAdmin):
    list_display = (
        "transaction_date",
        "description",
        "bank_account",
        "transaction_type",
        "amount",
        "currency",
        "status",
        "reconciliation_type",
        "reconciliation_object_id",
        "reconciled_at",
        "unreconciled_at",
    )

    list_filter = (
        "status",
        "transaction_type",
        "currency",
    )

    search_fields = (
        "description",
        "reference",
        "external_id",
    )

    autocomplete_fields = (
        "organisation",
        "bank_account",
        "accounting_journal",
        "reconciled_by",
        "created_by",
    )

    readonly_fields = (
        "reconciliation_type",
        "reconciliation_object_id",
        "reconciled_at",
        "unreconciled_at",
        "unreconciled_by",
        "unreconciliation_reason",
        "created_at",
        "updated_at",
    )


@admin.register(BankReconciliationHistory)
class BankReconciliationHistoryAdmin(admin.ModelAdmin):
    list_display = (
        "bank_transaction",
        "action",
        "reconciliation_type",
        "reconciliation_object_id",
        "performed_by",
        "performed_at",
    )
    list_filter = ("action", "reconciliation_type", "organisation")
    search_fields = ("bank_transaction__description", "reason")
    readonly_fields = (
        "id", "organisation", "bank_transaction", "action",
        "reconciliation_type", "reconciliation_object_id",
        "accounting_journal", "performed_by", "performed_at",
        "reason", "metadata",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
