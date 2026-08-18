from django.contrib import admin

from .models import Organisation, OrganisationMember


class OrganisationMemberInline(admin.TabularInline):
    model = OrganisationMember
    extra = 0
    autocomplete_fields = ("user",)


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "country_code",
        "base_currency",
        "city",
        "is_active",
        "created_at",
    )

    list_filter = (
        "country_code",
        "base_currency",
        "is_active",
    )

    search_fields = (
        "name",
        "legal_name",
        "registration_number",
        "email",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )

    inlines = (
        OrganisationMemberInline,
    )


@admin.register(OrganisationMember)
class OrganisationMemberAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "organisation",
        "role",
        "is_active",
        "joined_at",
    )

    list_filter = (
        "role",
        "is_active",
    )

    search_fields = (
        "user__email",
        "user__first_name",
        "user__last_name",
        "organisation__name",
    )

    autocomplete_fields = (
        "user",
        "organisation",
    )

    readonly_fields = (
        "joined_at",
    )