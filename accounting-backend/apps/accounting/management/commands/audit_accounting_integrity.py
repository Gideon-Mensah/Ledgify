"""Read-only prerequisite for Phase 2 migrations; never repairs historical data."""
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count
from apps.accounting.models import AccountingPeriod, OpeningBalance


class Command(BaseCommand):
    help = "Read-only audit of ambiguous opening balances and overlapping accounting periods."

    def handle(self, *args, **options):
        problems = 0
        for row in OpeningBalance.objects.filter(status="posted").values("organisation_id", "opening_date").annotate(count=Count("id")).filter(count__gt=1):
            problems += 1
            self.stdout.write(f"Duplicate posted opening balance: organisation={row['organisation_id']} date={row['opening_date']} count={row['count']}")
        previous = {}
        for period in AccountingPeriod.objects.order_by("organisation_id", "start_date", "end_date"):
            old = previous.get(period.organisation_id)
            if old and period.start_date <= old.end_date:
                problems += 1
                self.stdout.write(f"Overlapping periods: organisation={period.organisation_id} periods={old.pk},{period.pk}")
            if old is None or period.end_date > old.end_date:
                previous[period.organisation_id] = period
        from django.db import connection
        from apps.organisations.models import Organisation
        from common.currencies import SUPPORTED_CURRENCIES
        unsupported=Organisation.objects.exclude(base_currency__in=SUPPORTED_CURRENCIES).count()
        if unsupported:
            problems+=unsupported
            self.stdout.write(f"Organisations with unsupported base-currency precision: {unsupported}. Review separately; no currency was converted.")
        with connection.cursor() as cursor:
            for table in ("sales_customerpaymentallocation","purchases_supplierpaymentallocation","sales_customercreditallocation","purchases_suppliercreditallocation"):
                columns={column.name for column in connection.introspection.get_table_description(cursor,table)}
                predicate=" WHERE effective_date IS NULL" if "effective_date" in columns else ""
                cursor.execute(f"SELECT count(*) FROM {table}{predicate}")
                count=cursor.fetchone()[0]
                if count:
                    problems+=count
                    self.stdout.write(f"Legacy accounting dates requiring review: {table} count={count}")
        if problems:
            raise CommandError(f"Found {problems} ambiguous groups. Review and approve a separate remediation; no data was changed.")
        self.stdout.write("No duplicate posted opening dates, overlapping periods, unsupported base currencies or undated allocations found. No data was changed.")
