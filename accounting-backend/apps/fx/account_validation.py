"""Account ownership and classification checks; no valuation calculations."""
from common.exceptions import BusinessRuleError


def validate_fx_account(organisation, account, kind):
    rules={'gain':('revenue','other_income'),'loss':('expense','other_expense'),
           'receivables':('asset','receivable'),'payables':('liability','payable'),'bank':('asset','bank')}
    if (not organisation or not account or account.organisation_id!=organisation.pk
            or account.status!='active' or (account.account_type,account.account_class)!=rules[kind]):
        raise BusinessRuleError(f"Choose an active organisation account classified for FX {kind}.")
