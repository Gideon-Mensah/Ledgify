import io,zipfile
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from apps.contacts.models import Contact
from apps.contacts.services.contact_imports import HEADERS,template
from apps.organisations.models import Organisation,OrganisationMember

def workbook(kind,rows,headers=HEADERS):
 source=zipfile.ZipFile(io.BytesIO(template(kind)));output=io.BytesIO()
 def letters(number):
  value=""
  while number:number,rem=divmod(number-1,26);value=chr(65+rem)+value
  return value
 def row_xml(number,values):return f'<row r="{number}">'+"".join(f'<c r="{letters(index)}{number}" t="inlineStr"><is><t>{str(value).replace("&","&amp;").replace("<","&lt;")}</t></is></c>' for index,value in enumerate(values,1))+"</row>"
 sheet=source.read("xl/worksheets/sheet1.xml").decode();start=sheet.index("<sheetData>")+11;end=sheet.index("</sheetData>");sheet=sheet[:start]+row_xml(1,headers)+"".join(row_xml(index+2,row) for index,row in enumerate(rows))+sheet[end:]
 with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as target:
  for item in source.infolist():target.writestr(item,sheet if item.filename=="xl/worksheets/sheet1.xml" else source.read(item.filename))
 output.seek(0);output.name=f"{kind}s.xlsx";return output

class ContactImportTests(TestCase):
 def setUp(self):
  self.user=get_user_model().objects.create_user(username="contact-import",password="x");self.org=Organisation.objects.create(name="Contacts",base_currency="GHS",created_by=self.user);OrganisationMember.objects.create(organisation=self.org,user=self.user,role="owner");self.client=APIClient();self.client.force_authenticate(self.user);self.headers={"HTTP_X_ORGANISATION_ID":str(self.org.id)}
 def preview(self,kind,rows,headers=HEADERS,mode="stop_on_existing"):return self.client.post(f"/api/v1/contacts/{kind}s/import/preview/",{"file":workbook(kind,rows,headers),"import_mode":mode},format="multipart",**self.headers)
 def row(self,name="Alpha Ltd",account="0001",email="alpha@example.com",currency="GHS"):return [name,account,"A Person",email,"0200000000","https://example.com","REG","TAX","30 days",currency,"1000","Street","","Accra","Greater Accra","GA-001","GH","Notes","Active"]
 def test_both_templates_are_genuine_and_have_expected_sheets(self):
  for kind in ["customer","supplier"]:
   response=self.client.get(f"/api/v1/contacts/{kind}s/import/template/",**self.headers);self.assertEqual(response.status_code,200);archive=zipfile.ZipFile(io.BytesIO(response.content));book=archive.read("xl/workbook.xml").decode();self.assertIn(f'{kind.title()}s',book);self.assertIn("Instructions",book);self.assertIn("Allowed Values",book);self.assertIn("Account Number",archive.read("xl/worksheets/sheet1.xml").decode())
 def test_customer_and_supplier_preview_confirm_and_idempotency(self):
  for kind in ["customer","supplier"]:
   response=self.preview(kind,[self.row(name=f"{kind} One",account=f"00{1 if kind=='customer' else 2}",email=f"{kind}@example.com")]);self.assertEqual(response.status_code,201,response.content);self.assertEqual(Contact.objects.count(),0 if kind=="customer" else 1);batch=response.json();confirmed=self.client.post(f"/api/v1/contacts/{kind}s/import/{batch['id']}/confirm/",{},format="json",**self.headers);self.assertEqual(confirmed.status_code,200,confirmed.content);self.assertEqual(self.client.post(f"/api/v1/contacts/{kind}s/import/{batch['id']}/confirm/",{},format="json",**self.headers).status_code,200)
  self.assertTrue(Contact.objects.get(is_customer=True).account_number.startswith("00"));self.assertEqual(Contact.objects.count(),2)
 def test_validation_duplicates_and_legacy_ghana_currency(self):
  first=self.row(currency="GH¢");second=self.row(name="Alpha Ltd",account="0001",email="alpha@example.com")
  response=self.preview("customer",[first,second]);self.assertEqual(response.status_code,201,response.content);data=response.json();self.assertGreater(data["error_rows"],0);self.assertEqual(data["rows"][0]["data"]["currency"],"GHS")
 def test_empty_missing_and_fake_workbooks_are_rejected(self):
  self.assertEqual(self.preview("customer",[]).status_code,400);self.assertEqual(self.preview("supplier",[self.row()],headers=["Account Number"]).status_code,400);fake=io.BytesIO(b"not xlsx");fake.name="fake.xlsx";self.assertEqual(self.client.post("/api/v1/contacts/customers/import/preview/",{"file":fake},format="multipart",**self.headers).status_code,400)
 def test_batches_are_organisation_scoped(self):
  response=self.preview("customer",[self.row()]);other=Organisation.objects.create(name="Other",created_by=self.user);OrganisationMember.objects.create(organisation=other,user=self.user,role="owner");self.assertEqual(self.client.get(f"/api/v1/contacts/customers/import/{response.json()['id']}/status/",HTTP_X_ORGANISATION_ID=str(other.id)).status_code,404)
