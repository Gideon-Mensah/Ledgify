from common.exceptions import BusinessRuleError
from apps.banking.models import BankRule
from apps.banking.services.transactions import reconcile_bank_transaction_to_account


def match_bank_rules(*, organisation, bank_transaction):
    if bank_transaction.organisation_id != organisation.id: raise BusinessRuleError("Transaction belongs to another organisation.")
    matches=[]
    for rule in BankRule.objects.filter(organisation=organisation, is_active=True).select_related("target_account").order_by("priority", "id"):
        if rule.bank_account_id and rule.bank_account_id != bank_transaction.bank_account_id: continue
        if rule.direction and rule.direction != bank_transaction.transaction_type: continue
        if rule.description_contains and rule.description_contains.lower() not in bank_transaction.description.lower(): continue
        if rule.reference_contains and rule.reference_contains.lower() not in bank_transaction.reference.lower(): continue
        if rule.min_amount is not None and bank_transaction.amount < rule.min_amount: continue
        if rule.max_amount is not None and bank_transaction.amount > rule.max_amount: continue
        matches.append({"match_type": "bank_rule", "rule_id": str(rule.id),
            "target_account": {"id": str(rule.target_account_id), "code": rule.target_account.code, "name": rule.target_account.name},
            "confidence": 100, "reason": f"Matched bank rule: {rule.name}"})
    return matches


def apply_bank_rule(*, organisation, bank_transaction, rule, user):
    if rule.organisation_id != organisation.id or bank_transaction.organisation_id != organisation.id:
        raise BusinessRuleError("Rule or transaction belongs to another organisation.")
    if str(rule.id) not in {match["rule_id"] for match in match_bank_rules(organisation=organisation, bank_transaction=bank_transaction)}:
        raise BusinessRuleError("Bank rule does not match this transaction.")
    result=reconcile_bank_transaction_to_account(bank_transaction=bank_transaction,
        target_account=rule.target_account, user=user)
    history=result.reconciliation_history.first()
    if history:
        history.metadata={**history.metadata, "bank_rule_id": str(rule.id), "bank_rule_name": rule.name}
        history.save(update_fields=["metadata"])
    return result
