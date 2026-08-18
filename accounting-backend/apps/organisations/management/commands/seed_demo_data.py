import os
import sys
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounting.models import Account
from apps.banking.models import BankAccount, BankTransaction
from apps.banking.services.transactions import create_bank_transaction
from apps.contacts.models import Contact
from apps.inventory.models import Product, StockMovement, Warehouse
from apps.inventory.services.adjustments import create_stock_adjustment
from apps.organisations.models import Organisation, OrganisationMember
from apps.purchases.models import Bill, SupplierPayment
from apps.purchases.services.bills import approve_bill, create_bill
from apps.purchases.services.payments import create_supplier_payment
from apps.sales.models import CustomerPayment, Invoice
from apps.sales.services.invoices import approve_invoice, create_invoice
from apps.sales.services.payments import create_customer_payment


class Command(BaseCommand):
    help = "Create or safely update the idempotent Ledgify client-demo dataset."

    def add_arguments(self, parser):
        parser.add_argument("--email", default=os.getenv("LEDGIFY_DEMO_EMAIL", "demo@example.com"))
        parser.add_argument("--password", default=os.getenv("LEDGIFY_DEMO_PASSWORD"))

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG and "test" not in sys.argv and os.getenv("ALLOW_DEMO_SEED", "false").lower() not in {"1", "true", "yes"}:
            raise CommandError("Demo seeding is disabled outside DEBUG. Set ALLOW_DEMO_SEED=true explicitly.")
        email = options["email"].strip().lower()
        User = get_user_model()
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            if not options["password"]:
                raise CommandError(
                    "A password is required for a new demo user. Set LEDGIFY_DEMO_PASSWORD "
                    "or pass --password."
                )
            user = User.objects.create_user(
                username=email, email=email, password=options["password"],
                first_name="Demo", last_name="User",
            )

        organisation, _ = Organisation.objects.get_or_create(
            name="Ledgify Demo Ltd",
            defaults={
                "legal_name": "Ledgify Demo Ltd", "country_code": "GB",
                "base_currency": "GBP", "timezone": "Europe/London",
                "financial_year_start_month": 1, "created_by": user,
            },
        )
        OrganisationMember.objects.update_or_create(
            organisation=organisation, user=user,
            defaults={"role": OrganisationMember.Role.OWNER, "is_active": True},
        )

        account_specs = {
            "1000": ("Business Bank", "asset", "bank", "cash"),
            "1100": ("Accounts Receivable", "asset", "receivable", "operating"),
            "1200": ("Inventory", "asset", "current_asset", "operating"),
            "2000": ("Accounts Payable", "liability", "payable", "operating"),
            "3000": ("Retained Earnings", "equity", "retained_earnings", "financing"),
            "4000": ("Sales Revenue", "revenue", "sales", "operating"),
            "4100": ("Service Revenue", "revenue", "sales", "operating"),
            "5000": ("Cost of Goods Sold", "expense", "cost_of_sales", "operating"),
            "6100": ("Office Expenses", "expense", "operating_expense", "operating"),
            "6200": ("Software & Subscriptions", "expense", "operating_expense", "operating"),
            "6300": ("Utilities", "expense", "operating_expense", "operating"),
            "6400": ("Rent", "expense", "operating_expense", "operating"),
            "6500": ("Travel", "expense", "operating_expense", "operating"),
            "6600": ("Bad Debt Expense", "expense", "other_expense", "operating"),
        }
        accounts = {}
        for code, (name, account_type, account_class, cash_flow) in account_specs.items():
            accounts[code], _ = Account.objects.update_or_create(
                organisation=organisation, code=code,
                defaults={
                    "name": name, "account_type": account_type,
                    "account_class": account_class, "cash_flow_category": cash_flow,
                    "currency": "GBP", "status": Account.Status.ACTIVE,
                    "allow_manual_journals": True, "created_by": user,
                },
            )

        customer_names = [
            "Bluewave Consulting Ltd", "Greenfield Construction Ltd",
            "Northwind Retail Ltd", "Bright Tech Solutions Ltd",
        ]
        supplier_names = ["Microsoft", "Amazon Business", "BT", "Screwfix", "Office Depot"]
        customers = [self._contact(organisation, user, name, True, False, index)
                     for index, name in enumerate(customer_names, 1)]
        suppliers = [self._contact(organisation, user, name, False, True, index)
                     for index, name in enumerate(supplier_names, 1)]

        warehouse, _ = Warehouse.objects.update_or_create(
            organisation=organisation, code="MAIN",
            defaults={"name": "Main Warehouse", "status": Warehouse.Status.ACTIVE,
                      "is_default": True, "created_by": user},
        )
        product_specs = [
            ("LAPTOP", "Business Laptop", "goods", "899.00", "650.00", True),
            ("MONITOR", "27-inch Monitor", "goods", "249.00", "160.00", True),
            ("CHAIR", "Office Chair", "goods", "179.00", "110.00", True),
            ("PAPER", "Printer Paper", "goods", "6.50", "3.25", True),
            ("SUPPORT", "Accounting Support Service", "service", "125.00", "0.00", False),
        ]
        products = []
        for code, name, product_type, sales_price, purchase_price, tracked in product_specs:
            product, _ = Product.objects.update_or_create(
                organisation=organisation, code=code,
                defaults={
                    "name": name, "product_type": product_type, "unit": "each",
                    "sales_price": sales_price, "purchase_price": purchase_price,
                    "currency": "GBP", "track_inventory": tracked,
                    "inventory_asset_account": accounts["1200"] if tracked else None,
                    "sales_account": accounts["4000"] if tracked else accounts["4100"],
                    "cost_of_goods_sold_account": accounts["5000"] if tracked else None,
                    "status": Product.Status.ACTIVE, "created_by": user,
                },
            )
            products.append(product)

        bank, _ = BankAccount.objects.update_or_create(
            organisation=organisation, ledger_account=accounts["1000"],
            defaults={"name": "Business Current Account", "bank_name": "Demo Bank",
                      "account_number": "00001234", "sort_code": "00-00-00",
                      "currency": "GBP", "status": BankAccount.Status.ACTIVE,
                      "created_by": user},
        )
        today = timezone.localdate()
        for index, product in enumerate(products[:4], 1):
            reference = f"DEMO-STOCK-{index}"
            if not StockMovement.objects.filter(organisation=organisation, reference=reference).exists():
                create_stock_adjustment(
                    organisation=organisation, product=product, warehouse=warehouse,
                    adjustment_date=today - timedelta(days=12),
                    adjustment_type=StockMovement.MovementType.ADJUSTMENT_IN,
                    quantity="12", unit_cost=product.purchase_price,
                    offset_account=accounts["5000"], reference=reference,
                    description=f"Opening demo stock - {product.name}", user=user,
                )

        invoice_specs = [
            ("DEMO-INV-001", customers[0], today - timedelta(days=70), today - timedelta(days=45), "2400.00", "full"),
            ("DEMO-INV-002", customers[1], today - timedelta(days=42), today - timedelta(days=20), "1800.00", "partial"),
            ("DEMO-INV-003", customers[2], today - timedelta(days=8), today + timedelta(days=22), "950.00", "open"),
        ]
        for number, customer, issue, due, amount, payment in invoice_specs:
            invoice = Invoice.objects.filter(organisation=organisation, invoice_number=number).first()
            if invoice is None:
                invoice = create_invoice(
                    organisation=organisation, customer=customer, invoice_number=number,
                    issue_date=issue, due_date=due, currency="GBP", user=user,
                    lines=[{"description": "Professional services", "quantity": "1",
                            "unit_price": amount, "discount_amount": "0", "tax_rate": "0",
                            "revenue_account": accounts["4100"]}],
                )
                invoice = approve_invoice(invoice=invoice, user=user)
            if payment != "open" and not CustomerPayment.objects.filter(
                organisation=organisation, reference=f"PAY-{number}"
            ).exists():
                amount_paid = invoice.amount_due if payment == "full" else invoice.amount_due / 2
                create_customer_payment(
                    organisation=organisation, customer=customer, invoice=invoice,
                    bank_account=accounts["1000"], payment_date=today - timedelta(days=3),
                    amount=amount_paid, currency="GBP", reference=f"PAY-{number}", user=user,
                )

        bill_specs = [
            ("DEMO-BILL-001", suppliers[0], today - timedelta(days=66), today - timedelta(days=40), "720.00", "full"),
            ("DEMO-BILL-002", suppliers[1], today - timedelta(days=38), today - timedelta(days=12), "460.00", "partial"),
            ("DEMO-BILL-003", suppliers[2], today - timedelta(days=6), today + timedelta(days=24), "210.00", "open"),
        ]
        for number, supplier, issue, due, amount, payment in bill_specs:
            bill = Bill.objects.filter(organisation=organisation, bill_number=number).first()
            if bill is None:
                bill = create_bill(
                    organisation=organisation, supplier=supplier, bill_number=number,
                    issue_date=issue, due_date=due, currency="GBP", user=user,
                    lines=[{"description": "Business operating expense", "quantity": "1",
                            "unit_price": amount, "discount_amount": "0", "tax_rate": "0",
                            "expense_account": accounts["6200"]}],
                )
                bill = approve_bill(bill=bill, user=user)
            if payment != "open" and not SupplierPayment.objects.filter(
                organisation=organisation, reference=f"PAY-{number}"
            ).exists():
                amount_paid = bill.amount_due if payment == "full" else bill.amount_due / 2
                create_supplier_payment(
                    organisation=organisation, supplier=supplier, bill=bill,
                    bank_account=accounts["1000"], payment_date=today - timedelta(days=2),
                    amount=amount_paid, currency="GBP", reference=f"PAY-{number}", user=user,
                )

        for index, (kind, amount, description) in enumerate([
            (BankTransaction.TransactionType.MONEY_IN, "375.00", "Client receipt awaiting match"),
            (BankTransaction.TransactionType.MONEY_OUT, "89.00", "Office expense awaiting coding"),
        ], 1):
            external_id = f"DEMO-BANK-{index}"
            if not BankTransaction.objects.filter(
                organisation=organisation, bank_account=bank, external_id=external_id
            ).exists():
                create_bank_transaction(
                    organisation=organisation, bank_account=bank, transaction_date=today,
                    description=description, reference=external_id,
                    transaction_type=kind, amount=amount, currency="GBP",
                    external_id=external_id, user=user,
                )

        self.stdout.write(self.style.SUCCESS(
            f"Demo data ready for {organisation.name} ({email})."
        ))

    @staticmethod
    def _contact(organisation, user, name, customer, supplier, index):
        contact, _ = Contact.objects.update_or_create(
            organisation=organisation, name=name,
            defaults={
                "account_number": f"{'CUS' if customer else 'SUP'}-{index:03d}",
                "email": f"accounts{index}@example.test", "is_customer": customer,
                "is_supplier": supplier, "currency": "GBP", "country_code": "GB",
                "address_line_1": f"{index} Demo Street", "city": "London",
                "postal_code": "EC1A 1AA", "status": Contact.Status.ACTIVE,
                "created_by": user,
            },
        )
        return contact
