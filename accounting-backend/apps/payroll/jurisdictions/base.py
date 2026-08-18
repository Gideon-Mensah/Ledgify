from decimal import Decimal


class PayrollJurisdictionAdapter:
    """Country plug-in contract. The base adapter intentionally applies no statutory rules."""
    def validate_employee(self, employee): return []
    def calculate_tax(self, *, employee, taxable_pay, period): return Decimal("0.00")
    def calculate_social_security(self, *, employee, gross_pay, period): return Decimal("0.00")
    def calculate_pension(self, *, employee, pensionable_pay, period): return Decimal("0.00")
