"""Read-only review of historical consolidation graphs; never repairs/deletes data."""
from django.core.management.base import BaseCommand
from django.test.utils import override_settings
from rest_framework.exceptions import APIException
from apps.consolidation.models import ConsolidationGroup
from apps.consolidation.security import require_group


class Command(BaseCommand):
    help = "Report suspicious consolidation groups using current creator permissions. Read-only; IDs only."

    def handle(self, *args, **options):
        checked = suspicious = 0
        # Audit must work with customer access disabled. This override is local to
        # this management process and does not enable deployed API endpoints.
        with override_settings(ENABLE_CONSOLIDATION=True):
            for group in ConsolidationGroup.objects.select_related("created_by", "parent_organisation").defer("created_by__auth_version"):
                checked += 1
                try:
                    require_group(group, group.created_by)
                except APIException as error:
                    suspicious += 1
                    reason = "creator_lacks_current_access" if error.status_code == 403 else "invalid_relationship"
                    self.stdout.write(f"REVIEW group={group.pk} reason={reason}")
        self.stdout.write(f"Checked {checked}; review {suspicious}. No records changed.")
        self.stdout.write("Current permissions cannot prove historic authorisation; review findings with authorised owners.")
