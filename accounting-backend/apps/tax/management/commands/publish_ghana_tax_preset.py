"""Publish a verified platform catalogue without changing organisation applicability."""
import json
from datetime import date
from pathlib import Path
from urllib.parse import urlparse
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from apps.tax.configuration import digest
from apps.tax.engine import validate_components
from apps.tax.models import TaxRegimeVersion


class Command(BaseCommand):
    help = 'Validate a reviewed Ghana VAT preset file; publication requires --publish and a platform reviewer.'

    def add_arguments(self, parser):
        parser.add_argument('file')
        parser.add_argument('--reviewer', required=True)
        parser.add_argument('--publish', action='store_true')

    def handle(self, *args, **options):
        reviewer = get_user_model().objects.filter(pk=options['reviewer'], is_active=True, is_staff=True).first()
        if not reviewer:
            raise CommandError('An active platform staff reviewer is required.')
        try:
            data = json.loads(Path(options['file']).read_text())
            source = urlparse(data['source'])
            if source.scheme != 'https' or source.hostname not in {'gra.gov.gh','www.gra.gov.gh'}:
                raise ValueError('Use an official HTTPS GRA source.')
            if data.get('verified') is not True or not data.get('review_note','').strip():
                raise ValueError('Explicit verification and a review note are required.')
            start = date.fromisoformat(data['effective_from'])
            checked = date.fromisoformat(data['source_checked_on'])
            if checked > timezone.localdate():raise ValueError('Source verification cannot be dated in the future.')
            components = data['components']
            validate_components(components, confirm_high=data.get('confirm_high') is True)
            for component in components:
                if data['version']=='2026.1' and (component.get('depends_on') or component.get('kind','PERCENT') != 'PERCENT'):
                    raise ValueError('This Ghana VAT publisher supports percentage components on a common base.')
                if component.get('input_account') or component.get('output_account'):
                    raise ValueError('Global presets must not contain organisation account mappings.')
            version = str(data['version']).strip()
            if not version or len(version)>40:raise ValueError('Invalid preset version.')
        except (ValueError, KeyError, TypeError, OSError) as error:
            raise CommandError(str(error)) from error
        if TaxRegimeVersion.objects.filter(jurisdiction='GH', regime='GHANA_VAT', version=version).exists():
            raise CommandError('This version is already published; published history cannot be replaced.')
        if not options['publish']:
            self.stdout.write('Validated only. No catalogue or organisation data changed. Use --publish after review.')
            return
        catalogue={'components':components,'review_note':data['review_note'],'published_by':str(reviewer.pk),'published_at':timezone.now().isoformat()}
        with transaction.atomic():
            TaxRegimeVersion.objects.create(jurisdiction='GH',regime='GHANA_VAT',version=version,effective_from=start,
                source=data['source'],source_checked_on=checked,catalogue=catalogue,checksum=digest(catalogue),verified=True)
        self.stdout.write('Immutable preset published. Organisation adoption remains explicit and separately approved.')
