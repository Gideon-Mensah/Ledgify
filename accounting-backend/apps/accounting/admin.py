from django.contrib import admin

from .models import (
    Account,
    AccountingPeriodHistory,
    AccountingPeriod,
    FinancialYear,
    FinancialYearHistory,
    JournalEntry,
    JournalLine,
)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "name",
        "organisation",
        "account_type",
        "account_class",
        "cash_flow_category",
        "status",
        "is_system_account",
    )

    list_filter = (
        "account_type",
        "account_class",
        "cash_flow_category",
        "status",
        "is_system_account",
    )

    search_fields = (
        "code",
        "name",
        "description",
        "organisation__name",
    )

    autocomplete_fields = (
        "organisation",
        "created_by",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )

    ordering = (
        "organisation",
        "code",
    )


class JournalLineInline(admin.TabularInline):
    model = JournalLine
    extra = 2
    autocomplete_fields = ("account",)


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = (
        "entry_number",
        "organisation",
        "date",
        "reference",
        "source_type",
        "status",
        "posted_at",
    )

    list_filter = (
        "status",
        "source_type",
        "date",
    )

    search_fields = (
        "entry_number",
        "reference",
        "description",
        "organisation__name",
    )

    autocomplete_fields = (
        "organisation",
        "created_by",
        "posted_by",
        "reversal_of",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
        "posted_at",
    )

    inlines = (
        JournalLineInline,
    )
    def get_readonly_fields(self, request, obj=None):
        if obj and obj.status in {JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED}:
            return tuple(field.name for field in obj._meta.fields)
        return self.readonly_fields
    def has_delete_permission(self, request, obj=None):
        return not obj or obj.status == JournalEntry.Status.DRAFT


@admin.register(JournalLine)
class JournalLineAdmin(admin.ModelAdmin):
    list_display = (
        "journal_entry",
        "account",
        "debit",
        "credit",
    )

    search_fields = (
        "journal_entry__entry_number",
        "account__code",
        "account__name",
        "description",
    )

    autocomplete_fields = (
        "journal_entry",
        "account",
    )

    readonly_fields = (
        "created_at",
    )
    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request,obj) and (not obj or obj.journal_entry.status==JournalEntry.Status.DRAFT)
    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request,obj) and (not obj or obj.journal_entry.status==JournalEntry.Status.DRAFT)

@admin.register(AccountingPeriod)
class AccountingPeriodAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "organisation",
        "start_date",
        "end_date",
        "status",
        "locked_at",
    )

    list_filter = (
        "status",
        "organisation",
    )

    search_fields = (
        "name",
        "organisation__name",
    )

    autocomplete_fields = (
        "organisation",
        "locked_by",
    )

    readonly_fields = (
        "locked_at",
        "created_at",
        "updated_at",
    )


@admin.register(FinancialYear)
class FinancialYearAdmin(admin.ModelAdmin):
    list_display = (
        "name", "organisation", "start_date", "end_date", "status",
        "profit_or_loss", "closing_journal", "closed_at",
    )
    list_filter = ("status", "organisation")
    search_fields = ("name", "organisation__name")
    autocomplete_fields = (
        "organisation", "closing_journal", "closing_reversal_journal", "closed_by",
    )
    readonly_fields = (
        "status", "closing_journal", "closing_reversal_journal",
        "profit_or_loss", "closed_at", "closed_by", "created_at", "updated_at",
    )


class ReadOnlyHistoryAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(FinancialYearHistory)
class FinancialYearHistoryAdmin(ReadOnlyHistoryAdmin):
    list_display = (
        "financial_year", "action", "performed_by", "performed_at",
        "accounting_journal",
    )
    list_filter = ("action", "organisation")
    readonly_fields = (
        "id", "organisation", "financial_year", "action", "performed_by",
        "performed_at", "reason", "accounting_journal", "metadata",
    )


@admin.register(AccountingPeriodHistory)
class AccountingPeriodHistoryAdmin(ReadOnlyHistoryAdmin):
    list_display = (
        "accounting_period", "action", "performed_by", "performed_at",
    )
    list_filter = ("action", "organisation")
    readonly_fields = (
        "id", "organisation", "accounting_period", "action", "performed_by",
        "performed_at", "reason", "metadata",
    )
