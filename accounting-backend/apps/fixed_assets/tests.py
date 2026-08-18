from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, AccountingPeriod, JournalEntry
from apps.fixed_assets.models import FixedAsset, FixedAssetCategory
from apps.fixed_assets.services import activate_asset, dispose_asset, run_depreciation
from apps.organisations.models import Organisation, OrganisationMember


class FixedAssetLifecycleTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username="assets",password="test")
        self.organisation=Organisation.objects.create(name="Assets",created_by=self.user)
        OrganisationMember.objects.create(organisation=self.organisation,user=self.user,role=OrganisationMember.Role.OWNER)
        self.asset_account=self._account("1500",Account.AccountType.ASSET,Account.AccountClass.FIXED_ASSET)
        self.accumulated=self._account("1510",Account.AccountType.ASSET,Account.AccountClass.FIXED_ASSET)
        self.expense=self._account("6000",Account.AccountType.EXPENSE,Account.AccountClass.OPERATING_EXPENSE)
        self.bank=self._account("1000",Account.AccountType.ASSET,Account.AccountClass.BANK)
        self.gain=self._account("4900",Account.AccountType.REVENUE,Account.AccountClass.OTHER_INCOME)
        self.loss=self._account("6900",Account.AccountType.EXPENSE,Account.AccountClass.OTHER_EXPENSE)
        self.category=FixedAssetCategory.objects.create(organisation=self.organisation,name="Equipment",
            default_useful_life_months=60,default_asset_account=self.asset_account,
            default_accumulated_depreciation_account=self.accumulated,
            default_depreciation_expense_account=self.expense,created_by=self.user)
        self.asset=FixedAsset.objects.create(organisation=self.organisation,asset_number="FA-001",
            asset_name="Laptop",asset_category=self.category,purchase_date=date(2026,1,1),
            in_service_date=date(2026,1,1),cost="1200",residual_value="0",useful_life_months=12,
            depreciation_method=FixedAssetCategory.DepreciationMethod.STRAIGHT_LINE,
            asset_account=self.asset_account,accumulated_depreciation_account=self.accumulated,
            depreciation_expense_account=self.expense,created_by=self.user)
    def _account(self,code,kind,classification):
        return Account.objects.create(organisation=self.organisation,code=code,name=code,
            account_type=kind,account_class=classification,created_by=self.user)

    def test_activation_depreciation_and_disposal_journals(self):
        activate_asset(organisation=self.organisation,asset=self.asset,offset_account=self.bank,user=self.user)
        self.asset.refresh_from_db();self.assertEqual(self.asset.status,FixedAsset.Status.ACTIVE)
        first=run_depreciation(organisation=self.organisation,period=date(2026,1,31),user=self.user)
        self.assertEqual(first[0].depreciation_amount,Decimal("100.00"))
        self.assertEqual(first[0].book_value_after,Decimal("1100.00"))
        self.assertEqual(run_depreciation(organisation=self.organisation,period=date(2026,1,31),user=self.user),[])
        run_depreciation(organisation=self.organisation,period=date(2026,2,28),user=self.user)
        disposal=dispose_asset(organisation=self.organisation,asset=self.asset,
            disposal_date=date(2026,3,1),disposal_type="sale",proceeds="1100",
            proceeds_account=self.bank,gain_account=self.gain,loss_account=self.loss,user=self.user)
        self.assertEqual(disposal.accumulated_depreciation,Decimal("200.00"))
        self.assertEqual(disposal.book_value,Decimal("1000.00"))
        self.assertEqual(disposal.gain_or_loss,Decimal("100.00"))
        totals=disposal.journal.lines.all()
        self.assertEqual(sum(x.debit for x in totals),sum(x.credit for x in totals))

    def test_depreciation_respects_locked_period(self):
        activate_asset(organisation=self.organisation,asset=self.asset,offset_account=self.bank,user=self.user)
        AccountingPeriod.objects.create(organisation=self.organisation,name="January",
            start_date=date(2026,1,1),end_date=date(2026,1,31),status=AccountingPeriod.Status.LOCKED)
        with self.assertRaises(BusinessRuleError):
            run_depreciation(organisation=self.organisation,period=date(2026,1,31),user=self.user)

    def test_reducing_balance_uses_decimal_and_never_below_residual(self):
        self.asset.depreciation_method=FixedAssetCategory.DepreciationMethod.REDUCING_BALANCE
        self.asset.residual_value=Decimal("500");self.asset.save()
        activate_asset(organisation=self.organisation,asset=self.asset,offset_account=self.bank,user=self.user)
        row=run_depreciation(organisation=self.organisation,period=date(2026,1,31),user=self.user)[0]
        self.assertEqual(row.depreciation_amount,Decimal("200.00"))
        self.assertGreaterEqual(row.book_value_after,self.asset.residual_value)
