"""Validate bank inputs and keep reconciliation audit fields controlled by services."""

from rest_framework import serializers
from apps.date_fields import accounting_date
from django.db.models import Sum

from apps.accounting.models import Account, LEDGER_EFFECTIVE_JOURNAL_STATUSES

from .models import BankAccount, BankReconciliationHistory, BankRule, BankStatementImport, BankStatementImportRow, BankTransaction
from .services.transactions import (
    create_bank_transaction,
    reconcile_bank_transaction_to_account,
)


class BankAccountSerializer(serializers.ModelSerializer):
    ledger_account_id = serializers.PrimaryKeyRelatedField(
        source="ledger_account",
        queryset=Account.objects.all(),
        write_only=True,
    )

    ledger_account = serializers.SerializerMethodField(
        read_only=True,
    )
    book_balance = serializers.SerializerMethodField(read_only=True)
    statement_balance = serializers.SerializerMethodField(read_only=True)
    reconciliation_difference = serializers.SerializerMethodField(read_only=True)
    unreconciled_count = serializers.SerializerMethodField(read_only=True)
    last_reconciled_at = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = BankAccount
        fields = [
            "id",
            "name",
            "bank_name",
            "account_number",
            "sort_code",
            "iban",
            "swift_bic",
            "currency",
            "opening_balance",
            "opening_balance_date",
            "status",
            "ledger_account_id",
            "ledger_account",
            "book_balance",
            "statement_balance",
            "reconciliation_difference",
            "unreconciled_count",
            "last_reconciled_at",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
        ]

    def get_ledger_account(self, obj):
        return {
            "id": str(obj.ledger_account_id),
            "code": obj.ledger_account.code,
            "name": obj.ledger_account.name,
        }

    def get_book_balance(self, obj):
        totals = obj.ledger_account.journal_lines.filter(
            journal_entry__status__in=LEDGER_EFFECTIVE_JOURNAL_STATUSES,
        ).aggregate(debit=Sum("debit"), credit=Sum("credit"))
        return (totals["debit"] or 0) - (totals["credit"] or 0)

    def get_statement_balance(self, obj):
        if not obj.opening_balance_date and not obj.transactions.exists():
            return None
        incoming = obj.transactions.filter(
            transaction_type="money_in",
        ).aggregate(total=Sum("amount"))["total"] or 0
        outgoing = obj.transactions.filter(
            transaction_type="money_out",
        ).aggregate(total=Sum("amount"))["total"] or 0
        return obj.opening_balance + incoming - outgoing

    def get_reconciliation_difference(self, obj):
        statement_balance = self.get_statement_balance(obj)
        if statement_balance is None:
            return None
        return statement_balance - self.get_book_balance(obj)

    def get_unreconciled_count(self, obj):
        return obj.transactions.filter(status="unreconciled").count()

    def get_last_reconciled_at(self, obj):
        latest = obj.transactions.filter(
            status=BankTransaction.Status.RECONCILED,
            reconciled_at__isnull=False,
        ).order_by("-reconciled_at").values_list("reconciled_at", flat=True).first()
        return latest

    def validate(self, attrs):
        organisation = self.context.get("organisation")
        ledger = attrs.get("ledger_account") or getattr(self.instance, "ledger_account", None)
        currency = attrs.get("currency") or getattr(self.instance, "currency", "")
        if organisation and ledger and ledger.organisation_id != organisation.id:
            raise serializers.ValidationError({"ledger_account_id": "The ledger account belongs to another organisation."})
        if ledger and ledger.status != Account.Status.ACTIVE:
            raise serializers.ValidationError({"ledger_account_id": "The ledger account must be active."})
        if ledger and ledger.account_type != Account.AccountType.ASSET:
            raise serializers.ValidationError({"ledger_account_id": "The ledger account must be an asset account."})
        if ledger and ledger.account_class != Account.AccountClass.BANK:
            raise serializers.ValidationError({"ledger_account_id": "The ledger account must be classified as bank."})
        if ledger and ledger.currency and currency and ledger.currency.upper() != currency.upper():
            raise serializers.ValidationError({"currency": "Bank and ledger account currencies must match."})
        if ledger:
            linked = BankAccount.objects.filter(ledger_account=ledger)
            if self.instance:
                linked = linked.exclude(pk=self.instance.pk)
            if linked.exists():
                raise serializers.ValidationError({"ledger_account_id": "This ledger account is already linked to Banking."})
        return attrs


class BankTransactionSerializer(serializers.ModelSerializer):
    bank_account_id = serializers.PrimaryKeyRelatedField(
        source="bank_account",
        queryset=BankAccount.objects.all(),
        write_only=True,
    )

    bank_account = serializers.SerializerMethodField(
        read_only=True,
    )

    accounting_journal = serializers.PrimaryKeyRelatedField(
        read_only=True,
    )

    class Meta:
        model = BankTransaction
        fields = [
            "id",
            "bank_account_id",
            "bank_account",
            "transaction_date",
            "description",
            "reference",
            "transaction_type",
            "amount",
            "currency",
            "external_id",
            "status",
            "accounting_journal",
            "reconciliation_type",
            "reconciliation_object_id",
            "reconciled_at",
            "unreconciled_at",
            "unreconciliation_reason",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "status",
            "accounting_journal",
            "reconciliation_type",
            "reconciliation_object_id",
            "reconciled_at",
            "unreconciled_at",
            "unreconciliation_reason",
            "created_at",
            "updated_at",
        ]

    def get_bank_account(self, obj):
        return {
            "id": str(obj.bank_account_id),
            "name": obj.bank_account.name,
            "currency": obj.bank_account.currency,
        }

    def create(self, validated_data):
        organisation = self.context.get("organisation")
        request = self.context.get("request")

        if organisation is None:
            raise serializers.ValidationError(
                "Organisation context is missing."
            )

        if request is None:
            raise serializers.ValidationError(
                "Request context is missing."
            )

        bank_account = validated_data.pop("bank_account")

        return create_bank_transaction(
            organisation=organisation,
            bank_account=bank_account,
            user=request.user,
            **validated_data,
        )


