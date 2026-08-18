from rest_framework import serializers

from .models import Contact


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = [
            "id",
            "name",
            "account_number",
            "contact_name",
            "email",
            "phone",
            "website",
            "registration_number",
            "tax_number",
            "is_customer",
            "is_supplier",
            "payment_terms",
            "currency",
            "credit_limit",
            "address_line_1",
            "address_line_2",
            "city",
            "region",
            "postal_code",
            "country_code",
            "notes",
            "status",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
        ]

    def validate_account_number(self, value):
        value = value.strip()
        if not value:
            return value
        organisation = self.context.get("organisation")
        if organisation is None:
            return value
        matches = Contact.objects.filter(
            organisation=organisation,
            account_number__iexact=value,
        )
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        if matches.exists():
            raise serializers.ValidationError(
                "A contact with this account number already exists."
            )
        return value
