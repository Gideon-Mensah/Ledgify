from rest_framework import serializers


class AgedReceivablesQuerySerializer(serializers.Serializer):
    as_of_date = serializers.DateField(
        required=False,
    )

    customer_id = serializers.UUIDField(
        required=False,
    )


class AgedPayablesQuerySerializer(serializers.Serializer):
    as_of_date = serializers.DateField(
        required=False,
    )

    supplier_id = serializers.UUIDField(
        required=False,
    )


class CustomerBalanceQuerySerializer(serializers.Serializer):
    customer_id = serializers.UUIDField(
        required=False,
    )


class SupplierBalanceQuerySerializer(serializers.Serializer):
    supplier_id = serializers.UUIDField(
        required=False,
    )


class CustomerStatementQuerySerializer(serializers.Serializer):
    customer_id = serializers.UUIDField(
        required=True,
    )

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


class SupplierStatementQuerySerializer(serializers.Serializer):
    supplier_id = serializers.UUIDField(
        required=True,
    )

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
