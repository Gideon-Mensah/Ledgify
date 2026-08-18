from datetime import date
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from apps.accounting.models import Account,AccountingPeriod
from apps.contacts.models import Contact
from apps.fx.models import Currency,ExchangeRate
from apps.fx.services import convert_amount,get_effective_rate,revalue_receivables,reverse_fx_revaluation
from common.exceptions import BusinessRuleError
from apps.organisations.models import Organisation,OrganisationMember
from apps.sales.services.invoices import approve_invoice,create_invoice
from apps.sales.services.payments import create_customer_payment

class FXWorkflowTests(TestCase):
 def setUp(self):
  self.user=get_user_model().objects.create_user(username="fx",email="fx@example.com",password="x",first_name="F",last_name="X");self.org=Organisation.objects.create(name="FX Org",base_currency="GBP",created_by=self.user);OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner")
  for code,name in (("GBP","Pound"),("USD","Dollar")):Currency.objects.get_or_create(code=code,defaults={"name":name})
  self.revenue=self.account("4000","Revenue","revenue","sales");self.ar=self.account("1100","AR","asset","receivable");self.bank=self.account("1000","USD bank","asset","bank",currency="USD");self.gain=self.account("7900","FX gain","revenue","other_income");self.loss=self.account("7901","FX loss","expense","other_expense");self.org.fx_gain_account=self.gain;self.org.fx_loss_account=self.loss;self.org.save()
  self.customer=Contact.objects.create(organisation=self.org,created_by=self.user,name="Foreign customer",is_customer=True,currency="USD")
 def account(self,code,name,kind,klass,currency="GBP"):return Account.objects.create(organisation=self.org,created_by=self.user,code=code,name=name,account_type=kind,account_class=klass,currency=currency)
 def rate(self,value,on):return ExchangeRate.objects.create(organisation=self.org,base_currency_id="USD",target_currency_id="GBP",rate=value,effective_date=on,source="test")
 def test_effective_rate_and_realised_gain(self):
  self.rate("0.80",date(2026,1,1));self.rate("0.85",date(2026,2,1));self.assertEqual(get_effective_rate(organisation=self.org,base_currency="USD",target_currency="GBP",date=date(2026,1,15)),Decimal("0.8000000000"))
  invoice=create_invoice(organisation=self.org,customer=self.customer,invoice_number="USD-1",issue_date=date(2026,1,15),due_date=date(2026,2,15),currency="USD",user=self.user,lines=[{"description":"Export","quantity":1,"unit_price":100,"revenue_account":self.revenue}]);approve_invoice(invoice=invoice,user=self.user)
  payment=create_customer_payment(organisation=self.org,customer=self.customer,bank_account=self.bank,payment_date=date(2026,2,2),amount=100,user=self.user,currency="USD",invoice=invoice)
  self.assertEqual(invoice.base_currency_amount,Decimal("80.00"));self.assertEqual(payment.base_currency_amount,Decimal("85.00"));self.assertEqual(payment.realised_fx_gain_loss,Decimal("5.00"));self.assertEqual(sum(x.debit for x in payment.accounting_journal.lines.all()),Decimal("85.00"))
 def test_rate_is_immutable_and_revaluation_posts(self):
  rate=self.rate("0.80",date(2026,1,1));rate.rate=Decimal("0.90")
  with self.assertRaises(Exception):rate.save()
  self.rate("0.90",date(2026,2,1));row=revalue_receivables(organisation=self.org,as_of_date=date(2026,2,2),foreign_currency="USD",foreign_amount=100,old_base_amount=Decimal("80"),control_account=self.ar,gain_account=self.gain,loss_account=self.loss,user=self.user)
  self.assertEqual(row.gain_loss,Decimal("10.00"));self.assertEqual(row.journal.status,"posted")
 def test_duplicate_revaluation_and_second_reversal_are_rejected(self):
  self.rate("0.90",date(2026,2,1));kwargs={"organisation":self.org,"as_of_date":date(2026,2,2),"foreign_currency":"USD","foreign_amount":100,"old_base_amount":Decimal("80"),"control_account":self.ar,"gain_account":self.gain,"loss_account":self.loss,"user":self.user,"source_reference":"invoice:42"}
  row=revalue_receivables(**kwargs)
  with self.assertRaises(BusinessRuleError):revalue_receivables(**kwargs)
  reversed_row=reverse_fx_revaluation(revaluation=row,user=self.user,reversal_date=date(2026,2,3));self.assertEqual(reversed_row.reversal_journal.lines.aggregate(total=__import__("django.db.models",fromlist=["Sum"]).Sum("debit"))["total"],Decimal("10.00"))
  with self.assertRaises(BusinessRuleError):reverse_fx_revaluation(revaluation=row,user=self.user,reversal_date=date(2026,2,3))
 def test_revaluation_reversal_then_settlement_does_not_double_count_fx(self):
  self.rate("0.80",date(2026,1,1));self.rate("0.90",date(2026,1,31));self.rate("0.85",date(2026,2,1));invoice=create_invoice(organisation=self.org,customer=self.customer,invoice_number="USD-SETTLE",issue_date=date(2026,1,15),due_date=date(2026,2,15),currency="USD",user=self.user,lines=[{"description":"Export","quantity":1,"unit_price":100,"revenue_account":self.revenue}]);approve_invoice(invoice=invoice,user=self.user);row=revalue_receivables(organisation=self.org,as_of_date=date(2026,1,31),foreign_currency="USD",foreign_amount=100,old_base_amount=Decimal("80"),control_account=self.ar,gain_account=self.gain,loss_account=self.loss,user=self.user,source_reference=f"invoice:{invoice.id}");row=reverse_fx_revaluation(revaluation=row,user=self.user,reversal_date=date(2026,2,1));payment=create_customer_payment(organisation=self.org,customer=self.customer,bank_account=self.bank,payment_date=date(2026,2,2),amount=100,user=self.user,currency="USD",invoice=invoice);self.assertEqual(invoice.base_currency_amount,Decimal("80.00"));self.assertEqual(payment.base_currency_amount,Decimal("85.00"));self.assertEqual(payment.realised_fx_gain_loss,Decimal("5.00"));self.assertEqual(row.gain_loss,Decimal("10.00"));self.assertEqual(sum(x.debit for x in row.journal.lines.all()),sum(x.credit for x in row.journal.lines.all()));self.assertEqual(sum(x.debit for x in row.reversal_journal.lines.all()),sum(x.credit for x in row.reversal_journal.lines.all()));self.assertEqual(sum(x.debit for x in payment.accounting_journal.lines.all()),sum(x.credit for x in payment.accounting_journal.lines.all()))
 def test_locked_period_prevents_revaluation_and_reversal_without_partial_writes(self):
  self.rate("0.90",date(2026,1,1));AccountingPeriod.objects.create(organisation=self.org,name="January",start_date=date(2026,1,1),end_date=date(2026,1,31),status="locked")
  with self.assertRaises(BusinessRuleError):revalue_receivables(organisation=self.org,as_of_date=date(2026,1,31),foreign_currency="USD",foreign_amount=100,old_base_amount=Decimal("80"),control_account=self.ar,gain_account=self.gain,loss_account=self.loss,user=self.user)
  self.assertEqual(self.org.fx_revaluations.count(),0)
