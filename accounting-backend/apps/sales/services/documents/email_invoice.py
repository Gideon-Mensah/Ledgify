"""At-most-once mail submission with durable attempts; SMTP acceptance is not delivery."""
import hashlib
import json
import math
import smtplib
import time
from email.utils import make_msgid
from html import escape
from uuid import UUID
from django.conf import settings
from django.core.cache import cache
from django.core.mail import EmailMultiAlternatives
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, Throttled
from common.documents import document_contract, render_pdf, safe_filename
from common.ledger_integrity import lock_ledger
from apps.sales.models import Invoice, InvoiceEmailAttempt


class EmailConflict(APIException):
    status_code=409
    default_detail="This email key was already used for a different submission."


class InvoiceEmailInput(serializers.Serializer):
    recipient=serializers.EmailField(required=False,max_length=254)
    subject=serializers.CharField(max_length=200)
    message=serializers.CharField(max_length=2000,allow_blank=True,default="")
    document_version=serializers.CharField(max_length=64,required=False)
    def validate(self,attrs):
        if any('\r' in attrs.get(f,'') or '\n' in attrs.get(f,'') for f in ('recipient','subject')):
            raise serializers.ValidationError("Email headers must contain a single line.")
        return attrs


def rate_limit(org,user):
    for scope,identifier,rate in (("user",user.pk,settings.INVOICE_EMAIL_USER_RATE),("organisation",org.pk,settings.INVOICE_EMAIL_ORGANISATION_RATE)):
        count,unit=rate.split('/');seconds={'m':60,'h':3600,'d':86400}[unit[0]];now=time.time();window=int(now//seconds)
        key=f'invoice-mail:{scope}:{identifier}:{window}'
        try: attempts=1 if cache.add(key,1,timeout=seconds+1) else cache.incr(key)
        except Exception:
            error=APIException("Email is temporarily unavailable.");error.status_code=503;raise error from None
        if attempts>int(count):raise Throttled(wait=math.ceil((window+1)*seconds-now))


def safe_result(attempt):
    return {"attempt_id":str(attempt.pk),"status":attempt.status,"recipient":attempt.recipient,
        "subject":attempt.subject,"created_at":attempt.created_at.isoformat(),"completed_at":attempt.completed_at.isoformat() if attempt.completed_at else None,
        "message_id":attempt.message_id,"failure_category":attempt.failure_category,
        "document_version":attempt.document_hash,
        "detail":{"sent":"Accepted for delivery. Recipient delivery has not been confirmed.","pending":"Submission is pending or its outcome is unknown. Do not submit a new key; ask an administrator to check this attempt.","failed":("Email is not configured for sending. Ask an administrator to check the SMTP settings." if attempt.failure_category=="configuration" else "Email was not confirmed as accepted. Review the failure before making a new submission.")}[attempt.status]}


def send_invoice(*,organisation,invoice,user,data,key):
    from apps.organisations.services import require_organisation_permission
    require_organisation_permission(organisation=organisation,user=user,permission="create_invoice")
    if invoice.organisation_id != organisation.pk:
        from django.http import Http404
        raise Http404()
    try:key=UUID(str(key))
    except (TypeError,ValueError):raise serializers.ValidationError({"Idempotency-Key":"A UUID is required."}) from None
    # Validate before DRF whitespace trimming can remove an injected header newline.
    if any(isinstance(data.get(f),str) and any(c in data[f] for c in '\r\n') for f in ('recipient','subject')):
        raise serializers.ValidationError("Email headers must contain a single line.")
    query=InvoiceEmailInput(data=data);query.is_valid(raise_exception=True);payload=query.validated_data
    payload['recipient']=payload.get('recipient') or invoice.customer.email
    try:validate_email(payload['recipient'])
    except Exception:raise serializers.ValidationError("Set the customer's email or enter a valid recipient.") from None
    digest=hashlib.sha256(json.dumps({'invoice':str(invoice.pk),**payload},sort_keys=True).encode()).hexdigest()
    with transaction.atomic():
        lock_ledger(organisation.pk)
        old=InvoiceEmailAttempt.objects.filter(organisation=organisation,key=key).first()
        if old:
            if old.payload_hash!=digest:raise EmailConflict()
            return safe_result(old)
        invoice=Invoice.objects.get(pk=invoice.pk,organisation=organisation)
        if invoice.status not in ('approved','sent','partly_paid','paid'):
            raise serializers.ValidationError("Only approved, sent, partly paid or paid invoices can be emailed.")
        contract=document_contract(organisation=organisation,kind='invoice',pk=invoice.pk)
        if payload.get('document_version') and payload['document_version'] != contract['version']:
            raise EmailConflict('The invoice changed. Reload it before emailing.')
        rate_limit(organisation,user)
        attempt=InvoiceEmailAttempt.objects.create(organisation=organisation,invoice=invoice,actor=user,key=key,payload_hash=digest,
            document_hash=contract['version'],recipient=payload['recipient'],subject=payload['subject'],message_id=make_msgid(domain=settings.DEFAULT_FROM_EMAIL.split('@')[-1]))
    # The pending record is committed before any external effect. Never auto-resend
    # pending/failed attempts: a worker crash or lost SMTP response is ambiguous.
    category=""
    try:
        backend=settings.EMAIL_BACKEND
        if backend in ('django.core.mail.backends.console.EmailBackend','django.core.mail.backends.filebased.EmailBackend','django.core.mail.backends.dummy.EmailBackend'):
            category='configuration';raise ValueError()
        if not settings.DEBUG and (backend!='django.core.mail.backends.smtp.EmailBackend' or not settings.EMAIL_HOST or 'localhost' in settings.DEFAULT_FROM_EMAIL):
            category='configuration';raise ValueError()
        validate_email(settings.DEFAULT_FROM_EMAIL)
        pdf=render_pdf(contract)
        message_id=attempt.message_id
        text=f"{payload['message']}\n\n{contract['title']} {contract['number']}\n"+"\n".join(f"{k}: {contract['currency']} {v}" for k,v in contract['totals'])+f"\n\n{contract['organisation']['name']}"
        html='<p>'+escape(payload['message']).replace('\n','<br>')+'</p><p>'+escape(contract['title']+' '+contract['number'])+'</p><p>'+escape(contract['organisation']['name'])+'</p>'
        mail=EmailMultiAlternatives(subject=payload['subject'],body=text,from_email=settings.DEFAULT_FROM_EMAIL,to=[payload['recipient']],headers={'Message-ID':message_id})
        mail.attach_alternative(html,'text/html');mail.attach(safe_filename(contract['number']),pdf,'application/pdf')
        if mail.send(fail_silently=False)!=1:category='not_accepted';raise ValueError()
        attempt.status='sent';attempt.message_id=message_id
    except smtplib.SMTPRecipientsRefused: category='recipient_rejected'
    except smtplib.SMTPAuthenticationError: category='configuration'
    except (TimeoutError,ConnectionError,OSError,smtplib.SMTPException): category='transport_unknown'
    except Exception: category=category or 'generation_or_configuration'
    if category:attempt.status='failed';attempt.failure_category=category
    attempt.completed_at=timezone.now()
    attempt.save(update_fields=['status','message_id','failure_category','completed_at'])
    return safe_result(attempt)
