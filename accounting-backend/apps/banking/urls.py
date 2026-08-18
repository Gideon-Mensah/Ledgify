from rest_framework.routers import DefaultRouter

from .views import (
    BankAccountViewSet,
    BankTransactionViewSet,
    BankImportViewSet, BankRuleViewSet,
)


router = DefaultRouter()
router.register("bank-imports", BankImportViewSet, basename="bank-import")
router.register("bank-rules", BankRuleViewSet, basename="bank-rule")

router.register(
    "bank-accounts",
    BankAccountViewSet,
    basename="bank-account",
)

router.register(
    "bank-transactions",
    BankTransactionViewSet,
    basename="bank-transaction",
)

urlpatterns = router.urls
