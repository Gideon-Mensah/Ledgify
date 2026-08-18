"""Activate, depreciate, and dispose of fixed assets through controlled journals."""

from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, JournalEntry
from apps.accounting.services.journals import create_journal_entry, post_journal_entry
from apps.accounting.services.periods import validate_period_open
from apps.fixed_assets.models import DepreciationSchedule, FixedAsset, FixedAssetDisposal
from apps.organisations.permissions import MANAGE_FIXED_ASSETS, RUN_DEPRECIATION
from apps.organisations.services import require_organisation_permission

ZERO=Decimal("0.00")
def money(value): return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _account(account, organisation, account_type=None):
    if account.organisation_id != organisation.id or account.status != Account.Status.ACTIVE:
        raise BusinessRuleError("Fixed asset account must be active and organisation-scoped.")
    if account_type and account.account_type != account_type:
        raise BusinessRuleError("Fixed asset account has the wrong account type.")


@transaction.atomic
def activate_asset(*, organisation, asset, offset_account, user):
    require_organisation_permission(organisation=organisation, user=user, permission=MANAGE_FIXED_ASSETS)
    asset=FixedAsset.objects.select_for_update().select_related("asset_account").get(pk=asset.pk, organisation=organisation)
    if asset.status != FixedAsset.Status.DRAFT: raise BusinessRuleError("Only draft assets can be activated.")
    _account(asset.asset_account, organisation, Account.AccountType.ASSET); _account(offset_account, organisation)
    validate_period_open(organisation, asset.purchase_date)
    journal=create_journal_entry(organisation=organisation, date=asset.purchase_date,
        description=f"Fixed asset acquisition - {asset.asset_number}", reference=asset.asset_number,
        source_type=JournalEntry.SourceType.FIXED_ASSET_ACQUISITION, source_id=asset.id, user=user,
        lines=[{"account":asset.asset_account,"description":asset.asset_name,"debit":asset.cost,"credit":ZERO},
               {"account":offset_account,"description":asset.asset_name,"debit":ZERO,"credit":asset.cost}])
    post_journal_entry(journal_entry=journal,user=user); asset.activation_journal=journal; asset.status=asset.Status.ACTIVE
    asset.save(update_fields=["activation_journal","status","updated_at"]); return asset


def calculate_depreciation(asset):
    book=asset.net_book_value; depreciable=max(book-asset.residual_value, ZERO)
    if depreciable <= ZERO: return ZERO
    if asset.depreciation_method == asset.asset_category.DepreciationMethod.STRAIGHT_LINE:
        amount=(asset.cost-asset.residual_value)/Decimal(asset.useful_life_months)
    else:
        amount=book*(Decimal("2")/Decimal(asset.useful_life_months))
    return min(money(amount), money(depreciable))


@transaction.atomic
def run_depreciation(*, organisation, period, user, asset=None):
    require_organisation_permission(organisation=organisation,user=user,permission=RUN_DEPRECIATION)
    validate_period_open(organisation, period)
    assets=FixedAsset.objects.select_for_update().filter(organisation=organisation,status=FixedAsset.Status.ACTIVE,in_service_date__lte=period)
    if asset is not None: assets=assets.filter(pk=asset.pk)
    schedules=[]
    for item in assets.select_related("asset_category","depreciation_expense_account","accumulated_depreciation_account"):
        if DepreciationSchedule.objects.filter(asset=item,period=period).exists(): continue
        amount=calculate_depreciation(item)
        if amount <= ZERO: continue
        before=money(item.net_book_value); after=money(before-amount)
        journal=create_journal_entry(organisation=organisation,date=period,
            description=f"Depreciation - {item.asset_number}",reference=item.asset_number,
            source_type=JournalEntry.SourceType.DEPRECIATION,source_id=item.id,user=user,
            lines=[{"account":item.depreciation_expense_account,"description":item.asset_name,"debit":amount,"credit":ZERO},
                   {"account":item.accumulated_depreciation_account,"description":item.asset_name,"debit":ZERO,"credit":amount}])
        post_journal_entry(journal_entry=journal,user=user)
        schedule=DepreciationSchedule.objects.create(asset=item,period=period,
            depreciation_amount=amount,book_value_before=before,book_value_after=after,
            journal=journal,status=DepreciationSchedule.Status.POSTED)
        schedules.append(schedule)
        if after <= item.residual_value:
            item.status=item.Status.FULLY_DEPRECIATED; item.save(update_fields=["status","updated_at"])
    return schedules


