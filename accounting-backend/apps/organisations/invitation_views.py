from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from common.views import OrganisationScopedViewSetMixin
from .models import OrganisationInvitation, OrganisationMember
from .invitation_services import allowed_roles, create_invitation, change_invitation, invitation_for_user
from apps.accounts.identity_throttles import PublicIdentityThrottle
from rest_framework.exceptions import PermissionDenied


class InvitationInput(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    role = serializers.ChoiceField(choices=OrganisationMember.Role.choices)
    message = serializers.CharField(max_length=500, required=False, allow_blank=True)


def representation(invitation):
    state = 'expired' if invitation.status == 'pending' and invitation.expires_at <= timezone.now() else invitation.status
    latest = invitation.identityemailattempt_set.order_by('-created_at').first()
    return {'id': str(invitation.pk), 'email': invitation.email, 'role': invitation.role, 'status': state,
        'created_at': invitation.created_at, 'expires_at': invitation.expires_at, 'message': invitation.message,
        'invited_by': str(invitation.invited_by_id), 'accepted_at': invitation.accepted_at, 'revoked_at': invitation.revoked_at,
        'email_status': latest.status if latest else 'not_requested'}


class InvitationsView(OrganisationScopedViewSetMixin, APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        org = self.get_organisation()
        roles = allowed_roles(org, request.user)
        if not roles:
            raise PermissionDenied('Invitation management is unavailable.')
        pagination = PageNumberPagination()
        pagination.page_size = 50
        rows = pagination.paginate_queryset(OrganisationInvitation.objects.filter(organisation=org).order_by('-created_at', '-id'), request)
        return Response({'roles': roles, 'invitations': [representation(i) for i in rows], 'count': pagination.page.paginator.count, 'next': pagination.get_next_link(), 'previous': pagination.get_previous_link()})

    def post(self, request):
        serializer = InvitationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation = create_invitation(self.get_organisation(), request.user, **serializer.validated_data)
        return Response({'detail': 'Invitation request accepted. Email status means backend acceptance, not guaranteed delivery.', 'invitation': representation(invitation)}, status=202)


class InvitationActionView(OrganisationScopedViewSetMixin, APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, invitation_id, operation):
        obj = change_invitation(self.get_organisation(), request.user, invitation_id, operation)
        return Response(representation(obj))


class InvitationAcceptanceView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PublicIdentityThrottle]
    def post(self, request):
        confirmed = request.data.get('confirmed') is True
        invitation = invitation_for_user(request.user, request.data.get('token'), accept=confirmed)
        return Response({'organisation_id': str(invitation.organisation_id), 'organisation_name': invitation.organisation.name,
            'role': invitation.role, 'message': invitation.message, 'accepted': confirmed})
