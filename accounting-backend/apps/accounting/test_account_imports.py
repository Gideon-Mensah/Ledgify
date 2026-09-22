import io
import zipfile
from xml.etree import ElementTree as ET
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounting.models import Account, AccountImportBatch, JournalEntry, OpeningBalance
from apps.accounting.services.account_imports import HEADERS, TEMPLATE_VERSION, VERSION_REFERENCE, template_workbook
from apps.organisations.models import Organisation, OrganisationMember


def workbook(rows, headers=HEADERS, content=None):
    content = content if content is not None else template_workbook(); source = zipfile.ZipFile(io.BytesIO(content)); output = io.BytesIO()
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
        other=Organisation.objects.create(base_currency="GBP", name="Other",created_by=self.user);Account.objects.create(organisation=other,created_by=self.user,code="7777",name="Other account",account_type="asset",account_class="current_asset")
        response=self.upload([["7777","Local account","Asset","Current Asset","","GBP","Not applicable","Yes","Active"]]);self.assertEqual(response.json()["valid_rows"],1)
        OrganisationMember.objects.create(organisation=other,user=self.user,role="owner")
        self.assertEqual(self.client.get(f"/api/v1/accounts/import/{response.json()['id']}/status/",HTTP_X_ORGANISATION_ID=str(other.id)).status_code,404)
    def test_missing_columns_empty_and_renamed_text_are_rejected(self):
        self.assertEqual(self.upload([["1000","Cash"]],headers=["Account Code","Account Name"]).status_code,400)
        self.assertEqual(self.upload([]).status_code,400)
        fake=io.BytesIO(b"Account Code,Account Name");fake.name="fake.xlsx"
        self.assertEqual(self.client.post("/api/v1/accounts/import/preview/",{"file":fake},format="multipart",**self.headers).status_code,400)


UNCHANGED = object()
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
UNSUPPORTED = "This import template is no longer supported. Download the latest template and try again."


