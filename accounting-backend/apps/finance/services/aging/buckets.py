from dataclasses import dataclass


@dataclass(frozen=True)
class AgingBucket:
    key: str
    label: str
    min_days: int | None
    max_days: int | None


AGING_BUCKETS = [
    AgingBucket(
        key="current",
        label="Current",
        min_days=None,
        max_days=0,
    ),
    AgingBucket(
        key="1_30",
        label="1-30 days",
        min_days=1,
        max_days=30,
    ),
    AgingBucket(
        key="31_60",
        label="31-60 days",
        min_days=31,
        max_days=60,
    ),
    AgingBucket(
        key="61_90",
        label="61-90 days",
        min_days=61,
        max_days=90,
    ),
    AgingBucket(
        key="90_plus",
        label="90+ days",
        min_days=91,
        max_days=None,
    ),
]


def get_aging_bucket(days_overdue):
    if days_overdue <= 0:
        return "current"

    if days_overdue <= 30:
        return "1_30"

    if days_overdue <= 60:
        return "31_60"

    if days_overdue <= 90:
        return "61_90"

    return "90_plus"
