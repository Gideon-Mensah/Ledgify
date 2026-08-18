"""Provide a vendor-neutral boundary while deterministic accounting tools stay authoritative."""

from abc import ABC,abstractmethod
from django.conf import settings
class AIProvider(ABC):
 @abstractmethod
 def generate(self,*,messages,context):raise NotImplementedError
class DisabledProvider(AIProvider):
 def generate(self,*,messages,context):return None
def get_provider():
 # Vendor adapters can be registered here; accounting tools remain provider-neutral.
 return DisabledProvider()
def provider_status():return {"enabled":bool(getattr(settings,"AI_ENABLED",False)),"provider":getattr(settings,"AI_PROVIDER","disabled"),"model":getattr(settings,"AI_MODEL","")}
