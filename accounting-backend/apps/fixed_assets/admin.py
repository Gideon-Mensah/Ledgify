from django.contrib import admin
from .models import DepreciationSchedule,FixedAsset,FixedAssetCategory,FixedAssetDisposal
admin.site.register([FixedAssetCategory,FixedAsset,DepreciationSchedule,FixedAssetDisposal])
