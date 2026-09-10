from datetime import date
from decimal import Decimal
from django.test import TestCase, override_settings
from django.db import connection, transaction, DatabaseError
from common.exceptions import BusinessRuleError
from . import tests as fixtures
from .models import ConsolidationPeriod, ConsolidationAccount, ConsolidationAccountMapping, EliminationJournal, EliminationJournalLine
from .services import prepare_consolidation,consolidated_trial_balance,consolidated_profit_loss,post_elimination,reverse_elimination,finalise_period,reopen_period
from apps.accounting.services.journals import create_journal_entry,post_journal_entry
from apps.fx.models import Currency,ExchangeRate


@override_settings(ENABLE_CONSOLIDATION=True)
class ConsolidationAccuracyTests(TestCase):
    org=fixtures.ConsolidationWorkflowTests.org
    account=fixtures.ConsolidationWorkflowTests.account

    def setUp(self):
        fixtures.ConsolidationWorkflowTests.setUp(self)
        self.january=ConsolidationPeriod.objects.create(group=self.group,start_date=date(2026,1,1),end_date=date(2026,1,31))
        self.february=ConsolidationPeriod.objects.create(group=self.group,start_date=date(2026,2,1),end_date=date(2026,2,28))
        self.revenue=self.account(self.sub,"4000","Sales","revenue","sales")
        self.expense=self.account(self.sub,"5000","Expense","expense","operating_expense")
        for source in [self.revenue,self.expense]:
            target=ConsolidationAccount.objects.create(group=self.group,code=source.code,name=source.name,account_type=source.account_type,account_class=source.account_class)
            ConsolidationAccountMapping.objects.create(group=self.group,organisation=self.sub,source_account=source,consolidation_account=target,effective_from=date(2025,1,1))
        self.retained=ConsolidationAccount.objects.create(group=self.group,code="G3100",name="Retained earnings",account_type="equity",account_class="retained_earnings")
        self.cta=ConsolidationAccount.objects.create(group=self.group,code="G3200",name="Translation reserve",account_type="equity",account_class="equity")
        self.group.cta_account=self.cta;self.group.save()

    def entry(self,on,debit,credit,amount):
        row=create_journal_entry(organisation=self.sub,date=on,description="Independent consolidation fixture",user=self.user,
            lines=[{"account":debit,"debit":amount,"credit":0},{"account":credit,"debit":0,"credit":amount}])
        return post_journal_entry(row,self.user)

    def balance(self,period):
        report=consolidated_trial_balance(group=self.group,period=period,user=self.user)
        self.assertTrue(report["balanced"])
        return {row["account"]["code"]:row["debit"]-row["credit"] for row in report["rows"]}

    def test_newest_snapshot_period_nominal_and_true_average_fx(self):
        Currency.objects.get_or_create(code="GHS",defaults={"name":"Cedi"})
        self.group.reporting_currency_id="GHS";self.group.save()
        for on,rate in [(date(2026,1,1),"2"),(date(2026,1,16),"3")]:
            ExchangeRate.objects.create(organisation=self.sub,base_currency_id="GBP",target_currency_id="GHS",effective_date=on,rate=Decimal(rate))
        self.entry(date(2025,12,1),self.cash,self.revenue,"40")
        self.entry(date(2025,12,2),self.expense,self.cash,"5")
        self.entry(date(2026,1,10),self.cash,self.revenue,"30")
        self.entry(date(2026,1,20),self.expense,self.cash,"10")
        prepare_consolidation(group=self.group,period=self.january,user=self.user)
        self.assertEqual(self.balance(self.january)["G1000"],Decimal("465"))
        self.entry(date(2026,1,25),self.cash,self.equity,"10")
        prepare_consolidation(group=self.group,period=self.january,user=self.user)
        balances=self.balance(self.january)
        self.assertEqual(balances["G1000"],Decimal("495"))
        self.assertEqual(balances["G3000"],Decimal("-330"))
        self.assertEqual(balances["G3100"],Decimal("-105"))
        # (15 days*2 + 16 days*3)/31 = 2.5161290323.
        profit=consolidated_profit_loss(group=self.group,period=self.january,user=self.user)
        self.assertEqual(profit,{"income":Decimal("75.48"),"expenses":Decimal("25.16"),"net_profit":Decimal("50.32")})
        self.assertEqual(balances["G3200"],Decimal("-9.68"))
        prepare_consolidation(group=self.group,period=self.february,user=self.user)
        self.assertEqual(consolidated_profit_loss(group=self.group,period=self.february,user=self.user)["net_profit"],0)
        self.assertEqual(self.balance(self.february)["G3100"],Decimal("-165"))
        self.assertEqual(self.january.snapshots.count(),2)

    def test_elimination_exact_reversal_and_finalised_reopen(self):
        prepare_consolidation(group=self.group,period=self.january,user=self.user)
        before=self.balance(self.january)
        elimination=EliminationJournal.objects.create(group=self.group,period=self.january,entry_number="ELIM-P2",date=date(2026,1,31),description="Eliminate",created_by=self.user)
        EliminationJournalLine.objects.create(journal=elimination,consolidation_account=self.gc,credit=10)
        EliminationJournalLine.objects.create(journal=elimination,consolidation_account=self.ge,debit=10)
        post_elimination(journal=elimination,user=self.user)
        self.assertEqual(self.balance(self.january)["G1000"],90)
        finalise_period(period=self.january,user=self.user)
        with self.assertRaises(BusinessRuleError):reverse_elimination(journal=elimination,user=self.user,date=date(2026,1,31))
        with self.assertRaises(BusinessRuleError):reopen_period(period=self.january,user=self.user,reason=" ")
        if connection.vendor=="postgresql":
            with self.assertRaises(DatabaseError),transaction.atomic():
                EliminationJournal.objects.filter(pk=elimination.pk).update(description="Changed")
        reopen_period(period=self.january,user=self.user,reason="Approved correction")
        reverse_elimination(journal=elimination,user=self.user,date=date(2026,1,31))
        self.assertEqual(self.balance(self.january),before)

    def test_missing_average_start_rate_blocks_without_snapshot(self):
        Currency.objects.get_or_create(code="GHS",defaults={"name":"Cedi"})
        self.group.reporting_currency_id="GHS";self.group.save()
        ExchangeRate.objects.create(organisation=self.sub,base_currency_id="GBP",target_currency_id="GHS",effective_date=date(2026,1,31),rate=2)
        self.entry(date(2026,1,10),self.cash,self.revenue,"30")
        with self.assertRaises(BusinessRuleError):prepare_consolidation(group=self.group,period=self.january,user=self.user)
        self.assertEqual(self.january.snapshots.count(),0)
