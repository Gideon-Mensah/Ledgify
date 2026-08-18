"""Rank bank matches using deterministic evidence without changing accounting data."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


@dataclass
class ReconciliationSuggestion:
    match_type: str
    object_id: str
    label: str
    amount: Decimal
    confidence: int
    reasons: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
