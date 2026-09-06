"""Currency validation shared by organisation-scoped writable resources."""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from common.currencies import validate_currency_code


class OrganisationCurrencyDefault:
    requires_context = True

    def __call__(self, field):
        organisation = field.context.get("organisation")
        if organisation is None:
            view = field.context.get("view")
            if view is not None and hasattr(view, "get_organisation"):
                organisation = view.get_organisation()
        if organisation is None:
            raise serializers.ValidationError("Select an organisation before choosing a currency.")
        try:
            return validate_currency_code(organisation.base_currency)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.messages) from error


class CurrencyCodeField(serializers.CharField):
    def run_validation(self, data=serializers.empty):
        if isinstance(data, str) and not data.strip():
            data = OrganisationCurrencyDefault()(self)
        return super().run_validation(data)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return validate_currency_code(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.messages) from error

    def to_representation(self, value):
        # Recognised legacy labels are safe to display; unknown data stays visible
        # to the audit command and is never replaced with a different currency.
        code = str(value or "").strip().upper()
        return "GHS" if code in {"GH¢", "GH₵", "GHC"} else code


class CurrencySerializerMixin:
    def get_fields(self):
        fields = super().get_fields()
        field = fields.get("currency")
        if isinstance(field, serializers.CharField) and not field.read_only:
            fields["currency"] = CurrencyCodeField(default=OrganisationCurrencyDefault())
        return fields
