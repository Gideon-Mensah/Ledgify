from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
from django.shortcuts import get_object_or_404

from common.views import OrganisationScopedViewSetMixin
from common.permissions import OrganisationActionPermission
from apps.organisations.permissions import IMPORT_CUSTOMERS, IMPORT_SUPPLIERS, MANAGE_CONTACTS, VIEW_ACCOUNTING
from apps.organisations.services import require_organisation_permission

from .models import Contact, ContactImportBatch
from .serializers import ContactSerializer
from .services.contact_imports import confirm as confirm_import, data as import_data, preview as preview_import, template as import_template


class ContactViewSet(
    OrganisationScopedViewSetMixin,
    ModelViewSet,
):
    serializer_class = ContactSerializer
    permission_classes = [IsAuthenticated, OrganisationActionPermission]
    action_permissions = {"list": VIEW_ACCOUNTING, "retrieve": VIEW_ACCOUNTING,
                          "create": MANAGE_CONTACTS, "update": MANAGE_CONTACTS,
                          "partial_update": MANAGE_CONTACTS, "destroy": MANAGE_CONTACTS,
                          "import_template": VIEW_ACCOUNTING,"import_preview": VIEW_ACCOUNTING,
                          "import_status": VIEW_ACCOUNTING,"import_confirm": VIEW_ACCOUNTING,"import_errors": VIEW_ACCOUNTING}

    def get_queryset(self):
        organisation = self.get_organisation()

        queryset = Contact.objects.filter(
            organisation=organisation,
        )

        contact_type = self.request.query_params.get(
            "type"
        )

        if contact_type == "customer":
            queryset = queryset.filter(
                is_customer=True,
            )

        elif contact_type == "supplier":
            queryset = queryset.filter(
                is_supplier=True,
            )

        return queryset

    def perform_create(self, serializer):
        serializer.save(
            organisation=self.get_organisation(),
            created_by=self.request.user,
        )

    def _import_permission(self, kind):
        permission=IMPORT_CUSTOMERS if kind=="customer" else IMPORT_SUPPLIERS
        require_organisation_permission(organisation=self.get_organisation(),user=self.request.user,permission=permission)
    def _batch(self,kind,batch_id):
        return get_object_or_404(ContactImportBatch,id=batch_id,import_type=kind,organisation=self.get_organisation())
    @action(detail=False,methods=["get"],url_path=r"(?P<kind>customer|supplier)s/import/template")
    def import_template(self,request,kind=None):
        self._import_permission(kind);name=f"Ledgify_{kind.title()}_Import_Template.xlsx";response=HttpResponse(import_template(kind),content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");response["Content-Disposition"]=f'attachment; filename="{name}"';response["X-Content-Type-Options"]="nosniff";return response
    @action(detail=False,methods=["post"],url_path=r"(?P<kind>customer|supplier)s/import/preview")
    def import_preview(self,request,kind=None):
        self._import_permission(kind);uploaded=request.FILES.get("file")
        if not uploaded:return Response({"file":["Select an .xlsx workbook."]},status=400)
        batch=preview_import(organisation=self.get_organisation(),user=request.user,uploaded_file=uploaded,kind=kind,import_mode=request.data.get("import_mode","stop_on_existing"));return Response(import_data(batch),status=201)
    @action(detail=False,methods=["get"],url_path=r"(?P<kind>customer|supplier)s/import/(?P<batch_id>[^/.]+)/status")
    def import_status(self,request,kind=None,batch_id=None):self._import_permission(kind);return Response(import_data(self._batch(kind,batch_id)))
    @action(detail=False,methods=["post"],url_path=r"(?P<kind>customer|supplier)s/import/(?P<batch_id>[^/.]+)/confirm")
    def import_confirm(self,request,kind=None,batch_id=None):self._import_permission(kind);return Response(import_data(confirm_import(self._batch(kind,batch_id),request.user)))
    @action(detail=False,methods=["get"],url_path=r"(?P<kind>customer|supplier)s/import/(?P<batch_id>[^/.]+)/errors")
    def import_errors(self,request,kind=None,batch_id=None):
        self._import_permission(kind);batch=self._batch(kind,batch_id);lines=['"Row","Record Type","Name","Account Number","Field","Error"']
        for row in batch.rows:
            for error in row["errors"]:lines.append(",".join('"'+str(value).replace('"','""')+'"' for value in [row["row_number"],kind.title(),row["data"].get("name",""),row["data"].get("account_number",""),error["field"],error["message"]]))
        if batch.status==ContactImportBatch.Status.COMPLETED:
            lines=['"Row","Record Type","Name","Account Number","Field","Result"']+[",".join('"'+str(value).replace('"','""')+'"' for value in [row["row_number"],kind.title(),row["data"].get("name",""),row["data"].get("account_number",""),"Import",("Skipped existing" if row.get("skip") else "Created")]) for row in batch.rows]
        report="Results" if batch.status==ContactImportBatch.Status.COMPLETED else "Errors";response=HttpResponse("\ufeff"+"\r\n".join(lines),content_type="text/csv; charset=utf-8");response["Content-Disposition"]=f'attachment; filename="Ledgify_{kind.title()}_Import_{report}_{batch.id}.csv"';return response
