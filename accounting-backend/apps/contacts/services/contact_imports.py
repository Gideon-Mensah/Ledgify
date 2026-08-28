"""Secure shared customer and supplier workbook import."""
import hashlib,io,re,zipfile
from datetime import timedelta
from django.db import IntegrityError,transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.accounting.services.account_imports import MAX_FILE_SIZE,_parse_xlsx,template_workbook
from apps.contacts.models import Contact,ContactImportBatch
from apps.contacts.serializers import ContactSerializer
from common.currencies import SUPPORTED_CURRENCIES

MAX_ROWS=2000;VERSION="1"
HEADERS=["Name","Account Number","Contact Name","Email","Phone","Website","Registration Number","Tax Number","Payment Terms","Currency","Credit Limit","Address Line 1","Address Line 2","City","Region","Postcode","Country Code","Notes","Status"]
REQUIRED=["Name"]

def _escape(value):return str(value).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def _letters(number):
 value=""
 while number:number,rem=divmod(number-1,26);value=chr(65+rem)+value
 return value
def _sheet(rows,filtering=False):
 body=[]
 for ri,row in enumerate(rows,1):body.append(f'<row r="{ri}">'+"".join(f'<c r="{_letters(ci)}{ri}" t="inlineStr" s="{1 if ri==1 else 0}"><is><t>{_escape(value)}</t></is></c>' for ci,value in enumerate(row,1))+"</row>")
 filt=f'<autoFilter ref="A1:S{max(1,len(rows))}"/>' if filtering else ""
 return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="19" width="22" customWidth="1"/></cols><sheetData>{"".join(body)}</sheetData>{filt}</worksheet>'
def template(kind):
 plural="Customers" if kind=="customer" else "Suppliers";example=[f"Example {kind.title()} — delete this row",f"EXAMPLE-{kind.upper()}-001","Primary contact","example@example.com","0200000000","https://example.com","REG-001","TAX-001","30 days","GBP","0.00","1 Example Street","","London","","SW1A 1AA","GB","Example rows are ignored","Active"]
 instructions=[[f"Ledgify {kind.title()} Import","Template Version",VERSION],["Required columns",", ".join(REQUIRED)],["Optional columns",", ".join(HEADERS[1:])],["Limits","5 MB and 2,000 data rows"],["Duplicates","Create new only. Stop on existing by default; optional skip-existing mode."],["Opening balances","Do not include balances. Use the separate Opening Balances workflow."],["Examples","Rows with account numbers beginning EXAMPLE- are ignored."]]
 allowed=[["Payment Terms","Currencies","Statuses"]];terms=[label for _,label in Contact.PaymentTerms.choices];statuses=[label for _,label in Contact.Status.choices]
 for i in range(max(len(terms),len(SUPPORTED_CURRENCIES),len(statuses))):allowed.append([terms[i] if i<len(terms) else "",SUPPORTED_CURRENCIES[i] if i<len(SUPPORTED_CURRENCIES) else "",statuses[i] if i<len(statuses) else ""])
 source=zipfile.ZipFile(io.BytesIO(template_workbook()));output=io.BytesIO()
 with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as target:
  for item in source.infolist():
   data=source.read(item.filename)
   if item.filename=="xl/workbook.xml":data=data.replace(b'name="Chart of Accounts"',f'name="{plural}"'.encode())
   elif item.filename=="xl/worksheets/sheet1.xml":data=_sheet([HEADERS,example],True).encode()
   elif item.filename=="xl/worksheets/sheet2.xml":data=_sheet(instructions).encode()
   elif item.filename=="xl/worksheets/sheet3.xml":data=_sheet(allowed).encode()
   target.writestr(item,data)
 return output.getvalue()

def _choice(value,choices,default=None):
 text=str(value or "").strip().casefold().replace("_"," ")
 if not text:return default
 for key,label in choices:
  if text in {key.casefold().replace("_"," "),label.casefold()}:return key
 return None
