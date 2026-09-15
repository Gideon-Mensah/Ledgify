from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from common.views import OrganisationScopedViewSetMixin
from common.documents import document_contract, render_pdf, safe_filename

class DocumentView(OrganisationScopedViewSetMixin,APIView):
    permission_classes=[IsAuthenticated]
    def get(self,request,kind,pk,pdf=False):
        self.require_permission('export_reports' if pdf else 'view_accounting')
        if kind in ("customer-statement","supplier-statement"):
            from rest_framework import serializers
            from common.documents import statement_contract
            dates={key:serializers.DateField().run_validation(request.query_params[key]) for key in ("start_date","end_date") if request.query_params.get(key)}
            contract=statement_contract(organisation=self.get_organisation(),kind=kind,pk=pk,**dates)
        else:
            contract=document_contract(organisation=self.get_organisation(),kind=kind,pk=pk)
        if request.query_params.get("version") and request.query_params["version"] != contract["version"]:
            from rest_framework.exceptions import APIException
            error=APIException("The document changed. Reload it before downloading.");error.status_code=409;raise error
        if pdf:
            response=HttpResponse(render_pdf(contract),content_type='application/pdf')
            response['Content-Disposition']='attachment; filename="'+safe_filename(contract['number'])+'"'
        else:response=Response(contract)
        response['Cache-Control']='private, no-store'
        response['X-Content-Type-Options']='nosniff'
        return response
