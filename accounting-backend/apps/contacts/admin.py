from django.contrib import admin

from .models import Contact


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "account_number",
        "organisation",
        "is_customer",
        "is_supplier",
        "currency",
        "status",
    )

    list_filter = (
        "is_customer",
        "is_supplier",
        "status",
        "currency",
        "country_code",
    )

    search_fields = (
        "name",
        "account_number",
        "contact_name",
        "email",
        "phone",
        "tax_number",
    )

    autocomplete_fields = (
        "organisation",
        "created_by",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )