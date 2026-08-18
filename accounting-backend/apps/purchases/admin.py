from django.contrib import admin

from .models import (
    Bill,
    BillLine,
    SupplierCredit,
    SupplierCreditAllocation,
    SupplierRefund,
    SupplierPaymentAllocation,
)


@admin.register(SupplierCredit)
class SupplierCreditAdmin(admin.ModelAdmin):
    list_display = (
        "credit_number", "organisation", "supplier", "issue_date",
        "total", "amount_applied", "status",
    )
    list_filter = ("status", "issue_date")
    search_fields = ("credit_number", "supplier__name", "reference")
    readonly_fields = (
        "amount_applied", "accounting_journal", "created_at", "updated_at",
    )


@admin.register(SupplierCreditAllocation)
class SupplierCreditAllocationAdmin(admin.ModelAdmin):
    list_display = ("credit", "bill", "amount", "applied_at")
    readonly_fields = ("created_at",)


@admin.register(SupplierRefund)
class SupplierRefundAdmin(admin.ModelAdmin):
    list_display = (
        "supplier", "supplier_credit", "refund_date", "amount", "status",
    )
    list_filter = ("status", "refund_date")
    search_fields = (
        "supplier__name", "supplier_credit__credit_number", "reference",
    )
    autocomplete_fields = (
        "organisation", "supplier", "supplier_credit", "bank_account",
        "accounting_journal", "created_by",
    )
    readonly_fields = ("accounting_journal", "created_at", "updated_at")


@admin.register(SupplierPaymentAllocation)
class SupplierPaymentAllocationAdmin(admin.ModelAdmin):
    list_display = ("payment", "bill", "amount", "status", "allocated_at", "reversed_at")
    search_fields = ("payment__reference", "bill__bill_number")
    readonly_fields = (
        "status", "reversed_at", "reversed_by", "reversal_reason", "created_at",
    )

    def has_delete_permission(self, request, obj=None):
        return False


class BillLineInline(admin.TabularInline):
    model = BillLine
    extra = 1
    autocomplete_fields = (
        "expense_account",
    )

from .models import SupplierPayment


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = (
        "bill_number",
        "supplier",
        "organisation",
        "issue_date",
        "due_date",
        "currency",
        "total",
        "amount_paid",
        "status",
    )

    list_filter = (
        "status",
        "currency",
        "issue_date",
    )

    search_fields = (
        "bill_number",
        "supplier__name",
        "supplier_reference",
    )

    autocomplete_fields = (
        "organisation",
        "supplier",
        "accounting_journal",
        "created_by",
    )

    readonly_fields = (
        "subtotal",
        "tax_total",
        "total",
        "amount_paid",
        "created_at",
        "updated_at",
    )

    inlines = (
        BillLineInline,
    )


@admin.register(BillLine)
class BillLineAdmin(admin.ModelAdmin):
    list_display = (
        "bill",
        "description",
        "quantity",
        "unit_price",
        "tax_amount",
        "line_total",
        "expense_account",
    )

    search_fields = (
        "bill__bill_number",
        "description",
    )

    autocomplete_fields = (
        "bill",
        "expense_account",
    )

@admin.register(SupplierPayment)
class SupplierPaymentAdmin(admin.ModelAdmin):
    list_display = (
        "bill",
        "organisation",
        "payment_date",
        "amount",
        "currency",
        "bank_account",
        "status",
    )

    list_filter = (
        "status",
        "currency",
        "payment_date",
    )

    search_fields = (
        "bill__bill_number",
        "bill__supplier__name",
        "reference",
    )

    autocomplete_fields = (
        "organisation",
        "bill",
        "bank_account",
        "accounting_journal",
        "created_by",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )
