from rest_framework import serializers


class GeneralLedgerQuerySerializer(serializers.Serializer):
    report_type = serializers.ChoiceField(
        choices=["profit_loss"], required=False,
    )
    start_date = serializers.DateField(
        required=False,
    )

    end_date = serializers.DateField(
        required=False,
    )

    account_id = serializers.UUIDField(
        required=False,
    )

    def validate(self, attrs):
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")

        if (
            start_date
            and end_date
            and end_date < start_date
        ):
            raise serializers.ValidationError(
                "End date cannot be earlier than start date."
            )

        return attrs


class TrialBalanceQuerySerializer(serializers.Serializer):
    as_of_date = serializers.DateField(
        required=False,
    )


class ProfitLossQuerySerializer(serializers.Serializer):
    start_date = serializers.DateField(
        required=False,
    )

    end_date = serializers.DateField(
        required=False,
    )

    def validate(self, attrs):
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")

        if (
            start_date
            and end_date
            and end_date < start_date
        ):
            raise serializers.ValidationError(
                "End date cannot be earlier than start date."
            )

        return attrs


class BalanceSheetQuerySerializer(serializers.Serializer):
    as_of_date = serializers.DateField(
        required=False,
    )


class CashFlowQuerySerializer(serializers.Serializer):
    start_date = serializers.DateField(
        required=False,
    )

    end_date = serializers.DateField(
        required=False,
    )

    def validate(self, attrs):
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")

        if (
            start_date
            and end_date
            and end_date < start_date
        ):
            raise serializers.ValidationError(
                "End date cannot be earlier than start date."
            )

        return attrs


class CashFlowDrilldownQuerySerializer(CashFlowQuerySerializer):
    row_key = serializers.UUIDField(required=True)


class RatioAnalysisQuerySerializer(serializers.Serializer):
    start_date = serializers.DateField(required=True)
    end_date = serializers.DateField(required=True)
    comparison_start_date = serializers.DateField(required=False)
    comparison_end_date = serializers.DateField(required=False)

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("End date cannot be earlier than start date.")
        first = attrs.get("comparison_start_date")
        last = attrs.get("comparison_end_date")
        if bool(first) != bool(last):
            raise serializers.ValidationError("Both comparison dates are required.")
        if first and last < first:
            raise serializers.ValidationError("Comparison end date cannot be earlier than its start date.")
        return attrs


class RatioTrendQuerySerializer(serializers.Serializer):
    ratio_key = serializers.CharField(max_length=60)
    start_date = serializers.DateField(required=True)
    end_date = serializers.DateField(required=True)
    interval = serializers.ChoiceField(choices=["month", "quarter", "year"], default="month")

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("End date cannot be earlier than start date.")
        return attrs