def preview(*,organisation,user,uploaded_file,kind,import_mode="stop_on_existing"):
 if kind not in {"customer","supplier"}:raise ValidationError("Import type must be customer or supplier.")
 filename=uploaded_file.name.rsplit("/",1)[-1][:255]
 if not filename.lower().endswith(".xlsx") or filename.lower().endswith(".xlsm"):raise ValidationError("Upload a macro-free .xlsx workbook.")
 content=uploaded_file.read()
 if len(content)>MAX_FILE_SIZE:raise ValidationError("The workbook exceeds the 5 MB limit.")
 raw=_parse_xlsx(content,"Customers" if kind=="customer" else "Suppliers")
 if not raw:raise ValidationError("The workbook is empty.")
 headings=[]
 for index in range(1,27):
  value=raw[0][1].get(_letters(index),"").strip()
  if value:headings.append(value)
 if len(headings)!=len(set(headings)):raise ValidationError("The workbook contains duplicate column headings.")
 missing=[name for name in REQUIRED if name not in headings]
 if missing:raise ValidationError("Missing required columns: "+", ".join(missing))
 columns={name:_letters(i+1) for i,name in enumerate(headings)};source=[]
 for number,values in raw[1:]:
  row={name:str(values.get(column,"")).strip() for name,column in columns.items()}
  if not any(row.values()) or row.get("Account Number","").upper().startswith("EXAMPLE-"):continue
  source.append((number,row))
 if not source:raise ValidationError("The workbook contains no importable rows.")
 if len(source)>MAX_ROWS:raise ValidationError(f"The workbook exceeds the {MAX_ROWS:,} row limit.")
 existing=Contact.objects.filter(organisation=organisation);seen_accounts=set();seen_emails=set();seen_names=set();seen_tax=set();rows=[]
 for number,row in source:
  errors=[];warnings=[];name=row.get("Name","").strip();account=row.get("Account Number","").strip();email=row.get("Email","").strip().lower();tax=row.get("Tax Number","").strip();normal_name=name.casefold()
  if account and account.casefold() in seen_accounts:errors.append({"field":"Account Number","message":f"Duplicate {kind} account number within the workbook."})
  if email and email in seen_emails:errors.append({"field":"Email","message":f"Duplicate {kind} email within the workbook."})
  if normal_name and normal_name in seen_names:errors.append({"field":"Name","message":f"Duplicate {kind} name within the workbook."})
  if tax and tax.casefold() in seen_tax:errors.append({"field":"Tax Number","message":f"Duplicate {kind} tax number within the workbook."})
  seen_accounts.add(account.casefold());seen_emails.add(email);seen_names.add(normal_name);seen_tax.add(tax.casefold())
  conflicts=[]
  if account and existing.filter(account_number__iexact=account).exists():conflicts.append("account number")
  if email and existing.filter(email__iexact=email,is_customer=kind=="customer",is_supplier=kind=="supplier").exists():conflicts.append("email")
  if name and existing.filter(name__iexact=name,is_customer=kind=="customer",is_supplier=kind=="supplier").exists():conflicts.append("name")
  if tax and existing.filter(tax_number__iexact=tax,is_customer=kind=="customer",is_supplier=kind=="supplier").exists():conflicts.append("tax number")
  if conflicts:
   message="Existing record conflicts on "+", ".join(conflicts)+"."
   if import_mode=="skip_existing":warnings.append({"field":"Duplicate","message":message})
   else:errors.append({"field":"Duplicate","message":message})
  currency=(row.get("Currency") or organisation.base_currency).upper()
  if currency in {"GH¢","GH₵","GHC"}:currency="GHS";warnings.append({"field":"Currency","message":"Legacy Ghanaian currency value normalised to GHS."})
  terms=_choice(row.get("Payment Terms"),Contact.PaymentTerms.choices,Contact.PaymentTerms.DAYS_30);status=_choice(row.get("Status"),Contact.Status.choices,Contact.Status.ACTIVE)
  data={"name":name,"account_number":account,"contact_name":row.get("Contact Name","").strip(),"email":email,"phone":row.get("Phone","").strip(),"website":row.get("Website","").strip(),"registration_number":row.get("Registration Number","").strip(),"tax_number":tax,"is_customer":kind=="customer","is_supplier":kind=="supplier","payment_terms":terms,"currency":currency,"credit_limit":row.get("Credit Limit") or None,"address_line_1":row.get("Address Line 1","").strip(),"address_line_2":row.get("Address Line 2","").strip(),"city":row.get("City","").strip(),"region":row.get("Region","").strip(),"postal_code":row.get("Postcode","").strip(),"country_code":row.get("Country Code","").strip().upper(),"notes":row.get("Notes","").strip(),"status":status}
  skip=bool(conflicts and import_mode=="skip_existing");serializer=ContactSerializer(data=data,context={"organisation":organisation})
  if not skip and not serializer.is_valid():
   for field,messages in serializer.errors.items():errors.extend({"field":field,"message":str(message)} for message in messages)
  row_status="existing" if conflicts else("error" if errors else("warning" if warnings else "ready"));rows.append({"row_number":number,"data":data,"status":row_status,"errors":errors,"warnings":warnings,"skip":skip})
 errors=sum(bool(row["errors"]) for row in rows);warnings=sum(bool(row["warnings"]) for row in rows);duplicates=sum(row["status"]=="existing" for row in rows)
 return ContactImportBatch.objects.create(organisation=organisation,import_type=kind,uploaded_by=user,original_filename=filename,checksum=hashlib.sha256(content).hexdigest(),import_mode=import_mode,rows=rows,total_rows=len(rows),valid_rows=len(rows)-errors,error_rows=errors,warning_rows=warnings,duplicate_rows=duplicates,expires_at=timezone.now()+timedelta(hours=24))
def data(batch):return {"id":str(batch.id),"import_type":batch.import_type,"status":batch.status,"filename":batch.original_filename,"total_rows":batch.total_rows,"valid_rows":batch.valid_rows,"warning_rows":batch.warning_rows,"error_rows":batch.error_rows,"duplicate_rows":batch.duplicate_rows,"rows":batch.rows,"created_record_ids":batch.created_record_ids,"skipped_rows":batch.skipped_rows,"expires_at":batch.expires_at}
@transaction.atomic
def confirm(batch,user):
 batch=ContactImportBatch.objects.select_for_update().get(pk=batch.pk)
 if batch.status==ContactImportBatch.Status.COMPLETED:return batch
 if batch.expires_at<=timezone.now():batch.status="expired";batch.save(update_fields=["status"]);raise ValidationError("This import batch has expired.")
 if batch.status!="ready" or batch.error_rows:raise ValidationError("Resolve all validation errors before confirming the import.")
 created=[];skipped=0
 try:
  for row in batch.rows:
   if row.get("skip"):skipped+=1;continue
   serializer=ContactSerializer(data=row["data"],context={"organisation":batch.organisation});serializer.is_valid(raise_exception=True);created.append(serializer.save(organisation=batch.organisation,created_by=user).id)
 except (IntegrityError,ValidationError) as error:raise ValidationError("Contact data changed after preview. No records were imported.") from error
 batch.created_record_ids=[str(item) for item in created];batch.skipped_rows=skipped;batch.confirmed_by=user;batch.confirmed_at=timezone.now();batch.status="completed";batch.save(update_fields=["created_record_ids","skipped_rows","confirmed_by","confirmed_at","status"]);return batch
