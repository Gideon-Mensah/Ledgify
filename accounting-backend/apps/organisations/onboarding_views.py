from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import ValidationError, PermissionDenied
from common.views import OrganisationScopedViewSetMixin
from apps.accounts.models import PolicyAcceptance, User
from apps.accounts.identity import require_registration_configuration, audit
from django.conf import settings
from django.db import transaction
from .models import OnboardingDraft, OrganisationSetup
from .onboarding import options, save_draft, finish_onboarding
from .serializers import OrganisationSerializer


class OnboardingView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        draft = OnboardingDraft.objects.filter(user=request.user).first()
        return Response({'options': options(), 'policy_required': not PolicyAcceptance.objects.filter(user=request.user).exists(), 'data': draft.data if draft else {}, 'step': draft.step if draft else 0,
            'organisation_id': str(draft.organisation_id) if draft and draft.organisation_id else None})

    def put(self, request):
        draft = save_draft(request.user, request.data.get('data', {}), request.data.get('step', 0))
        return Response({'data': draft.data, 'step': draft.step, 'detail':'Setup progress saved.'})

    def post(self, request):
        org = finish_onboarding(request.user, request.data.get('data', {}), request.data.get('idempotency_key'), request.data.get('confirmed'))
        return Response({'organisation': OrganisationSerializer(org, context={'request':request}).data}, status=201)


class SetupChecklistView(OrganisationScopedViewSetMixin, APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        setup = OrganisationSetup.objects.filter(organisation=self.get_organisation()).first()
        from apps.tax.configuration import profile_on, local_today
        checklist = {**setup.checklist, 'tax': bool(profile_on(setup.organisation, local_today(setup.organisation)))} if setup else None
        return Response({'checklist': checklist, 'opening_choice': setup.opening_choice if setup else None})

    @transaction.atomic
    def patch(self, request):
        self.require_permission('manage_organisation_users')
        setup = OrganisationSetup.objects.select_for_update().filter(organisation=self.get_organisation()).first()
        key = request.data.get('item')
        if not setup or key not in {'customers','suppliers','opening','bank','invoice','team'} or request.data.get('dismissed') is not True:
            raise ValidationError('Only optional setup tasks can be dismissed.')
        setup.checklist = {**setup.checklist, key: True}
        setup.save(update_fields=['checklist'])
        audit('SETUP_TASK_DISMISSED', request.user, setup.organisation, setup.organisation, item=key)
        return Response({'checklist':setup.checklist})
