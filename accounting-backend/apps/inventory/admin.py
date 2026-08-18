from django.contrib import admin

from .models import InventoryCostLayer, Product, StockMovement, Warehouse


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "product_type", "track_inventory", "status", "organisation")
    list_filter = ("product_type", "track_inventory", "status", "organisation")
    search_fields = ("code", "name", "description")
    autocomplete_fields = (
        "organisation", "inventory_asset_account", "sales_account",
        "cost_of_goods_sold_account", "created_by",
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "is_default", "status", "organisation")
    list_filter = ("is_default", "status", "organisation")
    search_fields = ("code", "name", "city")
    autocomplete_fields = ("organisation", "created_by")
    readonly_fields = ("created_at", "updated_at")


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = (
        "movement_date", "product", "warehouse", "movement_type",
        "quantity", "unit_cost", "status",
    )
    list_filter = ("movement_type", "status", "organisation")
    search_fields = ("product__code", "product__name", "reference", "description")
    readonly_fields = (
        "organisation", "product", "warehouse", "movement_date", "movement_type",
        "quantity", "unit_cost", "total_cost", "reference", "description",
        "source_type", "source_id", "status", "accounting_journal", "reversal_of",
        "created_by", "posted_by", "posted_at", "created_at", "updated_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(InventoryCostLayer)
class InventoryCostLayerAdmin(admin.ModelAdmin):
    list_display = (
        "effective_date", "product", "warehouse", "quantity_on_hand",
        "average_unit_cost", "total_cost",
    )
    list_filter = ("organisation", "warehouse", "effective_date")
    search_fields = ("product__code", "product__name", "warehouse__code")
    readonly_fields = (
        "id", "organisation", "product", "warehouse", "movement",
        "quantity_on_hand", "total_cost", "average_unit_cost",
        "effective_date", "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
