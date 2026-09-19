from django.core.management.base import BaseCommand
from django.db.models import Count
from django.db.models.functions import Lower, Trim
from apps.accounts.models import User


class Command(BaseCommand):
    help = 'Read-only duplicate identity audit. Prints user IDs, never email addresses.'
    def handle(self, *args, **options):
        groups = User.objects.annotate(normalised=Lower(Trim('email'))).values('normalised').annotate(total=Count('id')).filter(total__gt=1)
        for group in groups:
            ids = User.objects.annotate(normalised=Lower(Trim('email'))).filter(normalised=group['normalised']).values_list('id', flat=True)
            self.stdout.write('Conflicting user IDs: ' + ', '.join(str(pk) for pk in ids))
        self.stdout.write(f'Collision groups: {groups.count()}. No changes made.')
