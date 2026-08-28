"""Validate accounting API data while keeping calculated and posted fields read-only."""

from rest_framework import serializers
from apps.date_fields import accounting_date


from .models import Account, AccountingPeriod, FinancialYear, JournalEntry, JournalLine, OpeningBalance, OpeningBalanceLine


class AccountSerializer(serializers.ModelSerializer):
    bank_account = serializers.SerializerMethodField(read_only=True)
    class Meta:
        model = Account
        fields = [
            "id",
            "code",
            "name",
            "account_type",
            "account_class",
            "cash_flow_category",
            "description",
            "currency",
            "is_system_account",
            "allow_manual_journals",
            "bank_account",
            "status",
            "created_at",
            "updated_at",
        ]

    def get_bank_account(self, obj):
        try:
            profile = obj.bank_profile
        except Account.bank_profile.RelatedObjectDoesNotExist:
            return None
        return {"id": str(profile.id), "name": profile.name, "status": profile.status}

        read_only_fields = [
            "id",
            "is_system_account",
            "created_at",
            "updated_at",
        ]
        
class JournalLineSerializer(serializers.ModelSerializer):
    account = serializers.SerializerMethodField()

    class Meta:
        model = JournalLine
        fields = [
            "id",
            "description",
            "debit",
            "credit",
            "account",
        ]

    def get_account(self, obj):
        return {
            "id": str(obj.account_id),
            "code": obj.account.code,
            "name": obj.account.name,
        }


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalLineSerializer(
        many=True,
        read_only=True,
    )
    created_by = serializers.SerializerMethodField()
    posted_by = serializers.SerializerMethodField()
    reversal_of = serializers.SerializerMethodField()
    reversal_entry = serializers.SerializerMethodField()
    organisation = serializers.SerializerMethodField()

    @staticmethod
    def _user(user):
        if user is None:
            return None
        name = user.get_full_name().strip()
        return {"id": str(user.id), "name": name or user.email or user.get_username(), "email": user.email}

    @staticmethod
    def _journal(journal):
        if journal is None:
            return None
        return {"id": str(journal.id), "entry_number": journal.entry_number, "date": journal.date, "status": journal.status}

    def get_created_by(self, obj): return self._user(obj.created_by)
    def get_posted_by(self, obj): return self._user(obj.posted_by)
    def get_reversal_of(self, obj): return self._journal(obj.reversal_of)
    def get_reversal_entry(self, obj):
        try: return self._journal(obj.reversal_entry)
        except JournalEntry.reversal_entry.RelatedObjectDoesNotExist: return None
    def get_organisation(self, obj):
        return {"id": str(obj.organisation_id), "name": obj.organisation.name, "base_currency": obj.organisation.base_currency}

    class Meta:
        model = JournalEntry
        fields = [
            "id",
            "entry_number",
            "date",
            "reference",
            "description",
            "source_type",
            "source_id",
            "organisation",
            "status",
            "created_by",
            "posted_by",
            "posted_at",
            "reversal_of",
            "reversal_entry",
            "transaction_currency",
            "transaction_amount",
            "exchange_rate",
            "lines",
            "created_at",
            "updated_at",
        ]


class OpeningBalanceLineInputSerializer(serializers.Serializer):
    account_id=serializers.UUIDField();debit=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=0,required=False,default=0);credit=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=0,required=False,default=0);unusual_side_confirmed=serializers.BooleanField(required=False,default=False)
    def validate(self,attrs):
        if attrs["debit"] and attrs["credit"]:raise serializers.ValidationError("Enter an amount in Debit or Credit, not both.")
        return attrs

class OpeningBalanceWriteSerializer(serializers.Serializer):
    opening_date=accounting_date("opening balance date");reference=serializers.CharField(max_length=100,required=False,allow_blank=True);description=serializers.CharField(required=False,allow_blank=True);lines=OpeningBalanceLineInputSerializer(many=True,required=False,default=list)

class OpeningBalanceSerializer(serializers.ModelSerializer):
    lines=serializers.SerializerMethodField();totals=serializers.SerializerMethodField();created_by=serializers.SerializerMethodField();updated_by=serializers.SerializerMethodField();posted_by=serializers.SerializerMethodField();journal=JournalEntrySerializer(read_only=True);reversal_journal=JournalEntrySerializer(read_only=True)
    class Meta:model=OpeningBalance;exclude=["organisation"]
    def get_lines(self,obj):return [{"id":str(line.id),"account":{"id":str(line.account_id),"code":line.account.code,"name":line.account.name,"account_type":line.account.account_type,"account_class":line.account.account_class},"debit":line.debit,"credit":line.credit,"unusual_side_confirmed":line.unusual_side_confirmed} for line in obj.lines.all()]
    def get_totals(self,obj):
        from .services.opening_balances import totals
        return totals(obj)
    def _user(self,user):return {"id":str(user.id),"name":user.get_full_name() or user.get_username()} if user else None
    def get_created_by(self,obj):return self._user(obj.created_by)
    def get_updated_by(self,obj):return self._user(obj.updated_by)
    def get_posted_by(self,obj):return self._user(obj.posted_by)

class OpeningBalanceReverseSerializer(serializers.Serializer):
    reversal_date=accounting_date("reversal date")

class ManualJournalLineInputSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    description = serializers.CharField(required=False, allow_blank=True)
    debit = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0)
    credit = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0)

    def validate(self, attrs):
        debit, credit = attrs["debit"], attrs["credit"]
        if (debit > 0) == (credit > 0):
            raise serializers.ValidationError(
                "Enter either a positive debit or a positive credit."
            )
        return attrs


class ManualJournalInputSerializer(serializers.Serializer):
    date = accounting_date("journal date")
    reference = serializers.CharField(required=False, allow_blank=True, max_length=100)
    description = serializers.CharField(max_length=500)
    lines = ManualJournalLineInputSerializer(many=True, min_length=2)
    post = serializers.BooleanField(default=False)


class JournalReversalInputSerializer(serializers.Serializer):
    reversal_date = accounting_date("reversal date", required=False)


class FinancialYearSerializer(serializers.ModelSerializer):
    closing_journal = serializers.PrimaryKeyRelatedField(read_only=True)
    closing_reversal_journal = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = FinancialYear
        fields = [
            "id", "name", "start_date", "end_date", "status",
            "closing_journal", "closing_reversal_journal", "profit_or_loss",
            "closed_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "closing_journal", "closing_reversal_journal",
            "profit_or_loss", "closed_at", "created_at", "updated_at",
        ]


class ReopenFinancialYearSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, allow_blank=False)
    reversal_date = serializers.DateField(required=False)


class AccountingPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountingPeriod
        fields = ["id", "name", "start_date", "end_date", "status",
                  "locked_at", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "locked_at", "created_at", "updated_at"]


class ReopenAccountingPeriodSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, allow_blank=False)
