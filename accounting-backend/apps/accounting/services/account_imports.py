"""Safe, versioned OOXML generation and atomic Chart of Accounts imports."""
import hashlib
import io
import re
import zipfile
from datetime import timedelta
from xml.etree import ElementTree as ET

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounting.models import Account, AccountImportBatch
from apps.accounting.serializers import AccountSerializer

MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_ROWS = 1000
TEMPLATE_VERSION = "1"
SHEET = "Chart of Accounts"
HEADERS = ["Account Code", "Account Name", "Account Type", "Account Class", "Description", "Currency", "Cash Flow Category", "Allow Manual Journals", "Status"]
REQUIRED = HEADERS[:4]
CLASS_TYPES = {
    "bank": "asset", "current_asset": "asset", "fixed_asset": "asset", "receivable": "asset",
    "current_liability": "liability", "long_term_liability": "liability", "payable": "liability",
    "equity": "equity", "retained_earnings": "equity", "sales": "revenue", "other_income": "revenue",
    "cost_of_sales": "expense", "operating_expense": "expense", "other_expense": "expense",
}

def _xml(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def template_workbook():
    """Build a macro-free OOXML workbook without third-party parsers."""
    output = io.BytesIO()
    examples = [
        ["EXAMPLE-1000", "Cash on Hand (example — delete this row)", "Asset", "Bank", "Example row; it will be ignored", "GBP", "Cash", "Yes", "Active"],
        ["EXAMPLE-4000", "Sales Revenue (example — delete this row)", "Revenue", "Sales", "Example row; it will be ignored", "GBP", "Operating activities", "Yes", "Active"],
    ]
    instructions = [
        ["Ledgify Chart of Accounts Import", "Template Version", TEMPLATE_VERSION],
        ["Required columns", ", ".join(REQUIRED)], ["Optional columns", ", ".join(HEADERS[4:])],
        ["Limits", "5 MB and 1,000 data rows"], ["Duplicates", "Default: stop if a code exists or is repeated. Existing accounts are never updated."],
        ["Boolean values", "Yes, No, True or False"], ["Errors", "Upload first; Ledgify previews every row and provides an error report before creating accounts."],
        ["Examples", "Rows whose code begins EXAMPLE- are ignored. Delete them before entering real data."],
    ]
    allowed = [["Account Types", "Account Classes", "Cash Flow Categories", "Statuses", "Boolean Values"]]
    for i in range(max(len(Account.AccountType.choices), len(Account.AccountClass.choices), len(Account.CashFlowCategory.choices), len(Account.Status.choices), 4)):
        allowed.append([choices[i][1] if i < len(choices) else "" for choices in [Account.AccountType.choices, Account.AccountClass.choices, Account.CashFlowCategory.choices, Account.Status.choices]] + [(["Yes", "No", "True", "False"][i] if i < 4 else "")])
    sheets = [(SHEET, [HEADERS] + examples), ("Instructions", instructions), ("Allowed Values", allowed)]
    def sheet_xml(rows, freeze=False, filter_row=False):
        body=[]
        for r_index,row in enumerate(rows,1):
            cells=[]
            for c_index,value in enumerate(row,1):
                letters="";number=c_index
                while number: number,rem=divmod(number-1,26);letters=chr(65+rem)+letters
                cells.append(f'<c r="{letters}{r_index}" t="inlineStr" s="{1 if r_index==1 else 0}"><is><t>{_xml(value)}</t></is></c>')
            body.append(f'<row r="{r_index}">{"".join(cells)}</row>')
        pane='<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>' if freeze else '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
        filt=f'<autoFilter ref="A1:I{max(1,len(rows))}"/>' if filter_row else ""
        return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{pane}<cols><col min="1" max="9" width="24" customWidth="1"/></cols><sheetData>{"".join(body)}</sheetData>{filt}</worksheet>'
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,4)) + '</Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i,(name,_) in enumerate(sheets,1)) + f'</sheets><definedNames><definedName name="_LedgifyTemplateVersion">"{TEMPLATE_VERSION}"</definedName></definedNames></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,4)) + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        archive.writestr("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font/><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6941C6"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>')
        for i,(_,rows) in enumerate(sheets,1): archive.writestr(f"xl/worksheets/sheet{i}.xml",sheet_xml(rows,freeze=i==1,filter_row=i==1))
    return output.getvalue()

def _canonical(value, choices):
    text=str(value or "").strip().casefold().replace("-"," ").replace("_"," ")
    for key,label in choices:
        if text in {key.casefold().replace("_"," "), label.casefold().replace("-"," ")} : return key
    return None

def _parse_xlsx(content, sheet_name=SHEET):
    if len(content)>MAX_FILE_SIZE: raise ValidationError("The workbook exceeds the 5 MB file limit.")
    if not content.startswith(b"PK\x03\x04"): raise ValidationError("The uploaded file is not a valid .xlsx workbook.")
    try:
        archive=zipfile.ZipFile(io.BytesIO(content)); names=set(archive.namelist())
        if any(name.lower().endswith(("vbaproject.bin",".exe",".js")) for name in names): raise ValidationError("Macro-enabled or executable workbook content is not supported.")
        required={"xl/workbook.xml","xl/_rels/workbook.xml.rels"}
        if not required.issubset(names): raise ValidationError("The uploaded file is not a valid .xlsx workbook.")
        ns={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main","r":"http://schemas.openxmlformats.org/officeDocument/2006/relationships","p":"http://schemas.openxmlformats.org/package/2006/relationships"}
        workbook=ET.fromstring(archive.read("xl/workbook.xml")); rels=ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")); targets={node.attrib["Id"]:node.attrib["Target"] for node in rels}
        version=workbook.find('.//m:definedName[@name="_LedgifyTemplateVersion"]',ns)
        if version is None or (version.text or "").strip('"') != TEMPLATE_VERSION: raise ValidationError("This import template is no longer supported. Download the latest template and try again.")
        sheet=next((node for node in workbook.findall(".//m:sheet",ns) if node.attrib.get("name")==sheet_name),None)
        if sheet is None: raise ValidationError(f'The workbook must contain a worksheet named "{sheet_name}".')
        target=targets[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]].lstrip("/");path=target if target.startswith("xl/") else "xl/"+target
        shared=[]
        if "xl/sharedStrings.xml" in names:
            shared=["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si",ns)]
        root=ET.fromstring(archive.read(path)); data=[]
        for row in root.findall(".//m:sheetData/m:row",ns):
            values={}
            for cell in row.findall("m:c",ns):
                if cell.find("m:f",ns) is not None: value=""
                elif cell.attrib.get("t")=="inlineStr": value="".join(cell.itertext())
                else:
                    node=cell.find("m:v",ns);raw=node.text if node is not None else "";value=shared[int(raw)] if cell.attrib.get("t")=="s" and raw else raw
                values[re.match(r"[A-Z]+",cell.attrib.get("r","A")).group()]=value
            data.append((int(row.attrib.get("r",len(data)+1)),values))
        return data
    except (zipfile.BadZipFile, KeyError, ET.ParseError, ValueError, IndexError) as error: raise ValidationError("The uploaded file is malformed or is not a supported .xlsx workbook.") from error

