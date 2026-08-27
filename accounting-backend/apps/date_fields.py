"""Strict, user-friendly serializer fields for accounting calendar dates."""

from rest_framework import serializers


def accounting_date(label="date", **kwargs):
    """Accept only canonical ISO calendar dates and identify the affected field."""
    return serializers.DateField(
        input_formats=["%Y-%m-%d"],
        error_messages={
            "invalid": f"Enter a valid {label} in YYYY-MM-DD format.",
        },
        **kwargs,
    )
