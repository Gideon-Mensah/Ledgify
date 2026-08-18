from apps.inventory.services.reports import get_inventory_valuation,reorder_report,stock_on_hand
def inventory_context(*,organisation):return {"stock_on_hand":stock_on_hand(organisation=organisation),"valuation":get_inventory_valuation(organisation=organisation),"reorder":reorder_report(organisation=organisation)}
