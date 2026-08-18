from apps.banking.models import BankAccount,BankTransaction
def banking_context(*,organisation):return {"accounts":list(BankAccount.objects.filter(organisation=organisation).values("id","name","currency","status")),"unreconciled":list(BankTransaction.objects.filter(organisation=organisation,status="unreconciled").values("id","transaction_date","description","amount","currency"))}
