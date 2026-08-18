from django.contrib import admin

from .models import (
    CustomerCreditAllocation,
    CustomerCreditNote,
    CustomerRefund,
    BadDebtWriteOff,
    CustomerPayment,
    CustomerPaymentAllocation,
    Invoice,
    InvoiceLine,
)


@admin.register(CustomerCreditNote)
class CustomerCreditNoteAdmin(admin.ModelAdmin):
    list_display = (
        "credit_note_number", "organisation", "customer", "issue_date",
        "total", "amount_applied", "status",
    )
    list_filter = ("status", "issue_date")
    readonly_fields = (
        "amount_applied", "accounting_journal", "created_at", "updated_at",
    )


@admin.register(CustomerCreditAllocation)
class CustomerCreditAllocationAdmin(admin.ModelAdmin):
    list_display = ("credit_note", "invoice", "amount", "applied_at")
    readonly_fields = ("created_at",)


@admin.register(CustomerRefund)
class CustomerRefundAdmin(admin.ModelAdmin):
    list_display = (
        "customer", "refund_date", "amount", "currency", "status",
    )
    list_filter = ("status", "refund_date")
    readonly_fields = ("accounting_journal", "created_at", "updated_at")


@admin.register(BadDebtWriteOff)
class BadDebtWriteOffAdmin(admin.ModelAdmin):
    list_display = (
        "invoice", "write_off_date", "amount", "bad_debt_account", "status",
    )
    list_filter = ("status", "write_off_date")
    readonly_fields = ("accounting_journal", "created_at", "updated_at")


@admin.register(CustomerPaymentAllocation)
class CustomerPaymentAllocationAdmin(admin.ModelAdmin):
    list_display = ("payment", "invoice", "amount", "status", "allocated_at", "reversed_at")
    search_fields = ("payment__reference", "invoice__invoice_number")
    readonly_fields = (
        "status", "reversed_at", "reversed_by", "reversal_reason", "created_at",
    )

    def has_delete_permission(self, request, obj=None):
        return False


class InvoiceLineInline(admin.TabularInline):
    model = InvoiceLine
    extra = 1
    autocomplete_fields = ("revenue_account",)


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = (
        "invoice_number",
        "customer",
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
        "invoice_number",
        "customer__name",
        "reference",
    )

    autocomplete_fields = (
        "organisation",
        "customer",
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
        InvoiceLineInline,
    )


@admin.register(InvoiceLine)
class InvoiceLineAdmin(admin.ModelAdmin):
    list_display = (
        "invoice",
        "description",
        "quantity",
        "unit_price",
        "tax_amount",
        "line_total",
        "revenue_account",
    )

    search_fields = (
        "invoice__invoice_number",
        "description",
    )

    autocomplete_fields = (
        "invoice",
        "revenue_account",
    )

@admin.register(CustomerPayment)
class CustomerPaymentAdmin(admin.ModelAdmin):
    list_display = (
        "invoice",
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
        "invoice__invoice_number",
        "invoice__customer__name",
        "reference",
    )

    autocomplete_fields = (
        "organisation",
        "invoice",
        "bank_account",
        "accounting_journal",
        "created_by",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )
