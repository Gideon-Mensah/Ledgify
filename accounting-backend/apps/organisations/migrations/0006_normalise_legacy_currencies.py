from importlib import import_module
from django.db import migrations, models
from common.currencies import validate_currency_code


def normalise_legacy(apps, schema_editor):
    # Re-run the idempotent, recognised-values-only cleanup for records written
    # since 0005. Unknown values and existing valid codes remain untouched.
    module = import_module("apps.organisations.migrations.0005_alter_organisation_base_currency_and_more")
    module.normalise_legacy_ghanaian_currency_values(apps, schema_editor)


class Migration(migrations.Migration):
    dependencies = [("organisations", "0005_alter_organisation_base_currency_and_more")]
    operations = [
        migrations.RunPython(normalise_legacy, migrations.RunPython.noop),
        migrations.AlterField(model_name="organisation", name="base_currency",
                              field=models.CharField(max_length=3, validators=[validate_currency_code])),
    ]
