from django.db import migrations


def backfill_supplier_payment_allocations(apps, schema_editor):
    SupplierPayment = apps.get_model("purchases", "SupplierPayment")
    SupplierPaymentAllocation = apps.get_model(
        "purchases", "SupplierPaymentAllocation"
    )

    for payment in SupplierPayment.objects.exclude(bill_id=None).iterator():
        bill = payment.bill
        payment.supplier_id = bill.supplier_id
        payment.save(update_fields=["supplier"])
        SupplierPaymentAllocation.objects.get_or_create(
            organisation_id=payment.organisation_id,
            payment_id=payment.id,
            bill_id=payment.bill_id,
            defaults={
                "amount": payment.amount,
                "allocated_at": payment.created_at,
                "allocated_by_id": payment.created_by_id,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("purchases", "0005_supplierpayment_supplier_alter_supplierpayment_bill_and_more"),
    ]

    operations = [
        migrations.RunPython(
            backfill_supplier_payment_allocations,
            migrations.RunPython.noop,
        ),
    ]