@transaction.atomic
def dispose_asset(*, organisation, asset, disposal_date, disposal_type, proceeds,
                  proceeds_account, gain_account, loss_account, user):
    require_organisation_permission(organisation=organisation,user=user,permission=MANAGE_FIXED_ASSETS)
    asset=FixedAsset.objects.select_for_update().get(pk=asset.pk,organisation=organisation)
    if asset.status not in {asset.Status.ACTIVE,asset.Status.FULLY_DEPRECIATED}: raise BusinessRuleError("Asset cannot be disposed.")
    validate_period_open(organisation,disposal_date)
    for account in (asset.asset_account,asset.accumulated_depreciation_account,proceeds_account,gain_account,loss_account): _account(account,organisation)
    proceeds=money(proceeds); accumulated=money(asset.accumulated_depreciation); book=money(asset.cost-accumulated); difference=money(proceeds-book)
    lines=[{"account":asset.accumulated_depreciation_account,"description":asset.asset_name,"debit":accumulated,"credit":ZERO},
           {"account":asset.asset_account,"description":asset.asset_name,"debit":ZERO,"credit":asset.cost}]
    if proceeds>ZERO: lines.append({"account":proceeds_account,"description":"Disposal proceeds","debit":proceeds,"credit":ZERO})
    if difference>ZERO: lines.append({"account":gain_account,"description":"Gain on disposal","debit":ZERO,"credit":difference})
    elif difference<ZERO: lines.append({"account":loss_account,"description":"Loss on disposal","debit":abs(difference),"credit":ZERO})
    journal=create_journal_entry(organisation=organisation,date=disposal_date,
        description=f"Fixed asset disposal - {asset.asset_number}",reference=asset.asset_number,
        source_type=JournalEntry.SourceType.FIXED_ASSET_DISPOSAL,source_id=asset.id,user=user,lines=lines)
    post_journal_entry(journal_entry=journal,user=user)
    disposal=FixedAssetDisposal.objects.create(asset=asset,disposal_date=disposal_date,
        disposal_type=disposal_type,proceeds=proceeds,accumulated_depreciation=accumulated,
        book_value=book,gain_or_loss=difference,proceeds_account=proceeds_account,
        gain_account=gain_account,loss_account=loss_account,journal=journal,disposed_by=user)
    asset.status=asset.Status.DISPOSED;asset.save(update_fields=["status","updated_at"]);return disposal


def fixed_asset_register(*,organisation):
    return [{"id":str(x.id),"asset_number":x.asset_number,"asset_name":x.asset_name,
        "category":x.asset_category.name,"cost":x.cost,"accumulated_depreciation":x.accumulated_depreciation,
        "net_book_value":x.net_book_value,"status":x.status} for x in FixedAsset.objects.filter(organisation=organisation).select_related("asset_category")]


def depreciation_report(*,organisation):
    return DepreciationSchedule.objects.filter(asset__organisation=organisation).select_related("asset","journal")


def asset_movements(*,organisation):
    return JournalEntry.objects.filter(organisation=organisation,source_type__in=[JournalEntry.SourceType.FIXED_ASSET_ACQUISITION,JournalEntry.SourceType.DEPRECIATION,JournalEntry.SourceType.FIXED_ASSET_DISPOSAL])


def disposal_report(*,organisation): return FixedAssetDisposal.objects.filter(asset__organisation=organisation).select_related("asset","journal")
