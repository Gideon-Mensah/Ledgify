"""Revalue open foreign-currency balances and post unrealised exchange differences."""

from decimal import Decimal
from django.db import IntegrityError, transaction
from django.utils import timezone
from common.exceptions import BusinessRuleError
from apps.accounting.models import Account,JournalEntry
from apps.accounting.services.journals import create_journal_entry,post_journal_entry,reverse_journal_entry
from apps.fx.models import FXRevaluation
from apps.fx.services.exchange_rate_service import convert_amount,get_effective_rate

def _post(*,organisation,revaluation_type,as_of_date,foreign_currency,foreign_amount,old_base_amount,control_account,gain_account,loss_account,user,source_reference="aggregate"):
    if FXRevaluation.objects.select_for_update().filter(organisation=organisation,revaluation_type=revaluation_type,as_of_date=as_of_date,foreign_currency_id=foreign_currency,source_reference=source_reference).exists():raise BusinessRuleError("This FX exposure has already been revalued for the selected date.")
    rate=get_effective_rate(organisation=organisation,base_currency=foreign_currency,target_currency=organisation.base_currency,date=as_of_date);new=convert_amount(amount=foreign_amount,rate=rate);difference=new-old_base_amount
    if difference==0:raise BusinessRuleError("There is no FX revaluation difference.")
    asset=revaluation_type!="payables";gain=difference>0 if asset else difference<0;counter=gain_account if gain else loss_account
    if any(x.organisation_id!=organisation.id for x in (control_account,counter)):raise BusinessRuleError("Revaluation accounts belong to another organisation.")
    value=abs(difference);debit=control_account if (difference>0)==asset else counter;credit=counter if debit==control_account else control_account
    journal=create_journal_entry(organisation=organisation,date=as_of_date,description=f"{revaluation_type.title()} FX revaluation",lines=[{"account":debit,"debit":value,"credit":0},{"account":credit,"debit":0,"credit":value}],user=user,source_type=JournalEntry.SourceType.FX_REVALUATION)
    post_journal_entry(journal_entry=journal,user=user);journal.refresh_from_db()
    try:return FXRevaluation.objects.create(organisation=organisation,revaluation_type=revaluation_type,as_of_date=as_of_date,foreign_currency_id=foreign_currency,source_reference=source_reference,foreign_amount=foreign_amount,old_base_amount=old_base_amount,new_base_amount=new,gain_loss=difference,journal=journal,created_by=user)
    except IntegrityError as exc:raise BusinessRuleError("This FX exposure has already been revalued for the selected date.") from exc
@transaction.atomic
def revalue_receivables(**kwargs):return _post(revaluation_type=FXRevaluation.Type.RECEIVABLES,**kwargs)
@transaction.atomic
def revalue_payables(**kwargs):return _post(revaluation_type=FXRevaluation.Type.PAYABLES,**kwargs)
@transaction.atomic
def revalue_bank_accounts(**kwargs):return _post(revaluation_type=FXRevaluation.Type.BANK,**kwargs)

@transaction.atomic
def reverse_fx_revaluation(*,revaluation,user,reversal_date=None):
    row=FXRevaluation.objects.select_for_update().select_related("journal").get(pk=revaluation.pk)
    if row.reversal_journal_id:raise BusinessRuleError("This FX revaluation has already been reversed.")
    reversal=reverse_journal_entry(journal_entry=row.journal,user=user,reversal_date=reversal_date)
    row.reversal_journal=reversal;row.reversed_by=user;row.reversed_at=timezone.now();row.save(update_fields=["reversal_journal","reversed_by","reversed_at"])
    return row
