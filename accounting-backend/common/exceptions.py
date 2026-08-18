from rest_framework.exceptions import ValidationError


class BusinessRuleError(ValidationError):
    default_code = "business_rule_error"