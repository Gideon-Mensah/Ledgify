"""Give the AI structured ratios so it explains results instead of recalculating them."""

from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.finance.services.analysis import get_ratio_analysis


def get_financial_ratio_analysis(*, organisation, start_date=None, end_date=None,
                                 comparison_start_date=None, comparison_end_date=None):
    end = parse_date(end_date) if isinstance(end_date, str) else end_date
    end = end or timezone.localdate()
    start = parse_date(start_date) if isinstance(start_date, str) else start_date
    start = start or end.replace(month=1, day=1)
    comparison_start = parse_date(comparison_start_date) if isinstance(comparison_start_date, str) else comparison_start_date
    comparison_end = parse_date(comparison_end_date) if isinstance(comparison_end_date, str) else comparison_end_date
    if comparison_start is None and comparison_end is None:
        duration = end - start
        comparison_end = start - timedelta(days=1)
        comparison_start = comparison_end - duration
    return get_ratio_analysis(
        organisation=organisation, start_date=start, end_date=end,
        comparison_start_date=comparison_start, comparison_end_date=comparison_end,
    )
