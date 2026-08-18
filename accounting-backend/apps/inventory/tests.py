from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from common.exceptions import BusinessRuleError
from apps.accounting.models import Account, AccountingPeriod
from apps.inventory.models import (
    InventoryCostLayer, InventoryTransaction, Product, StockCount, StockMovement, Warehouse,
)
from apps.inventory.services.adjustments import create_stock_adjustment, reverse_stock_movement
from apps.inventory.services.stock import get_stock_quantity
from apps.inventory.services.valuation import get_inventory_valuation
from apps.inventory.services.reports import reorder_report
from apps.inventory.services.workflows import (
    create_stock_count, post_stock_count, receive_purchase, return_supplier_stock,
    start_stock_count, transfer_stock,
)
from apps.organisations.models import Organisation, OrganisationMember


class InventoryFoundationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="inventory", email="inventory@example.com", password="test"
        )
        self.organisation = Organisation.objects.create(
            name="Inventory Test", created_by=self.user
        )
        OrganisationMember.objects.create(
            organisation=self.organisation, user=self.user,
            role=OrganisationMember.Role.OWNER,
        )
        self.inventory_account = self._account(
            "INV", Account.AccountType.ASSET, Account.AccountClass.CURRENT_ASSET
        )
        self.offset_account = self._account(
            "ADJ", Account.AccountType.EXPENSE, Account.AccountClass.OTHER_EXPENSE
        )
        self.grni_account = self._account(
            "GRNI", Account.AccountType.LIABILITY, Account.AccountClass.CURRENT_LIABILITY
        )
        self.product = Product.objects.create(
            organisation=self.organisation, code="ITEM", name="Item",
            product_type=Product.ProductType.GOODS, unit="each",
            currency="GBP", track_inventory=True,
            inventory_asset_account=self.inventory_account, created_by=self.user,
        )
        self.warehouse = Warehouse.objects.create(
            organisation=self.organisation, code="MAIN", name="Main",
            is_default=True, created_by=self.user,
        )

    def _account(self, code, account_type, account_class):
        return Account.objects.create(
            organisation=self.organisation, code=code, name=code,
            account_type=account_type, account_class=account_class,
            created_by=self.user,
        )

    def _adjust(self, adjustment_type, quantity, unit_cost="5.00"):
        return create_stock_adjustment(
            organisation=self.organisation, product=self.product,
            warehouse=self.warehouse, adjustment_date=date(2026, 8, 12),
            adjustment_type=adjustment_type, quantity=quantity,
            unit_cost=unit_cost, offset_account=self.offset_account,
            user=self.user,
        )

    def test_adjustments_post_expected_journals_and_derive_quantity(self):
        incoming = self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "10")
        outgoing = self._adjust(StockMovement.MovementType.ADJUSTMENT_OUT, "3")
        self.assertEqual(get_stock_quantity(
            organisation=self.organisation, product=self.product,
            warehouse=self.warehouse,
        ), Decimal("7.0000"))
        incoming_lines = {line.account_id: (line.debit, line.credit)
                          for line in incoming.accounting_journal.lines.all()}
        outgoing_lines = {line.account_id: (line.debit, line.credit)
                          for line in outgoing.accounting_journal.lines.all()}
        self.assertEqual(incoming_lines[self.inventory_account.id],
                         (Decimal("50.00"), Decimal("0.00")))
        self.assertEqual(outgoing_lines[self.inventory_account.id],
                         (Decimal("0.00"), Decimal("15.00")))

    def test_negative_stock_is_rejected_and_valuation_uses_latest_wac_layer(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "4", "2.50")
        with self.assertRaises(BusinessRuleError):
            self._adjust(StockMovement.MovementType.ADJUSTMENT_OUT, "5", "2.50")
        valuation = get_inventory_valuation(
            organisation=self.organisation, product=self.product,
            warehouse=self.warehouse,
        )
        self.assertEqual(valuation["method"], "perpetual_weighted_average")
        self.assertEqual(valuation["items"][0]["value"], Decimal("10.00"))

    def test_reversal_creates_opposite_movement_and_preserves_original(self):
        original = self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "2")
        reversal = reverse_stock_movement(movement=original, user=self.user)
        original.refresh_from_db()
        self.assertEqual(original.status, StockMovement.Status.POSTED)
        self.assertEqual(reversal.reversal_of_id, original.id)
        self.assertEqual(reversal.movement_type, StockMovement.MovementType.ADJUSTMENT_OUT)
        self.assertEqual(get_stock_quantity(
            organisation=self.organisation, product=self.product,
            warehouse=self.warehouse,
        ), Decimal("0.0000"))

    def test_weighted_average_formula_and_issue_cost_are_deterministic(self):
        first = self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "10", "10.00")
        first_layer = first.cost_layer
        second = self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "10", "20.00")
        second_layer = second.cost_layer
        issue = self._adjust(StockMovement.MovementType.ADJUSTMENT_OUT, "4", "999.00")
        issue_layer = issue.cost_layer

        self.assertEqual(first_layer.average_unit_cost, Decimal("10.00000000"))
        self.assertEqual(second_layer.quantity_on_hand, Decimal("20.0000"))
        self.assertEqual(second_layer.total_cost, Decimal("300.0000"))
        self.assertEqual(second_layer.average_unit_cost, Decimal("15.00000000"))
        self.assertEqual(issue.unit_cost, Decimal("15.00000000"))
        self.assertEqual(issue.total_cost, Decimal("60.0000"))
        self.assertEqual(issue_layer.quantity_on_hand, Decimal("16.0000"))
        self.assertEqual(issue_layer.total_cost, Decimal("240.0000"))
        self.assertEqual(issue_layer.average_unit_cost, Decimal("15.00000000"))
        self.assertEqual(InventoryCostLayer.objects.count(), 3)

    def test_historical_cost_layers_are_immutable(self):
        movement = self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "2")
        layer = movement.cost_layer
        layer.total_cost = Decimal("999.0000")
        with self.assertRaises(BusinessRuleError):
            layer.save()
        with self.assertRaises(BusinessRuleError):
            layer.delete()

    def test_purchase_receipt_posts_inventory_and_grni_at_receipt_cost(self):
        receipt = receive_purchase(
            organisation=self.organisation, product=self.product, warehouse=self.warehouse,
            receipt_date=date(2026, 8, 12), quantity="8", unit_cost="12.50",
            grni_account=self.grni_account, reference="GRN-001", user=self.user,
        )
        lines = {line.account_id: (line.debit, line.credit)
                 for line in receipt.accounting_journal.lines.all()}
        self.assertEqual(lines[self.inventory_account.id], (Decimal("100.00"), Decimal("0.00")))
        self.assertEqual(lines[self.grni_account.id], (Decimal("0.00"), Decimal("100.00")))
        self.assertEqual(receipt.primary_movement.cost_layer.average_unit_cost,
                         Decimal("12.50000000"))

    def test_transfer_preserves_total_value_and_posts_no_journal(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "10", "7.25")
        destination = Warehouse.objects.create(
            organisation=self.organisation, code="SECOND", name="Second", created_by=self.user,
        )
        transfer = transfer_stock(
            organisation=self.organisation, product=self.product,
            source_warehouse=self.warehouse, destination_warehouse=destination,
            transfer_date=date(2026, 8, 12), quantity="4", reference="TRF-001", user=self.user,
        )
        self.assertIsNone(transfer.accounting_journal_id)
        self.assertEqual(transfer.primary_movement.total_cost, Decimal("29.0000"))
        self.assertEqual(transfer.secondary_movement.total_cost, Decimal("29.0000"))
        valuation = get_inventory_valuation(organisation=self.organisation)
        self.assertEqual(valuation["value"], Decimal("72.5000"))

    def test_supplier_return_uses_current_wac_and_rejects_negative_stock(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "5", "9.00")
        returned = return_supplier_stock(
            organisation=self.organisation, product=self.product, warehouse=self.warehouse,
            return_date=date(2026, 8, 12), quantity="2", settlement_account=self.grni_account,
            reference="RTS-001", user=self.user,
        )
        self.assertEqual(returned.unit_cost, Decimal("9.00000000"))
        self.assertEqual(returned.primary_movement.cost_layer.quantity_on_hand, Decimal("3.0000"))
        with self.assertRaises(BusinessRuleError):
            return_supplier_stock(
                organisation=self.organisation, product=self.product, warehouse=self.warehouse,
                return_date=date(2026, 8, 12), quantity="4", settlement_account=self.grni_account,
                reference="RTS-002", user=self.user,
            )

    def test_stock_count_posts_only_variance_and_is_immutable_after_posting(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "10", "4.00")
        count = create_stock_count(
            organisation=self.organisation, warehouse=self.warehouse,
            count_date=date(2026, 8, 12), reference="COUNT-001",
            offset_account=self.offset_account, products=[self.product], user=self.user,
        )
        line = count.lines.get()
        self.assertEqual(line.expected_quantity, Decimal("10.0000"))
        start_stock_count(stock_count=count, user=self.user)
        post_stock_count(stock_count=count, counts={str(self.product.id): "8"}, user=self.user)
        count.refresh_from_db(); line.refresh_from_db()
        self.assertEqual(count.status, StockCount.Status.POSTED)
        self.assertEqual(line.adjustment_movement.quantity, Decimal("2"))
        self.assertEqual(get_stock_quantity(
            organisation=self.organisation, product=self.product, warehouse=self.warehouse,
        ), Decimal("8.0000"))
        with self.assertRaises(BusinessRuleError):
            post_stock_count(stock_count=count, counts={str(self.product.id): "8"}, user=self.user)

    def test_zero_variance_stock_count_creates_no_movement(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "3", "4.00")
        count = create_stock_count(
            organisation=self.organisation, warehouse=self.warehouse,
            count_date=date(2026, 8, 12), reference="COUNT-ZERO",
            offset_account=self.offset_account, products=[self.product], user=self.user,
        )
        start_stock_count(stock_count=count, user=self.user)
        before = StockMovement.objects.count()
        result = post_stock_count(
            stock_count=count, counts={str(self.product.id): "3"}, user=self.user,
        )
        self.assertEqual(result, [])
        self.assertEqual(StockMovement.objects.count(), before)

    def test_stock_count_expected_quantity_uses_count_date(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "5", "2.00")
        later = self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "2", "2.00")
        StockMovement.objects.filter(pk=later.pk).update(movement_date=date(2026, 8, 13))
        count = create_stock_count(
            organisation=self.organisation, warehouse=self.warehouse,
            count_date=date(2026, 8, 12), reference="COUNT-AS-OF",
            offset_account=self.offset_account, products=[self.product], user=self.user,
        )
        self.assertEqual(count.lines.get().expected_quantity, Decimal("5.0000"))

    def test_reorder_report_uses_explicit_or_maximum_recommendation(self):
        self.product.minimum_quantity = Decimal("5")
        self.product.maximum_quantity = Decimal("12")
        self.product.reorder_quantity = Decimal("0")
        self.product.save()
        row = reorder_report(organisation=self.organisation)[0]
        self.assertEqual(row["quantity_on_hand"], Decimal("0.0000"))
        self.assertEqual(row["recommended_order_quantity"], Decimal("12.0000"))

    def test_transfer_is_rejected_in_locked_period(self):
        self._adjust(StockMovement.MovementType.ADJUSTMENT_IN, "5", "2.00")
        destination = Warehouse.objects.create(
            organisation=self.organisation, code="LOCKED", name="Locked", created_by=self.user,
        )
        AccountingPeriod.objects.create(
            organisation=self.organisation, name="August 2026",
            start_date=date(2026, 8, 1), end_date=date(2026, 8, 31),
            status=AccountingPeriod.Status.LOCKED,
        )
        with self.assertRaises(BusinessRuleError):
            transfer_stock(
                organisation=self.organisation, product=self.product,
                source_warehouse=self.warehouse, destination_warehouse=destination,
                transfer_date=date(2026, 8, 12), quantity="1", reference="LOCK-TRF",
                user=self.user,
            )

    def test_inventory_transaction_history_is_immutable(self):
        receipt = receive_purchase(
            organisation=self.organisation, product=self.product, warehouse=self.warehouse,
            receipt_date=date(2026, 8, 12), quantity="1", unit_cost="1",
            grni_account=self.grni_account, reference="IMMUTABLE", user=self.user,
        )
        receipt.description = "changed"
        with self.assertRaises(BusinessRuleError):
            receipt.save()
        with self.assertRaises(BusinessRuleError):
            receipt.delete()

    def test_inventory_workflow_rejects_cross_organisation_warehouse(self):
        other = Organisation.objects.create(name="Other", created_by=self.user)
        other_warehouse = Warehouse.objects.create(
            organisation=other, code="OTHER", name="Other", created_by=self.user,
        )
        with self.assertRaises(BusinessRuleError):
            receive_purchase(
                organisation=self.organisation, product=self.product,
                warehouse=other_warehouse, receipt_date=date(2026, 8, 12),
                quantity="1", unit_cost="1", grni_account=self.grni_account,
                reference="CROSS-ORG", user=self.user,
            )
