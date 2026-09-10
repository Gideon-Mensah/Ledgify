"""Explicit open calendar fixtures for workflow tests (never imported by production)."""
import calendar
from datetime import date
from apps.accounting.models import AccountingPeriod


def calendar_periods(organisation):
    for year in (2025, 2026, 2027):
        for month in range(1, 13):
            start, end = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
            if not AccountingPeriod.objects.filter(organisation=organisation, start_date__lte=end, end_date__gte=start).exists():
                AccountingPeriod.objects.create(organisation=organisation, name=f"{year}-{month:02}", start_date=start, end_date=end)
