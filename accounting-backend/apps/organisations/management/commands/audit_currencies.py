"""Read-only audit: identify unknown currency values without guessing replacements."""
from django.apps import apps
from django.core.management.base import BaseCommand
from common.currencies import SUPPORTED_CURRENCIES, LEGACY_GHANA_CURRENCY_VALUES


class Command(BaseCommand):
    help = "Report currency fields requiring manual review; never modifies data."

    def handle(self, *args, **options):
        names = {"currency", "base_currency", "reporting_currency", "tax_reporting_currency", "transaction_currency", "source_currency", "foreign_currency"}
        for model in apps.get_models():
            for field in model._meta.local_fields:
                if field.name not in names or field.is_relation:
                    continue
                values = model.objects.exclude(**{f"{field.name}__in": [*SUPPORTED_CURRENCIES, ""]}).values_list(field.name, flat=True).distinct()
                for value in values:
                    count = model.objects.filter(**{field.name: value}).count()
                    kind = "recognised legacy GHS" if value in LEGACY_GHANA_CURRENCY_VALUES else "unknown; manual review required"
                    self.stdout.write(f"{model._meta.label}.{field.name}: {count} record(s), {kind}")
