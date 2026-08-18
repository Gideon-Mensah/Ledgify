from rest_framework import serializers

from .models import Organisation, OrganisationMember


class OrganisationSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = Organisation
        fields = [
            "id",
            "name",
            "legal_name",
            "registration_number",
            "tax_number",
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
            "website",
            "is_active",
            "role",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
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