def edited_metadata(content, *, named=UNCHANGED, cell=UNCHANGED, shared_strings=False):
    """Synthetic editor round trip; never use a customer's populated workbook."""
    with zipfile.ZipFile(io.BytesIO(content)) as source:
        parts = {name: source.read(name) for name in source.namelist()}
    root = ET.fromstring(parts['xl/workbook.xml'])
    names = root.find('m:definedNames', NS)
    node = names.find('m:definedName', NS)
    if named is None:
        names.remove(node)
    elif named is not UNCHANGED:
        node.text = named
    parts['xl/workbook.xml'] = ET.tostring(root)
    instructions = ET.fromstring(parts['xl/worksheets/sheet2.xml'])
    version = instructions.find('.//m:c[@r="C1"]', NS)
    if cell is None:
        instructions.find('m:sheetData/m:row', NS).remove(version)
    elif cell is not UNCHANGED:
        version.find('m:is/m:t', NS).text = cell
    parts['xl/worksheets/sheet2.xml'] = ET.tostring(instructions)
    if shared_strings:
        # Excel commonly rewrites inline strings and worksheet targets on save.
        strings = ET.Element('{%s}sst' % NS['m'])
        for name in list(parts):
            if name.startswith('xl/worksheets/'):
                sheet = ET.fromstring(parts[name])
                for cell_node in sheet.findall('.//m:c', NS):
                    text = ''.join(cell_node.find('m:is', NS).itertext())
                    index = len(strings)
                    entry = ET.SubElement(strings, '{%s}si' % NS['m'])
                    ET.SubElement(entry, '{%s}t' % NS['m']).text = text
                    for child in list(cell_node): cell_node.remove(child)
                    cell_node.set('t', 's')
                    ET.SubElement(cell_node, '{%s}v' % NS['m']).text = str(index)
                parts[name] = ET.tostring(sheet)
        parts['xl/sharedStrings.xml'] = ET.tostring(strings)
        parts['xl/worksheets/version-data.xml'] = parts.pop('xl/worksheets/sheet2.xml')
        parts['xl/_rels/workbook.xml.rels'] = parts['xl/_rels/workbook.xml.rels'].replace(b'worksheets/sheet2.xml', b'/xl/worksheets/version-data.xml')
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'/xl/worksheets/sheet2.xml', b'/xl/worksheets/version-data.xml').replace(b'</Types>', b'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for name, content in parts.items(): target.writestr(name, content)
    return output.getvalue()


class AccountTemplateVersionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='template-owner', email='template@example.test', password='test-only')
        self.org = Organisation.objects.create(name='Template tests', base_currency='GHS', created_by=self.user)
        OrganisationMember.objects.create(organisation=self.org, user=self.user, role='owner')
        self.client = APIClient(); self.client.force_authenticate(self.user)
        self.headers = {'HTTP_X_ORGANISATION_ID': str(self.org.pk)}
        self.rows = [['0091', 'Import clearing', 'Asset', 'Current Asset', 'Synthetic test', '', 'Operating activities', 'Yes', 'Active'], ['4091', 'Services', 'Revenue', 'Sales', '', 'GBP', 'Operating activities', 'No', 'Active']]

    def download(self):
        response = self.client.get('/api/v1/accounts/import/template/', **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.assertIn('Ledgify_Chart_of_Accounts_Import_Template.xlsx', response['Content-Disposition'])
        return response.content

    def upload(self, content):
        file = io.BytesIO(content); file.name = 'Ledgify_Chart_of_Accounts_Import_Template (2).xlsx'
        return self.client.post('/api/v1/accounts/import/preview/', {'file': file}, format='multipart', **self.headers)

    def populated(self):
        return workbook(self.rows, content=self.download()).read()

    def assert_unsupported(self, content):
        response = self.upload(content)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), [UNSUPPORTED])
        self.assertFalse(AccountImportBatch.objects.exists())
        self.assertFalse(Account.objects.exists())

    def test_current_download_metadata_and_blank_template_validation(self):
        content = self.download()
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            root = ET.fromstring(archive.read('xl/workbook.xml'))
            self.assertEqual(root.find('.//m:definedName', NS).text, VERSION_REFERENCE)
            sheet = ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
            self.assertEqual(sheet.find('.//m:c[@r="C1"]/m:is/m:t', NS).text, TEMPLATE_VERSION)
        # Examples alone cannot create accounts, but version validation passes.
        response = self.upload(content)
        self.assertEqual(response.json(), ['The workbook contains no importable data rows.'])

    def test_download_populate_preview_confirm_round_trip(self):
        response = self.upload(self.populated())
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['valid_rows'], 2)
        self.assertFalse(Account.objects.exists())
        batch = AccountImportBatch.objects.get(pk=response.data['id'])
        self.assertEqual(batch.template_version, TEMPLATE_VERSION)
        confirmed = self.client.post(f'/api/v1/accounts/import/{batch.pk}/confirm/', {}, format='json', **self.headers)
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.assertEqual(confirmed.data['status'], 'completed')
        self.assertEqual(Account.objects.filter(organisation=self.org).count(), 2)
        clearing = Account.objects.get(organisation=self.org, code='0091')
        self.assertEqual((clearing.name, clearing.currency, clearing.account_class), ('Import clearing', 'GHS', 'current_asset'))
        self.assertFalse(Account.objects.get(code='4091').allow_manual_journals)
        self.assertFalse(JournalEntry.objects.exists()); self.assertFalse(OpeningBalance.objects.exists())

    def test_editor_removed_defined_name_retains_current_metadata(self):
        response = self.upload(edited_metadata(self.populated(), named=None, shared_strings=True))
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['valid_rows'], 2)
        confirmed = self.client.post(f"/api/v1/accounts/import/{response.data['id']}/confirm/", {}, format='json', **self.headers)
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.assertEqual(Account.objects.filter(organisation=self.org).count(), 2)

    def test_legacy_literal_and_editor_cell_reference_are_supported(self):
        for expression in ['"1"', '1', ' = "1" ', 'Instructions!$C$1', "='Instructions'!C1"]:
            with self.subTest(expression=expression):
                self.assertEqual(self.upload(edited_metadata(self.populated(), named=expression)).status_code, 201)

    def test_old_versions_rejected_with_or_without_defined_name(self):
        for expression in ['"0"', VERSION_REFERENCE, None]:
            with self.subTest(expression=expression): self.assert_unsupported(edited_metadata(self.populated(), named=expression, cell='0'))

    def test_missing_versions_do_not_fall_back_to_filename_or_columns(self):
        for expression in [None, VERSION_REFERENCE]:
            with self.subTest(expression=expression): self.assert_unsupported(edited_metadata(self.populated(), named=expression, cell=None))

    def test_conflicting_or_unrecognised_version_metadata_rejected(self):
        for named, cell in [('"0"', '1'), ('"1"', '0'), ('"999"', '1'), ('SUM(1,0)', '1'), ("'[external.xlsx]Instructions'!$C$1", '1')]:
            with self.subTest(named=named, cell=cell): self.assert_unsupported(edited_metadata(self.populated(), named=named, cell=cell))

    def test_invalid_and_corrupt_workbooks_rejected(self):
        for content in [b'Not a workbook', b'PK\x03\x04broken archive']:
            with self.subTest(content=content): self.assertEqual(self.upload(content).status_code, 400)
        self.assertFalse(AccountImportBatch.objects.exists())
