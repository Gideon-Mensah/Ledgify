from django.conf import settings
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission


class AIEnabledPermission(BasePermission):
    """Keep the complete AI implementation inaccessible while the feature flag is off."""

    def has_permission(self, request, view):
        if not settings.AI_ENABLED:
            raise NotFound("The AI Assistant is currently unavailable.")
        return True