class BankTransactionReconcileSerializer(serializers.Serializer):
    target_account_id = serializers.PrimaryKeyRelatedField(
        source="target_account",
        queryset=Account.objects.all(),
    )

    def save(self, **kwargs):
        bank_transaction = self.context["bank_transaction"]
        request = self.context["request"]

        target_account = self.validated_data[
            "target_account"
        ]

        return reconcile_bank_transaction_to_account(
            bank_transaction=bank_transaction,
            target_account=target_account,
            user=request.user,
        )


class BankReconciliationSuggestionQuerySerializer(serializers.Serializer):
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=50,
        default=10,
    )


class AcceptReconciliationSuggestionSerializer(serializers.Serializer):
    match_type = serializers.ChoiceField(
        choices=[
            "customer_payment",
            "supplier_payment",
            "bank_transfer",
            "invoice",
            "bill",
        ]
    )
    object_id = serializers.UUIDField()


class UnreconcileBankTransactionSerializer(serializers.Serializer):
    reversal_date = accounting_date("reversal date", required=False)
    reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=1000,
    )


class ReconciliationSummaryQuerySerializer(serializers.Serializer):
    reconciliation_date = accounting_date("reconciliation date")


class BankReconciliationHistorySerializer(serializers.ModelSerializer):
    transaction = serializers.SerializerMethodField()
    performed_by = serializers.SerializerMethodField()
    journal = serializers.SerializerMethodField()

    class Meta:
        model = BankReconciliationHistory
        fields = ["id", "action", "reconciliation_type", "reconciliation_object_id", "transaction", "performed_by", "performed_at", "journal", "reason", "metadata"]

    def get_transaction(self, obj):
        row = obj.bank_transaction
        return {"id": str(row.id), "date": row.transaction_date, "description": row.description, "reference": row.reference, "transaction_type": row.transaction_type, "amount": row.amount, "currency": row.currency}

    def get_performed_by(self, obj):
        user = obj.performed_by
        name = user.get_full_name() if hasattr(user, "get_full_name") else ""
        return {"id": str(user.id), "name": name or user.get_username()}

    def get_journal(self, obj):
        if not obj.accounting_journal_id:
            return None
        return {"id": str(obj.accounting_journal_id), "entry_number": obj.accounting_journal.entry_number}


class BankImportRowSerializer(serializers.ModelSerializer):
    class Meta:
        model=BankStatementImportRow
        fields=["id", "row_number", "transaction_date", "description", "reference", "amount",
                "transaction_type", "currency", "external_id", "status", "bank_transaction", "error_message"]
        read_only_fields=fields


class BankImportSerializer(serializers.ModelSerializer):
    rows=BankImportRowSerializer(many=True, read_only=True)
    class Meta:
        model=BankStatementImport
        fields=["id", "bank_account", "file_name", "file_type", "imported_at", "status",
                "total_rows", "imported_rows", "duplicate_rows", "rejected_rows", "metadata",
                "rows", "created_at", "updated_at"]
        read_only_fields=fields


class BankImportPreviewSerializer(serializers.Serializer):
    bank_account_id=serializers.UUIDField(); file=serializers.FileField()
    mapping=serializers.JSONField(); date_format=serializers.CharField(required=False, default="%Y-%m-%d")
    def validate_file(self,value):
        from django.conf import settings
        import os
        maximum=getattr(settings,"BANK_IMPORT_MAX_BYTES",5*1024*1024)
        if value.size>maximum:raise serializers.ValidationError(f"Bank statement exceeds the {maximum} byte upload limit.")
        if os.path.splitext(value.name)[1].lower()!=".csv":raise serializers.ValidationError("Only CSV bank statements are accepted.")
        content_type=(value.content_type or "").lower()
        if content_type not in {"text/csv","text/plain","application/csv","application/vnd.ms-excel"}:raise serializers.ValidationError("Unsupported bank statement content type.")
        signature=value.read(512);value.seek(0)
        if b"\x00" in signature or signature.startswith((b"MZ",b"PK\x03\x04",b"\x7fELF")):raise serializers.ValidationError("Executable, binary, and archive uploads are not accepted.")
        return value


class BankRuleSerializer(serializers.ModelSerializer):
    bank_account_id=serializers.PrimaryKeyRelatedField(source="bank_account", queryset=BankAccount.objects.all(), required=False, allow_null=True)
    target_account_id=serializers.PrimaryKeyRelatedField(source="target_account", queryset=Account.objects.all())
    class Meta:
        model=BankRule
        fields=["id", "name", "priority", "is_active", "bank_account_id", "direction",
                "description_contains", "reference_contains", "min_amount", "max_amount",
                "target_account_id", "contact", "memo_template", "created_at", "updated_at"]
        read_only_fields=["id", "created_at", "updated_at"]

    def validate_target_account_id(self, account):
        if account.account_class in {
            Account.AccountClass.RECEIVABLE,
            Account.AccountClass.PAYABLE,
        }:
            raise serializers.ValidationError(
                "Receivable and payable control accounts cannot be used for "
                "bank rules. Match customer or supplier payments instead."
            )
        return account


class BulkReconcileSerializer(serializers.Serializer):
    transaction_ids=serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    target_account_id=serializers.UUIDField()
