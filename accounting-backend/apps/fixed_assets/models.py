"""Fixed assets, depreciation schedules, and disposals with journal traceability."""

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.accounting.models import Account, JournalEntry
from apps.organisations.models import Organisation


class FixedAssetCategory(models.Model):
    class DepreciationMethod(models.TextChoices):
        STRAIGHT_LINE="straight_line", "Straight line"
        REDUCING_BALANCE="reducing_balance", "Reducing balance"
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation=models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name="fixed_asset_categories")
    name=models.CharField(max_length=255); description=models.TextField(blank=True)
    default_useful_life_months=models.PositiveIntegerField()
    default_depreciation_method=models.CharField(max_length=30, choices=DepreciationMethod.choices, default=DepreciationMethod.STRAIGHT_LINE)
    default_asset_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_asset_categories")
    default_accumulated_depreciation_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_asset_accumulation_categories")
    default_depreciation_expense_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_asset_expense_categories")
    created_by=models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="fixed_asset_categories_created")
    created_at=models.DateTimeField(auto_now_add=True); updated_at=models.DateTimeField(auto_now=True)
    class Meta:
        ordering=["name"]
        constraints=[models.UniqueConstraint(fields=["organisation", "name"], name="unique_fixed_asset_category_name")]


class FixedAsset(models.Model):
    class Status(models.TextChoices):
        DRAFT="draft", "Draft"; ACTIVE="active", "Active"
        FULLY_DEPRECIATED="fully_depreciated", "Fully depreciated"; DISPOSED="disposed", "Disposed"
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation=models.ForeignKey(Organisation, on_delete=models.PROTECT, related_name="fixed_assets")
    asset_number=models.CharField(max_length=50); asset_name=models.CharField(max_length=255); description=models.TextField(blank=True)
    asset_category=models.ForeignKey(FixedAssetCategory, on_delete=models.PROTECT, related_name="assets")
    purchase_date=models.DateField(); in_service_date=models.DateField()
    cost=models.DecimalField(max_digits=18, decimal_places=2); residual_value=models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    useful_life_months=models.PositiveIntegerField(); depreciation_method=models.CharField(max_length=30, choices=FixedAssetCategory.DepreciationMethod.choices)
    status=models.CharField(max_length=30, choices=Status.choices, default=Status.DRAFT)
    asset_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_assets")
    accumulated_depreciation_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_assets_accumulated")
    depreciation_expense_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_assets_depreciation_expense")
    activation_journal=models.OneToOneField(JournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="activated_fixed_asset")
    created_by=models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="fixed_assets_created")
    created_at=models.DateTimeField(auto_now_add=True); updated_at=models.DateTimeField(auto_now=True)
    class Meta:
        ordering=["asset_number"]
        constraints=[models.UniqueConstraint(fields=["organisation", "asset_number"], name="unique_fixed_asset_number")]
    @property
    def accumulated_depreciation(self):
        return sum((x.depreciation_amount for x in self.depreciation_schedules.filter(status="posted")), Decimal("0"))
    @property
    def net_book_value(self): return self.cost-self.accumulated_depreciation
    def delete(self,*args,**kwargs):
        if self.status != self.Status.DRAFT:
            from common.exceptions import BusinessRuleError
            raise BusinessRuleError("Only draft fixed assets can be deleted.")
        return super().delete(*args,**kwargs)


class DepreciationSchedule(models.Model):
    class Status(models.TextChoices): PENDING="pending", "Pending"; POSTED="posted", "Posted"
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset=models.ForeignKey(FixedAsset, on_delete=models.PROTECT, related_name="depreciation_schedules")
    period=models.DateField(); depreciation_amount=models.DecimalField(max_digits=18, decimal_places=2)
    book_value_before=models.DecimalField(max_digits=18, decimal_places=2); book_value_after=models.DecimalField(max_digits=18, decimal_places=2)
    journal=models.OneToOneField(JournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="depreciation_schedule")
    status=models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at=models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering=["period"]
        constraints=[models.UniqueConstraint(fields=["asset", "period"], name="unique_asset_depreciation_period")]


class FixedAssetDisposal(models.Model):
    class DisposalType(models.TextChoices): SALE="sale", "Sale"; SCRAP="scrap", "Scrap"; WRITE_OFF="write_off", "Write-off"
    id=models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset=models.OneToOneField(FixedAsset, on_delete=models.PROTECT, related_name="disposal")
    disposal_date=models.DateField(); disposal_type=models.CharField(max_length=20, choices=DisposalType.choices)
    proceeds=models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    accumulated_depreciation=models.DecimalField(max_digits=18, decimal_places=2)
    book_value=models.DecimalField(max_digits=18, decimal_places=2); gain_or_loss=models.DecimalField(max_digits=18, decimal_places=2)
    proceeds_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_asset_disposal_proceeds")
    gain_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_asset_disposal_gains")
    loss_account=models.ForeignKey(Account, on_delete=models.PROTECT, related_name="fixed_asset_disposal_losses")
    journal=models.OneToOneField(JournalEntry, on_delete=models.PROTECT, related_name="fixed_asset_disposal")
    disposed_by=models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="fixed_assets_disposed")
    created_at=models.DateTimeField(auto_now_add=True)
