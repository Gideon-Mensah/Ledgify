from abc import ABC, abstractmethod


class TaxJurisdictionAdapter(ABC):
    @abstractmethod
    def validate(self, *, organisation, totals): ...

    @abstractmethod
    def map_totals(self, totals): ...

    @abstractmethod
    def format_filing_payload(self, mapped_totals): ...
