"""Explicit tax actions. No generic update/delete surface for immutable history."""
from datetime import date
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.db import transaction
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet
from common.permissions import OrganisationActionPermission
from common.views import OrganisationScopedViewSetMixin
from common.exceptions import BusinessRuleError
from common.ledger_integrity import lock_ledger
from . import configuration as config
from . import returns as reports
from .models import (OrganisationTaxProfile, TaxCode, TaxRateVersion, TaxConfigurationAudit,
    TaxRegimeVersion, TaxPeriod, TaxReturnDraft, TaxFilingEvidence, TaxClassification,
    TaxCalendarEntry, OrganisationTaxRegistration, WithholdingTransaction, TaxPayment)
from .presets import CONTROL_ROLES, OVERRIDE_NOTICE, TRACKING_OBLIGATIONS
from .engine import calculate_components


def row(obj,exclude=()):
    return {field.name:config.serial(getattr(obj,field.attname)) for field in obj._meta.fields if field.name not in set(exclude)|{'content'}}


def evidence_file(request):
    import hashlib
    file=request.FILES.get('file')
    if not file or file.size>5_000_000:raise BusinessRuleError('Upload a PDF, PNG or JPEG under 5 MB.')
    data=file.read()
    mime='application/pdf' if data.startswith(b'%PDF-') else 'image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if data.startswith(b'\xff\xd8\xff') else None
    if not mime:raise BusinessRuleError('Unsupported evidence format.')
    return {'filename':file.name[:200],'content_type':mime,'content':data,'checksum':hashlib.sha256(data).hexdigest()}


class ProfileInput(serializers.Serializer):
    structure=serializers.ChoiceField(choices=['GHANA_GRA','CUSTOM_INTERNATIONAL','NO_TAX'])
    jurisdiction=serializers.RegexField(r'^[A-Z]{2}$')
    effective_from=serializers.DateField()
    registration=serializers.DictField()
    mappings=serializers.DictField(child=serializers.UUIDField())
    reason=serializers.CharField(max_length=2000)
    source=serializers.CharField(max_length=500,allow_blank=True,required=False)
    maximum_rate=serializers.DecimalField(max_digits=12,decimal_places=4,required=False,min_value=0)
    high_rate_threshold=serializers.DecimalField(max_digits=12,decimal_places=4,required=False,min_value=0)
    separate_approval=serializers.BooleanField(required=False)


class CodeInput(serializers.Serializer):
    code=serializers.RegexField(r'^[A-Z0-9_-]{1,40}$')
    name=serializers.CharField(max_length=150)
    family=serializers.ChoiceField(choices=['INDIRECT','WHT','VAT_WHT'],default='INDIRECT')
    scope=serializers.ChoiceField(choices=['SALES','PURCHASES','BOTH'],default='BOTH')
    jurisdiction=serializers.RegexField(r'^[A-Z]{2}$')


class ComponentInput(serializers.Serializer):
    code=serializers.RegexField(r'^[A-Z0-9_-]{1,30}$')
    name=serializers.CharField(max_length=100)
    kind=serializers.ChoiceField(choices=['PERCENT','FIXED'],default='PERCENT')
    rate=serializers.DecimalField(max_digits=12,decimal_places=4,min_value=0)
    recoverable_percent=serializers.DecimalField(max_digits=7,decimal_places=4,min_value=0,max_value=100,default=100)
    depends_on=serializers.ListField(child=serializers.CharField(max_length=30),max_length=12,default=list)
    output_account=serializers.UUIDField(required=False,allow_null=True)
    input_account=serializers.UUIDField(required=False,allow_null=True)
    reporting_group=serializers.CharField(max_length=60,required=False,allow_blank=True)


class VersionInput(serializers.Serializer):
    effective_from=serializers.DateField()
    effective_to=serializers.DateField(required=False,allow_null=True,default=None)
    classification=serializers.ChoiceField(choices=['STANDARD','ZERO','EXEMPT','OUT_SCOPE','IMPORT_GOODS','IMPORT_SERVICES','REVERSE_CHARGE'])
    components=ComponentInput(many=True)
    rules=serializers.DictField(default=dict)
    source=serializers.CharField(max_length=500)
    reason=serializers.CharField(max_length=2000)
    confirm_high=serializers.BooleanField(default=False)


def validated(cls,request):
    serializer=cls(data=request.data);serializer.is_valid(raise_exception=True);return serializer.validated_data


def request_key(request):
    return serializers.UUIDField().run_validation(request.data.get('idempotency_key'))


def request_date(value):
    return serializers.DateField().run_validation(value)


