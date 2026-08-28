import io
import zipfile
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounting.models import Account, AccountImportBatch, JournalEntry, OpeningBalance
from apps.accounting.services.account_imports import HEADERS, template_workbook
from apps.organisations.models import Organisation, OrganisationMember


def workbook(rows, headers=HEADERS):
    content = template_workbook(); source = zipfile.ZipFile(io.BytesIO(content)); output = io.BytesIO()
    def row_xml(number, values):
        cells=[]
        for index,value in enumerate(values):
            cell=chr(65+index);escaped=str(value).replace("&","&amp;").replace("<","&lt;")
            cells.append(f'<c r="{cell}{number}" t="inlineStr"><is><t>{escaped}</t></is></c>')
        return f'<row r="{number}">{"".join(cells)}</row>'
    sheet=source.read("xl/worksheets/sheet1.xml").decode();start=sheet.index("<sheetData>")+11;end=sheet.index("</sheetData>");replacement=row_xml(1,headers)+"".join(row_xml(i+2,row) for i,row in enumerate(rows));sheet=sheet[:start]+replacement+sheet[end:]
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist(): target.writestr(item, sheet if item.filename=="xl/worksheets/sheet1.xml" else source.read(item.filename))
    output.seek(0);output.name="accounts.xlsx";return output


class AccountImportTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username="import-owner",password="x")
        self.org=Organisation.objects.create(name="Import Org",base_currency="GBP",created_by=self.user)
        OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner")
        self.client=APIClient();self.client.force_authenticate(self.user);self.headers={"HTTP_X_ORGANISATION_ID":str(self.org.id)}
    def upload(self, rows, headers=HEADERS):
        return self.client.post("/api/v1/accounts/import/preview/",{"file":workbook(rows,headers)},format="multipart",**self.headers)
    def test_template_is_a_valid_xlsx_with_expected_sheets(self):
        response=self.client.get("/api/v1/accounts/import/template/",**self.headers);self.assertEqual(response.status_code,200)
        archive=zipfile.ZipFile(io.BytesIO(response.content));workbook_xml=archive.read("xl/workbook.xml").decode()
        self.assertTrue({"Chart of Accounts","Instructions","Allowed Values"}.issubset(set(name for name in ["Chart of Accounts","Instructions","Allowed Values"] if name in workbook_xml)))
        self.assertIn("Account Code",archive.read("xl/worksheets/sheet1.xml").decode())
    def test_preview_then_atomic_idempotent_confirmation(self):
        rows=[["0010","Petty Cash","Asset","Current Asset","Small cash","GBP","Cash","Yes","Active"],["4100","Consulting","Revenue","Sales","","GBP","Operating activities","True","Active"]]
        preview=self.upload(rows);self.assertEqual(preview.status_code,201,preview.content);data=preview.json();self.assertEqual(data["valid_rows"],2);self.assertEqual(Account.objects.count(),0)
        confirmed=self.client.post(f"/api/v1/accounts/import/{data['id']}/confirm/",{},format="json",**self.headers);self.assertEqual(confirmed.status_code,200,confirmed.content);self.assertEqual(Account.objects.count(),2);self.assertTrue(Account.objects.filter(code="0010").exists())
        again=self.client.post(f"/api/v1/accounts/import/{data['id']}/confirm/",{},format="json",**self.headers);self.assertEqual(again.status_code,200);self.assertEqual(Account.objects.count(),2)
        self.assertFalse(JournalEntry.objects.exists());self.assertFalse(OpeningBalance.objects.exists())
    def test_invalid_class_duplicate_and_existing_codes_are_reported(self):
        Account.objects.create(organisation=self.org,created_by=self.user,code="1000",name="Existing",account_type="asset",account_class="bank")
        rows=[["1000","Duplicate","Asset","Bank","","GBP","Cash","Yes","Active"],["2000","Wrong class","Revenue","Bank","","GBP","Operating","Yes","Active"],["2000","Repeated","Expense","Operating Expense","","GBP","Operating","No","Active"]]
        response=self.upload(rows);self.assertEqual(response.status_code,201);data=response.json();self.assertEqual(data["invalid_rows"],3);self.assertEqual(data["existing_rows"],1)
        self.assertEqual(self.client.post(f"/api/v1/accounts/import/{data['id']}/confirm/",{},format="json",**self.headers).status_code,400)
    def test_other_organisation_code_is_not_a_conflict_and_batches_are_isolated(self):
        other=Organisation.objects.create(name="Other",created_by=self.user);Account.objects.create(organisation=other,created_by=self.user,code="7777",name="Other account",account_type="asset",account_class="current_asset")
        response=self.upload([["7777","Local account","Asset","Current Asset","","GBP","Not applicable","Yes","Active"]]);self.assertEqual(response.json()["valid_rows"],1)
        OrganisationMember.objects.create(organisation=other,user=self.user,role="owner")
        self.assertEqual(self.client.get(f"/api/v1/accounts/import/{response.json()['id']}/status/",HTTP_X_ORGANISATION_ID=str(other.id)).status_code,404)
    def test_missing_columns_empty_and_renamed_text_are_rejected(self):
        self.assertEqual(self.upload([["1000","Cash"]],headers=["Account Code","Account Name"]).status_code,400)
        self.assertEqual(self.upload([]).status_code,400)
        fake=io.BytesIO(b"Account Code,Account Name");fake.name="fake.xlsx"
        self.assertEqual(self.client.post("/api/v1/accounts/import/preview/",{"file":fake},format="multipart",**self.headers).status_code,400)
