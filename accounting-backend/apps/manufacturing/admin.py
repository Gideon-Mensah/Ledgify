from django.contrib import admin
from .models import BillOfMaterials,BOMComponent,BOMVersion,ProductionCostTransaction,ProductionOrder,ProductionOrderComponent
@admin.register(BillOfMaterials)
class BOMAdmin(admin.ModelAdmin):list_display=("code","name","product","organisation","status");list_filter=("status","organisation");search_fields=("code","name","product__name")
@admin.register(BOMVersion)
class VersionAdmin(admin.ModelAdmin):list_display=("bom","version_number","effective_from","effective_to","status");list_filter=("status",);search_fields=("bom__code","version_number")
@admin.register(BOMComponent)
class ComponentAdmin(admin.ModelAdmin):list_display=("bom_version","component_product","quantity","scrap_percentage","sequence");search_fields=("component_product__code","component_product__name")
@admin.register(ProductionOrder)
class OrderAdmin(admin.ModelAdmin):list_display=("order_number","product","warehouse","planned_quantity","status","start_date","due_date");list_filter=("status","warehouse");search_fields=("order_number","product__code")
@admin.register(ProductionOrderComponent)
class OrderComponentAdmin(admin.ModelAdmin):list_display=("production_order","product","required_quantity","issued_quantity","returned_quantity");readonly_fields=("production_order","product","bom_component","required_quantity","planned_unit_cost","planned_total_cost")
admin.site.register(ProductionCostTransaction)