def version_row(version, organisation):
    data=row(version);window=getattr(version,'window',None);today=config.local_today(organisation)
    display=version.status
    if window:
        if window.start>today:display='SCHEDULED'
        elif window.end and window.end<today:
            display='SUPERSEDED' if version.code.versions.filter(window__start__gt=window.end).exists() else 'RETIRED'
        else:display='ACTIVE'
    return {**data,'display_status':display,'verification_state':'PENDING_REVIEW' if version.status in {'DRAFT','PENDING_APPROVAL'} else 'RETIRED' if display=='RETIRED' else version.provenance}


class TaxInputErrorsMixin:
    def initial(self,request,*args,**kwargs):
        super().initial(request,*args,**kwargs)
        from collections.abc import Mapping
        if request.method not in {'GET','HEAD','OPTIONS'} and not isinstance(request.data,Mapping):
            raise serializers.ValidationError('Send an object containing the tax action fields.')

    def handle_exception(self,exc):
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.db import IntegrityError
        if isinstance(exc,DjangoValidationError):exc=serializers.ValidationError('Invalid tax reference or field value.')
        elif isinstance(exc,IntegrityError):exc=serializers.ValidationError('This tax action conflicts with existing history. Refresh and review the saved records.')
        return super().handle_exception(exc)


class TaxConfigurationViewSet(TaxInputErrorsMixin,OrganisationScopedViewSetMixin,ViewSet):
    permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={key:'view_tax' for key in ['list','history','presets','codes','versions','dashboard']}
    action_permissions.update({'profile':'configure_tax','profile_review':'approve_tax_changes','profile_activate':'activate_tax_changes',
        'new_code':'configure_tax','new_version':'draft_tax_changes','version_approve':'approve_tax_changes','version_activate':'activate_tax_changes',
        'version_emergency':'emergency_activate_tax','version_impact':'view_tax','version_transition':'view_tax','preview':'view_tax','classify':'assign_tax_codes',
        'adopt':'adopt_tax_presets','history_export':'export_gra_schedules','retire':'retire_tax_components','calendar':'configure_tax','obligation_evidence':'configure_tax','calendar_status':'view_tax','classifications':'view_tax','recommendations':'view_tax','map_controls':'map_tax_accounts','debit_note':'view_accounting','withholding_preview':'view_accounting'})

    def list(self,request):
        org=self.get_organisation()
        return Response({'profiles':[row(p) for p in OrganisationTaxProfile.objects.filter(organisation=org).order_by('-version')],
            'control_roles':CONTROL_ROLES,'tracking_only_obligations':TRACKING_OBLIGATIONS,'override_notice':OVERRIDE_NOTICE if org.country_code=='GH' else 'Organisation-created tax rules require review by your tax adviser.',
            'evat':{'enabled':False,'status':'NOT_CONNECTED','notice':'Official GRA documentation, credentials, testing and sign-off are required.'}})

    @action(detail=False,methods=['post'])
    def profile(self,request):
        data=validated(ProfileInput,request);data['mappings']=config.serial(data['mappings'])
        return Response(row(config.create_profile(organisation=self.get_organisation(),user=request.user,**data)),status=201)

    @action(detail=False,methods=['post'],url_path='profiles/(?P<profile_id>[^/.]+)/review')
    def profile_review(self,request,profile_id=None):
        org=self.get_organisation();obj=get_object_or_404(OrganisationTaxProfile,organisation=org,pk=profile_id)
        return Response(row(config.review_profile(organisation=org,user=request.user,profile=obj)))

    @action(detail=False,methods=['post'],url_path='profiles/(?P<profile_id>[^/.]+)/activate')
    def profile_activate(self,request,profile_id=None):
        org=self.get_organisation();obj=get_object_or_404(OrganisationTaxProfile,organisation=org,pk=profile_id)
        return Response(row(config.activate_profile(organisation=org,user=request.user,profile=obj,confirmed=request.data.get('confirmed') is True)))

    @action(detail=False,methods=['get'])
    def codes(self,request):
        return Response([row(c) for c in TaxCode.objects.filter(organisation=self.get_organisation()).order_by('code')])

    @action(detail=False,methods=['post'],url_path='new-code')
    def new_code(self,request):
        org=self.get_organisation();data=validated(CodeInput,request)
        if data['code'].startswith('GHS-'):raise BusinessRuleError('Reserved Ghana catalogue code. Create a new version of the existing code.')
        with transaction.atomic():
            lock_ledger(org.pk)
            if TaxCode.objects.filter(organisation=org,code=data['code']).exists():raise BusinessRuleError('Tax code already exists.')
            obj=TaxCode.objects.create(organisation=org,created_by=request.user,**data)
            config.audit(org,request.user,'CODE_CREATED',obj,'User-defined tax code',after=data)
        return Response(row(obj),status=201)

    @action(detail=False,methods=['get'])
    def versions(self,request):
        return Response([version_row(v,self.get_organisation()) for v in TaxRateVersion.objects.filter(organisation=self.get_organisation()).select_related('window','code').order_by('-effective_from','-number')])

    @action(detail=False,methods=['post'],url_path='codes/(?P<code_id>[^/.]+)/versions')
    def new_version(self,request,code_id=None):
        org=self.get_organisation();code=get_object_or_404(TaxCode,organisation=org,pk=code_id)
        data=validated(VersionInput,request);data['components']=config.serial(data['components'])
        return Response(row(config.draft_version(organisation=org,user=request.user,code=code,**data)),status=201)

    @action(detail=False,methods=['post'],url_path='versions/(?P<version_id>[^/.]+)/approve')
    def version_approve(self,request,version_id=None):
        org=self.get_organisation();version=get_object_or_404(TaxRateVersion,organisation=org,pk=version_id)
        return Response(row(config.approve_version(organisation=org,user=request.user,version=version)))

    @action(detail=False,methods=['get'],url_path='versions/(?P<version_id>[^/.]+)/impact')
    def version_impact(self,request,version_id=None):
        org=self.get_organisation();version=get_object_or_404(TaxRateVersion,organisation=org,pk=version_id)
        return Response(config.version_impact(org,version))

    @action(detail=False,methods=['post'],url_path='versions/(?P<version_id>[^/.]+)/transition')
    def version_transition(self,request,version_id=None):
        org=self.get_organisation();version=get_object_or_404(TaxRateVersion,organisation=org,pk=version_id)
        return Response(row(config.transition_version(organisation=org,user=request.user,version=version,target=request.data.get('status'),reason=str(request.data.get('reason','')))))

    def _activate(self,request,version_id,emergency):
        org=self.get_organisation();version=get_object_or_404(TaxRateVersion,organisation=org,pk=version_id)
        return Response(row(config.activate_version(organisation=org,user=request.user,version=version,
            confirmed=request.data.get('confirmed') is True,emergency=emergency,reason=str(request.data.get('reason','')))))

    @action(detail=False,methods=['post'],url_path='versions/(?P<version_id>[^/.]+)/activate')
    def version_activate(self,request,version_id=None):return self._activate(request,version_id,False)

    @action(detail=False,methods=['post'],url_path='versions/(?P<version_id>[^/.]+)/emergency')
    def version_emergency(self,request,version_id=None):return self._activate(request,version_id,True)

    @action(detail=False,methods=['post'])
    def preview(self,request):
        org=self.get_organisation();point=request_date(request.data.get('date'));scope=request.data.get('scope','SALES')
        if scope not in {'SALES','PURCHASES'}:raise BusinessRuleError('Select sales or purchases.')
        if request.data.get('lines'):
            from .document_tax import prepare_line_tax
            from .engine import decimal
            from apps.sales.models import Invoice
            from apps.purchases.models import Bill
            lines=serializers.ListField(child=serializers.DictField(),min_length=1,max_length=1000).run_validation(request.data['lines'])
            if not isinstance(lines,list) or not 1<=len(lines)<=1000:raise BusinessRuleError('Preview between one and 1,000 lines.')
            parent=None
            if request.data.get('source_id'):
                parent=get_object_or_404(Bill if scope=='PURCHASES' else Invoice,organisation=org,pk=request.data['source_id'])
            output=[]
            for line in lines:
                source=get_object_or_404(parent.lines,pk=line['source_line_id']) if parent and line.get('source_line_id') else None
                result=prepare_line_tax(organisation=org,line=line,scope=scope,point=point,source_line=source)
                result.pop('tax_rate_config',None);output.append(result)
            return Response(config.serial({'lines':output,'subtotal':sum((decimal(r['net_amount']) for r in output),decimal(0)),
                'tax_total':sum((decimal(r['tax_amount']) for r in output),decimal(0)),
                'total':sum((decimal(r['gross_amount']) for r in output),decimal(0))}))
        if request.data.get('components'):
            config.permit(org,request.user,'draft_tax_changes')
            serializer=ComponentInput(data=request.data['components'],many=True);serializer.is_valid(raise_exception=True)
            result=calculate_components(quantity=request.data.get('quantity',1),unit_price=request.data.get('unit_price',1000),discount=request.data.get('discount_amount',0),components=config.serial(serializer.validated_data),maximum_rate=str(config.profile_on(org,point).maximum_rate) if config.profile_on(org,point) else '1000',inclusive=request.data.get('tax_inclusive') is True,classification=request.data.get('classification','STANDARD'),scope=scope)
        else:
            from .document_tax import prepare_line_tax
            result=prepare_line_tax(organisation=org,line=request.data,scope=scope,point=point)
            result.pop('tax_rate_config',None)
        return Response(config.serial(result))

    @action(detail=False,methods=['get'])
    def history(self,request):
        return Response([row(a) for a in TaxConfigurationAudit.objects.filter(organisation=self.get_organisation()).order_by('-created_at')[:1000]])

    @action(detail=False,methods=['get'],url_path='history/export')
    def history_export(self,request):
        org=self.get_organisation();data=config.serial([row(a) for a in TaxConfigurationAudit.objects.filter(organisation=org).order_by('created_at')])
        import json
        response=HttpResponse(json.dumps(data,indent=2),content_type='application/json');response['Content-Disposition']='attachment; filename="tax-configuration-history.json"';response['Cache-Control']='private, no-store'
        return response

    @action(detail=False,methods=['get'])
    def presets(self,request):
        org=self.get_organisation()
        if org.country_code!='GH':return Response([])
        return Response([row(p) for p in TaxRegimeVersion.objects.filter(jurisdiction='GH',verified=True)])

    @action(detail=False,methods=['post'])
    def adopt(self,request):
        org=self.get_organisation();preset=get_object_or_404(TaxRegimeVersion,jurisdiction='GH',verified=True,pk=request.data.get('preset_id'))
        if org.country_code!='GH':raise BusinessRuleError('Ghana presets are not applicable to this organisation.')
        decision=request.data.get('decision')
        if decision=='KEEP_CURRENT':
            config.audit(org,request.user,'PRESET_REJECTED',preset,str(request.data.get('reason','Keep current organisation version')),after={'preset':str(preset.pk)})
            return Response({'status':'KEPT_CURRENT'})
        if decision not in {'PREVIEW','ADOPT','SCHEDULE'} or (decision!='PREVIEW' and request.data.get('confirmed') is not True):raise BusinessRuleError('Review and confirm adoption; overrides are never replaced automatically.')
        code=get_object_or_404(TaxCode,organisation=org,pk=request.data.get('code_id'))
        if not code.statutory or code.family!='INDIRECT' or code.tracking_only or code.jurisdiction!='GH':raise BusinessRuleError('Select an eligible Ghana statutory indirect-tax code.')
        point=request_date(request.data.get('effective_from'))
        profile=config.profile_on(org,point)
        if not profile or profile.structure!='GHANA_GRA' or point<preset.effective_from:raise BusinessRuleError('Preset is not effective for the selected Ghana profile/date.')
        current=config.version_on(org,code,point)
        import copy
        components=copy.deepcopy(preset.catalogue['components'])
        for c in components:
            prior=next((old for old in current.components if old['code']==c['code']),{})
            c['input_account']=prior.get('input_account') or profile.mappings.get('INPUT_'+c['code'])
            c['output_account']=prior.get('output_account') or profile.mappings.get('OUTPUT_'+c['code'])
        if decision=='PREVIEW':
            parameters={'quantity':1,'unit_price':1000,'classification':current.classification,
                'scope':'PURCHASES' if code.scope=='PURCHASES' else 'SALES',
                'inclusive':current.rules.get('inclusive',False),'maximum_rate':profile.maximum_rate,
                'confirm_high':True}
            return Response(config.serial({'current':calculate_components(components=current.components,**parameters),
                'proposed':calculate_components(components=components,**parameters),
                'current_provenance':current.provenance,'replaces_override':current.provenance=='ORGANISATION_OVERRIDE',
                'source':preset.source,'effective_from':preset.effective_from,
                'affected_future_drafts':config.affected_drafts(org,code,point)}))
        with transaction.atomic():
            lock_ledger(org.pk)
            obj=config._draft_version(org,request.user,code,point,None,current.classification,components,current.rules,preset.source,str(request.data.get('reason','Reviewed preset adoption')),preset=preset)
            config.audit(org,request.user,'PRESET_ADOPTION_DRAFTED',obj,obj.reason,before={'version':str(current.pk)},after={'preset':str(preset.pk)})
        return Response(row(obj),status=201)

    @action(detail=False,methods=['post'])
    def retire(self,request):
        org=self.get_organisation();version=get_object_or_404(TaxRateVersion,organisation=org,pk=request.data.get('version_id'))
        end=request_date(request.data.get('effective_to'));reason=str(request.data.get('reason','')).strip()
        if not reason or request.data.get('confirmed') is not True:raise BusinessRuleError('Retirement needs reason and confirmation.')
        with transaction.atomic():
            lock_ledger(org.pk);config.assert_no_posted_since(org,end)
            window=version.window
            if end<window.start or window.end:raise BusinessRuleError('Invalid retirement boundary.')
            window.end=end;window.save(update_fields=['end'])
            config.audit(org,request.user,'COMPONENTS_RETIRED',version,reason,after={'last_effective_date':end})
        return Response({'status':'RETIREMENT_SCHEDULED','effective_to':end})

    @action(detail=False, methods=['get'])
    def classifications(self, request):
        return Response([row(obj) for obj in TaxClassification.objects.filter(organisation=self.get_organisation()).order_by('-effective_from','-created_at')])

    @action(detail=False, methods=['get'])
    def recommendations(self, request):
        from apps.inventory.models import Product
        from apps.contacts.models import Contact
        org=self.get_organisation();point=request_date(request.query_params.get('date'))
        scope=request.query_params.get('scope','SALES')
        if scope not in {'SALES','PURCHASES'}:raise BusinessRuleError('Select sales or purchases.')
        profile=config.profile_on(org,point)
        candidates=[]
        for field,model in [('product',Product),('contact',Contact)]:
            ident=request.query_params.get(field+'_id')
            if not ident:continue
            obj=get_object_or_404(model,organisation=org,pk=ident)
            assignment=TaxClassification.objects.filter(organisation=org,**{field:obj},effective_from__lte=point,code__scope__in=[scope,'BOTH'],code__family='INDIRECT').select_related('code').order_by('-effective_from','-created_at').first()
            if not assignment or not profile or profile.structure=='NO_TAX':continue
            if assignment.code.statutory and profile.structure!='GHANA_GRA':continue
            try:version=config.version_on(org,assignment.code,point)
            except BusinessRuleError:continue
            candidates.append({'assignment_id':str(assignment.pk),'code_id':str(assignment.code_id),'code':assignment.code.code,'classification':version.classification,'source_note':assignment.source_note,'effective_from':assignment.effective_from,'basis':field})
        return Response({'recommendations':candidates,'confirmation_required':True})

    @action(detail=False,methods=['post'])
    def classify(self,request):
        org=self.get_organisation();code=get_object_or_404(TaxCode,organisation=org,pk=request.data.get('code_id'))
        from apps.inventory.models import Product
        from apps.contacts.models import Contact
        product=get_object_or_404(Product,organisation=org,pk=request.data['product_id']) if request.data.get('product_id') else None
        contact=get_object_or_404(Contact,organisation=org,pk=request.data['contact_id']) if request.data.get('contact_id') else None
        if bool(product)==bool(contact) or not request.data.get('source_note'):raise BusinessRuleError('Choose one product/contact and give an effective-dated classification source.')
        obj=TaxClassification.objects.create(organisation=org,created_by=request.user,code=code,product=product,contact=contact,effective_from=request_date(request.data.get('effective_from')),source_note=str(request.data['source_note']))
        config.audit(org,request.user,'CLASSIFICATION_ASSIGNED',obj,obj.source_note,after={'code':code.code,'effective_from':obj.effective_from})
        return Response(row(obj),status=201)

    @action(detail=False,methods=['get'])
    def dashboard(self,request):
        org=self.get_organisation();today=config.local_today(org);profile=config.profile_on(org,today)
        start=today.replace(day=1)
        from apps.organisations.models import OrganisationMember
        return Response({'profile':row(profile) if profile else None,'members':[{'id':str(m.user_id),'name':m.user.get_full_name() or m.user.username} for m in OrganisationMember.objects.filter(organisation=org,is_active=True).select_related('user')],
            'supporting_documents':[row(e) for e in TaxFilingEvidence.objects.filter(organisation=org,obligation__isnull=False)],
            'deadlines':[{**row(x),'reminder_due':(x.due_date-today).days in x.reminders or x.due_date<today} for x in TaxCalendarEntry.objects.filter(organisation=org,status__in=['OPEN','FILED']).order_by('due_date')[:100]],
            'draft_returns':[row(r) for r in TaxReturnDraft.objects.filter(organisation=org,status__in=['DRAFT','REVIEWED']).order_by('-created_at')[:50]],
            'registrations':[row(r) for r in OrganisationTaxRegistration.objects.filter(organisation=org,profile=profile)],
            'certificates_outstanding': WithholdingTransaction.objects.filter(organisation=org,certificate='').count(),
            'pending_codes':[row(c) for c in TaxCode.objects.filter(organisation=org).exclude(versions__activated_at__isnull=False).distinct()],
            'reconciliation':reports.vat_workpaper(org,start,today),'evat_enabled':False})

    @action(detail=False, methods=['post'], url_path='debit-note')
    def debit_note(self, request):
        from apps.sales.models import Invoice
        from apps.purchases.models import Bill
        from apps.sales.serializers import InvoiceSerializer
        from apps.purchases.serializers import BillSerializer
        from apps.sales.services.invoices import create_invoice
        from apps.purchases.services.bills import create_bill
        org = self.get_organisation()
        supplier = request.data.get('supplier') is True
        config.permit(org, request.user, 'create_bill' if supplier else 'create_invoice')
        original = get_object_or_404(Bill if supplier else Invoice, organisation=org, pk=request.data.get('original_document_id'))
        serializer = (BillSerializer if supplier else InvoiceSerializer)(data=request.data.get('document', {}), context={'organisation': org, 'request': request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lock_ledger(org.pk)
            obj = (create_bill if supplier else create_invoice)(organisation=org, user=request.user, original_document=original, **serializer.validated_data)
            config.audit(org, request.user, 'DEBIT_NOTE_DRAFTED', obj, 'Original document tax snapshot retained', after={'original': str(original.pk), 'total': str(obj.total)})
        return Response({'id': str(obj.pk), 'total': obj.total, 'status': obj.status}, status=201)

    @action(detail=False,methods=['post'],url_path='withholding-preview')
    def withholding_preview(self,request):
        from .withholding import prepare_withholding
        from .engine import money
        from apps.sales.models import Invoice
        from apps.purchases.models import Bill
        from apps.fx.services import get_effective_rate
        org=self.get_organisation();supplier=request.data.get('supplier_payment') is True
        config.permit(org,request.user,'create_supplier_payment' if supplier else 'create_customer_payment')
        source=get_object_or_404(Bill if supplier else Invoice,organisation=org,pk=request.data.get('source_id'))
        point=request_date(request.data.get('date'));amount=money(request.data.get('amount'))
        rate=get_effective_rate(organisation=org,base_currency=source.currency,target_currency=org.base_currency,date=point)
        prepared,total=prepare_withholding(organisation=org,contact=source.supplier if supplier else source.customer,point=point,gross=amount,currency=source.currency,exchange_rate=rate,items=request.data.get('withholdings'),supplier_payment=supplier,source=source)
        return Response({'gross':amount,'withheld':total,'net':amount-total,'currency':source.currency})

    @action(detail=False,methods=['post'],url_path='map-controls')
    def map_controls(self,request):
        from .operations import map_controls
        return Response(map_controls(organisation=self.get_organisation(),user=request.user,mappings=request.data.get('mappings',{}),confirmed=request.data.get('confirmed') is True))

    @action(detail=False,methods=['post'],url_path='obligation-evidence')
    def obligation_evidence(self,request):
        org=self.get_organisation()
        registration=get_object_or_404(OrganisationTaxRegistration,organisation=org,pk=request.data.get('registration_id'))
        reason=str(request.data.get('notes','')).strip()
        if not reason:raise BusinessRuleError('Describe the supporting obligation document.')
        evidence=TaxFilingEvidence.objects.create(organisation=org,created_by=request.user,obligation=registration,acknowledgement=str(request.data.get('acknowledgement',''))[:200],notes=reason,**evidence_file(request))
        config.audit(org,request.user,'OBLIGATION_EVIDENCE_ADDED',evidence,reason,after={'checksum':evidence.checksum})
        return Response(row(evidence),status=201)

    @action(detail=False,methods=['post'],url_path='calendar-status')
    def calendar_status(self,request):
        org=self.get_organisation();target=request.data.get('status');reason=str(request.data.get('reason','')).strip()
        if target not in {'FILED','PAID'} or not reason:raise BusinessRuleError('Choose filing or payment and record a reason.')
        config.permit(org,request.user,'record_tax_filing' if target=='FILED' else 'record_tax_payment')
        field='acknowledgement' if target=='FILED' else 'payment_reference'
        reference=str(request.data.get(field,'')).strip()
        if not reference or len(reference)>200:raise BusinessRuleError('Record the actual acknowledgement/payment reference, up to 200 characters.')
        with transaction.atomic():
            lock_ledger(org.pk)
            entry=get_object_or_404(TaxCalendarEntry.objects.select_for_update(),organisation=org,pk=request.data.get('calendar_id'))
            if entry.status!=('OPEN' if target=='FILED' else 'FILED'):raise BusinessRuleError('Invalid calendar status transition.')
            before=row(entry);entry.status=target;setattr(entry,field,reference);entry.save(update_fields=['status',field])
            config.audit(org,request.user,'CALENDAR_'+target,entry,reason,before=before,after=row(entry))
        return Response(row(entry))

    @action(detail=False,methods=['post'])
    def calendar(self,request):
        org=self.get_organisation();registration=get_object_or_404(OrganisationTaxRegistration,organisation=org,pk=request.data.get('registration_id'))
        from apps.organisations.models import OrganisationMember
        member=get_object_or_404(OrganisationMember,organisation=org,is_active=True,user_id=request.data.get('responsible_user_id'))
        start=request_date(request.data.get('period_start'));end=request_date(request.data.get('period_end'));due=request_date(request.data.get('due_date'))
        if end<start or due<end or not request.data.get('source') or not request.data.get('rule_version'):raise BusinessRuleError('Enter valid dates, verified calendar source and effective rule version.')
        reminders=request.data.get('reminders',[])
        if not isinstance(reminders,list) or len(reminders)>10 or any(type(x) is not int or x<0 or x>365 for x in reminders):raise BusinessRuleError('Reminder offsets must be nonnegative days, maximum ten.')
        obj=TaxCalendarEntry.objects.create(organisation=org,created_by=request.user,registration=registration,period_start=start,period_end=end,due_date=due,payment_due_date=request_date(request.data['payment_due_date']) if request.data.get('payment_due_date') else None,responsible_user=member.user,reminders=reminders,rule_source=str(request.data['source']),rule_version=str(request.data['rule_version']))
        config.audit(org,request.user,'CALENDAR_CREATED',obj,'Effective-dated calendar rule',after=row(obj))
        return Response(row(obj),status=201)


def return_row(obj):
    from .operations import settlement_controls
    return {**row(obj),'settlement_balances':config.serial(settlement_controls(obj)),
        'payments':[{**row(p),'reversed':p.journal.status=='reversed'} for p in TaxPayment.objects.filter(organisation=obj.organisation,tax_return__period=obj.period,tax_return__kind=obj.kind).select_related('journal').order_by('created_at')],
        'filing_evidence':[row(e) for e in TaxFilingEvidence.objects.filter(organisation=obj.organisation,tax_return=obj).order_by('created_at')]}


class TaxReturnViewSet(TaxInputErrorsMixin,OrganisationScopedViewSetMixin,ViewSet):
    permission_classes=[IsAuthenticated,OrganisationActionPermission]
    action_permissions={'list':'view_tax','retrieve':'view_tax','create':'prepare_tax_return','workpaper':'view_tax','transition':'view_tax','export':'export_gra_schedules','evidence':'record_tax_filing','evidence_download':'view_tax','adjustment':'approve_tax_returns','payment':'record_tax_payment','reverse_payment':'record_tax_payment','workpaper_export':'export_gra_schedules','reopen':'reopen_tax_period'}
    def list(self,request):return Response([return_row(r) for r in TaxReturnDraft.objects.filter(organisation=self.get_organisation()).order_by('-created_at')])
    def retrieve(self,request,pk=None):return Response(return_row(get_object_or_404(TaxReturnDraft,organisation=self.get_organisation(),pk=pk)))
    def create(self,request):
        org=self.get_organisation();period=get_object_or_404(TaxPeriod,organisation=org,pk=request.data.get('period_id'))
        return Response(row(reports.prepare_return(organisation=org,user=request.user,period=period,kind=request.data.get('kind','VAT'))),status=201)
    @action(detail=False,methods=['get'])
    def workpaper(self,request):
        start=request_date(request.query_params.get('start_date'));end=request_date(request.query_params.get('end_date'))
        return Response(reports.vat_workpaper(self.get_organisation(),start,end))
    @action(detail=True,methods=['post'])
    def transition(self,request,pk=None):
        org=self.get_organisation();obj=get_object_or_404(TaxReturnDraft,organisation=org,pk=pk)
        return Response(row(reports.transition_return(organisation=org,user=request.user,tax_return=obj,target=request.data.get('status'),reason=str(request.data.get('reason','')),acknowledgement=str(request.data.get('acknowledgement','')))))
    @action(detail=True,methods=['post'])
    def export(self,request,pk=None):
        org=self.get_organisation();obj=get_object_or_404(TaxReturnDraft,organisation=org,pk=pk)
        data,export=reports.export_wht(organisation=org,user=request.user,tax_return=obj,portal=request.data.get('portal') is True)
        response=HttpResponse(data,content_type='text/csv');response['Content-Disposition']='attachment; filename="withholding-review-NOT-GRA-UPLOAD.csv"';response['X-Export-Checksum']=export.checksum;response['Cache-Control']='private, no-store';return response
    @action(detail=True, methods=['post'], url_path='workpaper-export')
    def workpaper_export(self, request, pk=None):
        org = self.get_organisation()
        obj = get_object_or_404(TaxReturnDraft, organisation=org, pk=pk)
        format=serializers.ChoiceField(choices=['json','pdf']).run_validation(request.data.get('format','json'))
        data, export = reports.export_workpaper(organisation=org, user=request.user, tax_return=obj, format=format)
        response = HttpResponse(data, content_type='application/pdf' if format=='pdf' else 'application/json')
        response['Content-Disposition'] = 'attachment; filename="tax-review-workpaper.'+format+'"'
        response['X-Export-Checksum'] = export.checksum
        response['Cache-Control'] = 'private, no-store'
        return response

    @action(detail=True,methods=['post'])
    def evidence(self,request,pk=None):
        org=self.get_organisation();obj=get_object_or_404(TaxReturnDraft,organisation=org,pk=pk)
        file=request.FILES.get('file');ack=str(request.data.get('acknowledgement','')).strip()
        if not file or file.size>5_000_000 or not ack:raise BusinessRuleError('An acknowledgement and PDF/PNG/JPEG under 5 MB are required.')
        data=file.read();mime='application/pdf' if data.startswith(b'%PDF-') else 'image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if data.startswith(b'\xff\xd8\xff') else None
        if not mime:raise BusinessRuleError('Unsupported evidence format.')
        import hashlib
        evidence=TaxFilingEvidence.objects.create(organisation=org,created_by=request.user,tax_return=obj,acknowledgement=ack,filename=file.name[:200],content_type=mime,content=data,checksum=hashlib.sha256(data).hexdigest())
        config.audit(org,request.user,'FILING_EVIDENCE_ADDED',evidence,'Private filing evidence uploaded',after={'checksum':evidence.checksum})
        return Response(row(evidence),status=201)
    @action(detail=False,methods=['get'],url_path='evidence/(?P<evidence_id>[^/.]+)/download')
    def evidence_download(self,request,evidence_id=None):
        obj=get_object_or_404(TaxFilingEvidence,organisation=self.get_organisation(),pk=evidence_id)
        if not obj.content:raise BusinessRuleError('This acknowledgement has no uploaded evidence file.')
        response=HttpResponse(bytes(obj.content),content_type=obj.content_type or 'application/octet-stream');response['Content-Disposition']='attachment; filename="tax-filing-evidence"';response['Cache-Control']='private, no-store';response['X-Content-Type-Options']='nosniff';return response

    @action(detail=False,methods=['post'])
    def adjustment(self,request):
        from .operations import post_adjustment
        org=self.get_organisation();period=get_object_or_404(TaxPeriod,organisation=org,pk=request.data.get('period_id'))
        original=get_object_or_404(TaxReturnDraft,organisation=org,pk=request.data['original_return_id']) if request.data.get('original_return_id') else None
        return Response(row(post_adjustment(organisation=org,user=request.user,period=period,point=request_date(request.data.get('date')),
            account_id=request.data.get('account_id'),counter_account_id=request.data.get('counter_account_id'),amount=request.data.get('amount'),
            direction=request.data.get('direction'),component_code=str(request.data.get('component_code','')),reason=str(request.data.get('reason','')),original_return=original,idempotency_key=request_key(request))),status=201)
    @action(detail=True,methods=['post'])
    def payment(self,request,pk=None):
        from .operations import post_payment
        org=self.get_organisation();obj=get_object_or_404(TaxReturnDraft,organisation=org,pk=pk)
        return Response(row(post_payment(organisation=org,user=request.user,tax_return=obj,point=request_date(request.data.get('date')),
            account_id=request.data.get('account_id'),bank_account_id=request.data.get('bank_account_id'),amount=request.data.get('amount'),reference=str(request.data.get('reference','')),allocations=request.data.get('allocations'),idempotency_key=request_key(request))),status=201)
    @action(detail=False,methods=['post'])
    def reopen(self,request):
        org=self.get_organisation();period=get_object_or_404(TaxPeriod,organisation=org,pk=request.data.get('period_id'));reason=str(request.data.get('reason','')).strip()
        if not reason or request.data.get('confirmed') is not True:raise BusinessRuleError('Reopening requires confirmation and a reason; filed snapshots stay immutable.')
        with transaction.atomic():
            lock_ledger(org.pk)
            if period.returns.filter(status__in=['APPROVED','EXPORTED','FILED','PAID']).exists():raise BusinessRuleError('An approved return exists. Use an adjustment in an open period; reopening must not rewrite filed history.')
            old=period.status;period.status='OPEN';period.save(update_fields=['status']);config.audit(org,request.user,'TAX_PERIOD_REOPENED',period,reason,before={'status':old},after={'status':'OPEN'})
        return Response(row(period))

    @action(detail=True,methods=['post'],url_path='reverse-payment')
    def reverse_payment(self,request,pk=None):
        from .operations import reverse_tax_payment
        org=self.get_organisation();tax_return=get_object_or_404(TaxReturnDraft,organisation=org,pk=pk)
        payment=get_object_or_404(TaxPayment,organisation=org,pk=request.data.get('payment_id'),tax_return__period=tax_return.period,tax_return__kind=tax_return.kind)
        if request.data.get('confirmed') is not True:raise BusinessRuleError('Confirm reversal of the tax payment and all control allocations.')
        result=reverse_tax_payment(organisation=org,user=request.user,payment=payment,point=request_date(request.data.get('date')),reason=str(request.data.get('reason','')))
        return Response({'correction_id':str(result.pk),'reversal_journal':str(result.reversal_journal_id)})
