"""Database-backed replay of completed financial requests."""
import hashlib
import json
from decimal import Decimal
from uuid import UUID
from django.db import transaction, models
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from common.ledger_integrity import lock_ledger


class IdempotencyConflict(APIException):
    status_code=409
    default_detail='This idempotency key was already used for a different payment.'


def canonical(value):
    if isinstance(value,models.Model):return str(value.pk)
    if isinstance(value,Decimal):return format(value.normalize(),'f')
    if isinstance(value,dict):return {key:canonical(item) for key,item in sorted(value.items())}
    if isinstance(value,(list,tuple)):return [canonical(item) for item in value]
    if hasattr(value,'isoformat'):return value.isoformat()
    if isinstance(value,UUID):return str(value)
    return value


class IdempotentPaymentCreateMixin:
    @transaction.atomic
    def create(self,request,*args,**kwargs):
        from apps.accounting.models import PaymentRequest
        try:key=UUID(request.headers.get('Idempotency-Key',''))
        except (ValueError,TypeError,AttributeError):
            raise ValidationError({'Idempotency-Key':'Supply a client-generated UUID for this payment submission.'}) from None
        organisation=self.get_organisation()
        lock_ledger(organisation.pk)
        serializer=self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload={'reference':'','notes':'',self.payment_document_field:None,**serializer.validated_data}
        digest=hashlib.sha256(json.dumps(canonical(payload),sort_keys=True,separators=(',',':')).encode()).hexdigest()
        record,_=PaymentRequest.objects.get_or_create(organisation=organisation,operation=self.payment_operation,key=key,defaults={'payload_hash':digest})
        record=PaymentRequest.objects.select_for_update().get(pk=record.pk)
        if record.payload_hash!=digest:raise IdempotencyConflict()
        if record.response is not None:
            return Response(record.response,status=201,headers={'Idempotency-Replayed':'true'})
        payment=serializer.save()
        record.result_id=payment.pk
        record.response=json.loads(JSONRenderer().render(serializer.data))
        record.save(update_fields=['result_id','response'])
        return Response(record.response,status=201,headers={'Idempotency-Replayed':'false'})