def preview(*, organisation, user, uploaded_file, import_mode="stop_on_existing"):
    filename=uploaded_file.name.rsplit("/",1)[-1][:255]
    if not filename.lower().endswith(".xlsx") or filename.lower().endswith(".xlsm"): raise ValidationError("Upload a macro-free .xlsx workbook.")
    content=uploaded_file.read();raw_rows=_parse_xlsx(content)
    if not raw_rows: raise ValidationError("The workbook is empty.")
    header_row,header_values=raw_rows[0]; headings=[header_values.get(chr(65+i),"").strip() for i in range(26)];headings=[h for h in headings if h]
    if len(headings)!=len(set(headings)): raise ValidationError("The workbook contains duplicate column headings.")
    missing=[name for name in REQUIRED if name not in headings]
    if missing: raise ValidationError("Missing required columns: "+", ".join(missing))
    columns={name:chr(65+i) for i,name in enumerate([header_values.get(chr(65+j),"").strip() for j in range(26)]) if name}
    source=[]
    for row_number,values in raw_rows[1:]:
        row={name:str(values.get(letter,"")).strip() for name,letter in columns.items()}
        if not any(row.values()) or row.get("Account Code","").upper().startswith("EXAMPLE-"): continue
        source.append((row_number,row))
    if not source: raise ValidationError("The workbook contains no importable data rows.")
    if len(source)>MAX_ROWS: raise ValidationError(f"The workbook exceeds the {MAX_ROWS:,} row limit.")
    organisation_accounts=Account.objects.filter(organisation=organisation)
    existing=set(organisation_accounts.values_list("code",flat=True));existing_classes=set(organisation_accounts.values_list("account_class",flat=True));seen=set();rows=[]
    for number,row in source:
        code=row.get("Account Code","").strip();name=row.get("Account Name","").strip();errors=[];warnings=[]
        account_type=_canonical(row.get("Account Type"),Account.AccountType.choices);account_class=_canonical(row.get("Account Class"),Account.AccountClass.choices)
        if not code: errors.append({"field":"Account Code","message":"Account code is required."})
        elif len(code)>20 or not re.fullmatch(r"[A-Za-z0-9._/-]+",code): errors.append({"field":"Account Code","message":"Account code must be 20 characters or fewer and use letters, numbers, dot, slash, underscore or hyphen."})
        if not name: errors.append({"field":"Account Name","message":"Account name is required."})
        elif len(name)>255: errors.append({"field":"Account Name","message":"Account name must be 255 characters or fewer."})
        if not account_type: errors.append({"field":"Account Type","message":f'Unsupported account type “{row.get("Account Type","")}”.'})
        if not account_class: errors.append({"field":"Account Class","message":f'Unsupported account class “{row.get("Account Class","")}”.'})
        elif account_type and CLASS_TYPES.get(account_class)!=account_type: errors.append({"field":"Account Class","message":f'Account class is not valid for account type “{row.get("Account Type","")}”.'})
        elif account_class in {"receivable","payable","retained_earnings"} and account_class in existing_classes: errors.append({"field":"Account Class","message":"A protected control account with this class already exists. Configure control accounts through the supported accounting settings workflow."})
        if code in seen: errors.append({"field":"Account Code","message":"Duplicate account code within uploaded file."})
        seen.add(code)
        is_existing=code in existing
        if is_existing: errors.append({"field":"Account Code","message":f"Account code {code} already exists."})
        currency=(row.get("Currency") or organisation.base_currency or "").upper()
        if currency and not re.fullmatch(r"[A-Z]{3}",currency): errors.append({"field":"Currency","message":"Currency must be a three-letter code."})
        cash_flow=_canonical(row.get("Cash Flow Category") or "not applicable",Account.CashFlowCategory.choices)
        if not cash_flow: errors.append({"field":"Cash Flow Category","message":"Cash flow category is not supported."})
        status=_canonical(row.get("Status") or "active",Account.Status.choices)
        if not status: errors.append({"field":"Status","message":"Status must be Active, Inactive or Archived."})
        boolean=str(row.get("Allow Manual Journals") or "yes").casefold()
        if boolean not in {"yes","no","true","false"}: errors.append({"field":"Allow Manual Journals","message":"Use Yes, No, True or False."})
        data={"code":code,"name":name,"account_type":account_type,"account_class":account_class,"description":row.get("Description","") ,"currency":currency,"cash_flow_category":cash_flow,"allow_manual_journals":boolean in {"yes","true"},"status":status}
        validator=AccountSerializer(data=data)
        if not errors and not validator.is_valid():
            for field,messages in validator.errors.items(): errors.extend({"field":field,"message":str(message)} for message in messages)
        rows.append({"row_number":number,"data":data,"status":"existing" if is_existing else ("error" if errors else ("warning" if warnings else "ready")),"errors":errors,"warnings":warnings})
    invalid=sum(bool(row["errors"]) for row in rows);existing_count=sum(row["status"]=="existing" for row in rows)
    return AccountImportBatch.objects.create(organisation=organisation,uploaded_by=user,original_filename=filename,checksum=hashlib.sha256(content).hexdigest(),import_mode=import_mode,rows=rows,total_rows=len(rows),valid_rows=len(rows)-invalid,invalid_rows=invalid,existing_rows=existing_count,expires_at=timezone.now()+timedelta(hours=24))

