import os,uuid
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand,CommandError
class Command(BaseCommand):
 help="Write/read/delete a harmless object through configured persistent storage."
 def handle(self,*args,**options):
  if not os.environ.get("DEFAULT_FILE_STORAGE"):raise CommandError("Persistent object storage is NOT CONFIGURED.")
  name=f"health/ledgify-storage-{uuid.uuid4()}.txt"
  try:
   saved=default_storage.save(name,ContentFile(b"ledgify-storage-health"))
   with default_storage.open(saved,"rb") as handle:
    if handle.read()!=b"ledgify-storage-health":raise CommandError("Storage read-back did not match.")
  finally:
   if default_storage.exists(name):default_storage.delete(name)
  self.stdout.write(self.style.SUCCESS("Storage write/read/delete test passed."))
