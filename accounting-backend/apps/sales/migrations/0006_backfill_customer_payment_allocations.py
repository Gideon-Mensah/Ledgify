from django.db import migrations


def backfill_customer_payment_allocations(apps, schema_editor):
    CustomerPayment = apps.get_model("sales", "CustomerPayment")
    CustomerPaymentAllocation = apps.get_model(
        "sales", "CustomerPaymentAllocation"
    )

    for payment in CustomerPayment.objects.exclude(invoice_id=None).iterator():
        invoice = payment.invoice
        payment.customer_id = invoice.customer_id
        payment.save(update_fields=["customer"])
        CustomerPaymentAllocation.objects.get_or_create(
            organisation_id=payment.organisation_id,
            payment_id=payment.id,
            invoice_id=payment.invoice_id,
            defaults={
                "amount": payment.amount,
                "allocated_at": payment.created_at,
                "allocated_by_id": payment.created_by_id,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("sales", "0005_customerpayment_customer_and_more"),
    ]

    operations = [
        migrations.RunPython(
            backfill_customer_payment_allocations,
            migrations.RunPython.noop,
        ),
    ]