def batch_data(batch):
    return {"id":str(batch.id),"status":batch.status,"filename":batch.original_filename,"total_rows":batch.total_rows,"valid_rows":batch.valid_rows,"invalid_rows":batch.invalid_rows,"existing_rows":batch.existing_rows,"rows":batch.rows,"created_account_ids":batch.created_account_ids,"uploaded_at":batch.uploaded_at,"expires_at":batch.expires_at}

@transaction.atomic
def confirm(*, batch, user):
    batch=AccountImportBatch.objects.select_for_update().get(pk=batch.pk)
    if batch.status==AccountImportBatch.Status.COMPLETED: return batch
    if batch.expires_at<=timezone.now(): batch.status=AccountImportBatch.Status.EXPIRED;batch.save(update_fields=["status"]);raise ValidationError("This import batch has expired. Upload the workbook again.")
    if batch.status!=AccountImportBatch.Status.READY or batch.invalid_rows: raise ValidationError("Resolve all validation errors before confirming the import.")
    created=[]
    try:
        for row in batch.rows:
            account_class=row["data"].get("account_class")
            if account_class in {"receivable","payable","retained_earnings"} and Account.objects.filter(organisation=batch.organisation, account_class=account_class).exists():
                raise ValidationError("A protected control account was created after preview. No accounts were imported.")
            serializer=AccountSerializer(data=row["data"]);serializer.is_valid(raise_exception=True)
            created.append(serializer.save(organisation=batch.organisation,created_by=user).id)
    except (IntegrityError, ValidationError) as error:
        raise ValidationError("The import could not be completed because account data changed after preview. No accounts were created.") from error
    batch.created_account_ids=[str(item) for item in created];batch.confirmed_by=user;batch.confirmed_at=timezone.now();batch.status=AccountImportBatch.Status.COMPLETED;batch.save(update_fields=["created_account_ids","confirmed_by","confirmed_at","status"]);return batch
