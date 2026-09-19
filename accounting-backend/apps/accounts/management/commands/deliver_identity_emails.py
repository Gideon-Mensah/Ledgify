"""Run as a supervised worker; never logs recipients, message bodies or tokens."""
import time
from django.core.management.base import BaseCommand
from apps.accounts.identity import deliver_identity_emails


class Command(BaseCommand):
    help = 'Deliver queued registration and invitation emails through the configured backend.'
    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true')
        parser.add_argument('--limit', type=int, default=100)
    def handle(self, *args, **options):
        while True:
            accepted = deliver_identity_emails(limit=max(1, min(options['limit'], 1000)))
            self.stdout.write(f'Email backend accepted {accepted} messages.')
            if not options['loop']:
                break
            time.sleep(5)
