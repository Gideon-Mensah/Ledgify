from apps.fixed_assets.models import FixedAsset
def fixed_asset_context(*,organisation):return list(FixedAsset.objects.filter(organisation=organisation).values("id","asset_number","asset_name","status","cost","residual_value"))
