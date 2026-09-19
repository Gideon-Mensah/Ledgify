from rest_framework import serializers

from .models import Organisation, OrganisationMember


class OrganisationSerializer(serializers.ModelSerializer):
    base_currency = serializers.CharField(required=True)

    def validate_base_currency(self, value):
        from common.currencies import validate_currency_code
        return validate_currency_code(value)

    def validate(self, attrs):
        from apps.fx.account_validation import validate_fx_account
        for field, kind in (("fx_gain_account", "gain"), ("fx_loss_account", "loss")):
            account = attrs.get(field, getattr(self.instance, field, None))
            if account:
                try: validate_fx_account(self.instance, account, kind)
                except serializers.ValidationError as error: raise serializers.ValidationError({field: error.detail}) from None
        if self.instance and "financial_year_start_month" in attrs and attrs["financial_year_start_month"] != self.instance.financial_year_start_month and self.instance.journal_entries.exists():
            raise serializers.ValidationError({"financial_year_start_month":"Use the controlled financial-year workflow after transactions exist."})
        return attrs

    def validate_logo_data(self, value):
        from common.documents import validate_logo
        return validate_logo(value)

    role = serializers.SerializerMethodField()

    class Meta:
        model = Organisation
        fields = [
            "id",
            "name",
            "legal_name", "business_type", "locale", "accounting_start_date",
            "registration_number",
            "tax_number",
            "tax_structure_type", "tax_configuration_version",
            "tax_registered",
            "tax_registration_number",
            "tax_scheme",
            "tax_reporting_currency",
            "tax_period_frequency",
            "tax_effective_date",
            "country_code",
            "base_currency",
            "reporting_currency",
            "fx_gain_account",
            "fx_loss_account",
            "timezone",
            "financial_year_start_month",
            "address_line_1",
            "address_line_2",
            "city",
            "region",
            "postal_code",
            "phone",
            "email",
            "website", "ghana_post_gps", "payment_instructions", "logo_data",
            "is_active",
            "role",
            "created_at",
            "updated_at",
        ]

        read_only_fields = ["tax_structure_type", "tax_configuration_version",
            "id",
            "is_active",
            "role",
            "created_at",
            "updated_at",
        ]

    def get_role(self, obj):
        request = self.context.get("request")

        if not request or not request.user.is_authenticated:
            return None

        membership = obj.members.filter(
            user=request.user,
            is_active=True,
        ).first()

        return membership.role if membership else None


class OrganisationMemberSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = OrganisationMember
        fields = ["id", "organisation", "user", "role", "is_active",
                  "permissions", "joined_at"]
        read_only_fields = ["id", "organisation", "permissions", "joined_at"]

    def get_permissions(self, obj):
        from .permissions import ROLE_PERMISSIONS
        return sorted(ROLE_PERMISSIONS.get(obj.role, ()))
