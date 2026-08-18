"""Dated exchange rates and revaluations used for consistent base-currency reporting."""

import uuid
from django.conf import settings
from django.db import models

class Currency(models.Model):
    class Status(models.TextChoices):ACTIVE="active","Active";INACTIVE="inactive","Inactive"
    code=models.CharField(primary_key=True,max_length=3);name=models.CharField(max_length=100);symbol=models.CharField(max_length=10,blank=True);decimal_places=models.PositiveSmallIntegerField(default=2);status=models.CharField(max_length=10,choices=Status.choices,default=Status.ACTIVE)
    class Meta:ordering=["code"]
    def save(self,*args,**kwargs):self.code=self.code.upper().strip();return super().save(*args,**kwargs)

class ExchangeRate(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.CASCADE,related_name="exchange_rates")
    base_currency=models.ForeignKey(Currency,on_delete=models.PROTECT,related_name="base_rates");target_currency=models.ForeignKey(Currency,on_delete=models.PROTECT,related_name="target_rates")
    rate=models.DecimalField(max_digits=20,decimal_places=10);effective_date=models.DateField();source=models.CharField(max_length=100,blank=True);created_at=models.DateTimeField(auto_now_add=True)
    class Meta:ordering=["-effective_date"];constraints=[models.UniqueConstraint(fields=["organisation","base_currency","target_currency","effective_date"],name="unique_fx_rate_date"),models.CheckConstraint(condition=models.Q(rate__gt=0),name="fx_rate_positive")]
    def save(self,*args,**kwargs):
        from django.core.exceptions import ValidationError
        if self.pk and ExchangeRate.objects.filter(pk=self.pk).exists():raise ValidationError("Historical exchange rates are immutable; add a new dated rate.")
        if self.base_currency_id==self.target_currency_id:raise ValidationError("Exchange-rate currencies must differ.")
        return super().save(*args,**kwargs)

class FXRevaluation(models.Model):
    class Type(models.TextChoices):RECEIVABLES="receivables","Receivables";PAYABLES="payables","Payables";BANK="bank","Bank accounts"
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False);organisation=models.ForeignKey("organisations.Organisation",on_delete=models.CASCADE,related_name="fx_revaluations");revaluation_type=models.CharField(max_length=20,choices=Type.choices);as_of_date=models.DateField();foreign_currency=models.ForeignKey(Currency,on_delete=models.PROTECT);source_reference=models.CharField(max_length=100,default="aggregate");foreign_amount=models.DecimalField(max_digits=18,decimal_places=2);old_base_amount=models.DecimalField(max_digits=18,decimal_places=2);new_base_amount=models.DecimalField(max_digits=18,decimal_places=2);gain_loss=models.DecimalField(max_digits=18,decimal_places=2);journal=models.OneToOneField("accounting.JournalEntry",on_delete=models.PROTECT,related_name="fx_revaluation");reversal_journal=models.OneToOneField("accounting.JournalEntry",on_delete=models.PROTECT,null=True,blank=True,related_name="reversed_fx_revaluation");created_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,related_name="fx_revaluations_created");reversed_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,null=True,blank=True,related_name="fx_revaluations_reversed");reversed_at=models.DateTimeField(null=True,blank=True);created_at=models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=["organisation","revaluation_type","as_of_date","foreign_currency","source_reference"],name="unique_fx_revaluation_exposure")]
