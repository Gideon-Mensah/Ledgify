import os
from django.core.mail import send_mail
from django.core.management.base import BaseCommand,CommandError
class Command(BaseCommand):
 help="Send one explicit production email configuration test."
 def add_arguments(self,parser):parser.add_argument("--to",required=True)
 def handle(self,*args,**options):
  required=["EMAIL_BACKEND","EMAIL_HOST","EMAIL_HOST_USER","EMAIL_HOST_PASSWORD","DEFAULT_FROM_EMAIL"]
  missing=[name for name in required if not os.environ.get(name)]
  if missing:raise CommandError("Email is NOT CONFIGURED; missing: "+", ".join(missing))
  sent=send_mail("Ledgify email configuration test","This confirms the configured Ledgify email transport.",os.environ["DEFAULT_FROM_EMAIL"],[options["to"]],fail_silently=False)
  if sent!=1:raise CommandError("Email provider did not accept the test message.")
  self.stdout.write(self.style.SUCCESS("Email test accepted by the configured provider."))
