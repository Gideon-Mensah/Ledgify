"""Disabled extension boundary for a future authorised GRA connector.

No HTTP endpoint, API credential or fabricated certification is shipped. A future
implementation must use a backend vault with per-organisation encrypted secrets,
key rotation and redacted audit metadata; browser configuration is not a vault.
"""
from typing import Protocol
from common.exceptions import BusinessRuleError


class OrganisationCredentialVault(Protocol):
    def decrypt_for_request(self, *, organisation_id, credential_version):
        """Retrieve a rotated encrypted secret on the backend only; never log it."""
        ...


class AuthorisedGRAConnector(Protocol):
    def certify(self, *, organisation_id, immutable_invoice_snapshot, request_reference):
        """Must return an authenticated official response before certification is stored."""
        ...


def certification_status():
    return {'enabled': False, 'certified': False, 'status': 'NOT_CONNECTED',
            'requirements': ['Official GRA API/schema documentation', 'Sandbox credentials',
                             'Encrypted organisation credential vault', 'Integration testing and sign-off']}


def certify_invoice(**kwargs):
    raise BusinessRuleError('GRA E-VAT is disabled. No authorised connector has been configured.')
