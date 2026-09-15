"""Private, server-owned document contract. No browser amounts or remote assets."""
import base64
import hashlib
import io
import json
import re
from decimal import Decimal
from html import escape
from django.apps import apps
from django.http import Http404
from django.db import transaction
from rest_framework.exceptions import ValidationError
from common.ledger_integrity import lock_ledger

KINDS = {
    "invoice": ("sales.Invoice", "invoice_number", "Invoice", "customer"),
    "bill": ("purchases.Bill", "bill_number", "Bill", "supplier"),
    "customer-credit": ("sales.CustomerCreditNote", "credit_note_number", "Customer credit note", "customer"),
    "supplier-credit": ("purchases.SupplierCredit", "credit_number", "Supplier credit note", "supplier"),
    "journal": ("accounting.JournalEntry", "entry_number", "Journal", None),
    "opening-balance": ("accounting.OpeningBalance", "opening_date", "Opening balance", None),
    "customer-payment": ("sales.CustomerPayment", "payment_number", "Payment receipt", "customer"),
    "supplier-payment": ("purchases.SupplierPayment", "payment_number", "Payment confirmation", "supplier"),
    "quote": ("sales.Quote", "quote_number", "Quote", "customer"),
    "sales-order": ("sales.SalesOrder", "order_number", "Sales order", "customer"),
    "purchase-order": ("purchases.PurchaseOrder", "purchase_order_number", "Purchase order", "supplier"),
}


def validate_logo(value):
    if not value: return ""
    from PIL import Image
    try:
        if len(value)>350000 or not value.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")): raise ValueError()
        raw=base64.b64decode(value.split(",",1)[1], validate=True)
        with Image.open(io.BytesIO(raw)) as source:
            if source.width*source.height>4_000_000: raise ValueError()
            source.load(); source.thumbnail((600,300)); output=io.BytesIO()
            source.convert("RGBA").save(output,format="PNG")
        if output.tell()>256000: raise ValueError()
        return "data:image/png;base64,"+base64.b64encode(output.getvalue()).decode()
    except Exception:
        raise ValidationError("Upload a PNG or JPEG logo under 250 KB and four megapixels.") from None


def identity(org):
    name=(org.legal_name or org.name).strip()
    if not name: raise ValidationError("Complete the organisation name in Settings before preparing documents.")
    return {"name":name,"trading_name":org.name if org.name!=name else "",
        "address":[str(getattr(org,f,"")) for f in ("address_line_1","address_line_2","city","region","postal_code","ghana_post_gps","country_code") if getattr(org,f,"")],
        **{f:getattr(org,f,"") for f in ("phone","email","website","registration_number","tax_number","base_currency","payment_instructions","logo_data")}}


def safe_filename(number):
    return (re.sub(r"[^a-zA-Z0-9._-]+","-",str(number)).strip(".-")[:100] or "document")+".pdf"


def scalar(value):
    return str(value) if value is not None else ""


@transaction.atomic
def document_contract(*, organisation, kind, pk):
    if kind not in KINDS: raise Http404()
    lock_ledger(organisation.pk)
    model,number,title,party_field=KINDS[kind]
    obj=apps.get_model(model).objects.filter(organisation=organisation,pk=pk).first()
    if not obj: raise Http404()
    party=getattr(obj,party_field,None) if party_field else None
    if party and party.organisation_id!=organisation.pk: raise Http404()
    currency=getattr(obj,"currency",None) or organisation.base_currency
    is_ledger=kind in ("journal","opening-balance")
    rows=[]
    tax_components={}
    if hasattr(obj,"lines"):
        for line in obj.lines.all()[:1001]:
            if is_ledger:
                account=line.account
                if account.organisation_id!=organisation.pk: raise Http404()
                rows.append([account.code,account.name,getattr(line,"description",""),scalar(line.debit),scalar(line.credit)])
            else:
                snapshot=getattr(line,'tax_snapshot',{})
                if snapshot.get('adjustment_kind')=='DEBIT_NOTE':title='Debit note'
                for component in snapshot.get('components',[]):
                    key=component['name'] if component.get('name') else component['code']
                    if snapshot.get('self_assessed'): key = 'Self-assessed ' + key
                    tax_components[key]=tax_components.get(key,Decimal('0'))+Decimal(component['amount'])
                description=line.description
                if snapshot.get('adjustment_kind')=='DEBIT_NOTE': description += '\nAdjustment to ' + snapshot.get('original_document_number','')
                if snapshot.get('self_assessed'): description += '\nReverse charge: self-assessed tax is excluded from the supplier total.'
                if snapshot.get('components'):
                    description += "\n" + "; ".join(f"{c.get('name',c['code'])}: {c['amount']}" for c in snapshot['components'])
                if snapshot.get('classification') in ('ZERO','EXEMPT','OUT_SCOPE'):
                    description += "\n"+snapshot['classification']+(": "+snapshot.get('reason','') if snapshot.get('reason') else '')
                rows.append([description,scalar(line.quantity),scalar(line.unit_price),scalar(getattr(line,"discount_amount",0)),scalar(getattr(line,"tax_amount",0)),scalar(line.line_total)])
    elif kind.endswith("payment"):
        rows=[["Payment",scalar(obj.amount)]]
    if len(rows)>1000: raise ValidationError("This document exceeds the 1,000-line PDF limit. Split it before exporting.")
    if not rows: raise ValidationError("This document has no lines to print or download.")
    if any(len(str(cell))>8000 for row in rows for cell in row): raise ValidationError("A document field exceeds the rendering limit.")
    totals=[]
    if is_ledger:
        totals=[["Total debit",format(sum((Decimal(row[-2]) for row in rows),Decimal(0)),'.2f')],["Total credit",format(sum((Decimal(row[-1]) for row in rows),Decimal(0)),'.2f')]]
    else:
        for field,label in (("subtotal","Subtotal"),("tax_total","Tax"),("total","Total"),("amount","Amount"),("amount_paid","Paid"),("amount_credited","Credited"),("amount_due","Amount due"),("available_credit","Available credit")):
            if hasattr(obj,field): totals.append([label,scalar(getattr(obj,field))])
    if tax_components:
        index=next((i for i,value in enumerate(totals) if value[0]=="Tax"),1)
        totals[index:index]=[[name,format(amount,".2f")] for name,amount in tax_components.items()]
    if kind.endswith("payment") and getattr(obj,"withholding_amount",0):
        totals.extend([["Withholding",str(obj.withholding_amount)],["Cash paid/received",str(obj.cash_amount)]])
    from apps.accounting.models import AccountingCorrection
    correction=AccountingCorrection.objects.filter(organisation=organisation,source_id=obj.pk).select_related("reversal_journal","performed_by").order_by("-performed_at").first()
    result={"schema_version":1,"kind":kind,"title":title,"number":scalar(getattr(obj,number,None) or getattr(obj,"reference","") or title),
        "organisation":identity(organisation),"currency":currency,"currency_basis":"base" if is_ledger else "transaction",
        "status":getattr(obj,"status",""),"date":scalar(getattr(obj,"issue_date",None) or getattr(obj,"date",None) or getattr(obj,"opening_date",None) or getattr(obj,"payment_date",None) or getattr(obj,"order_date",None)),
        "due_date":scalar(getattr(obj,"due_date",None)),"reference":getattr(obj,"reference","") or getattr(obj,"supplier_reference",""),"notes":getattr(obj,"notes","") or getattr(obj,"description",""),
        "party":{"name":party.name,"email":party.email,"address":[getattr(party,f,"") for f in ("address_line_1","address_line_2","city","region","postal_code","country_code") if getattr(party,f,"")]} if party else None,
        "columns":(["Code","Account","Description","Debit","Credit"] if is_ledger else ["Description","Amount"] if kind.endswith("payment") else ["Description","Quantity","Unit price","Discount","Tax","Total"]),
        "rows":rows,"totals":totals,
        "correction":{"reference":correction.reversal_journal.entry_number,"date":str(correction.reversal_journal.date),"reason":correction.reason,"actor":correction.performed_by.get_full_name() or correction.performed_by.email,"at":correction.performed_at.isoformat()} if correction else None}
    if kind in {'invoice','bill','customer-credit','supplier-credit'}:
        from apps.tax.models import DocumentTaxSnapshot
        from apps.tax.configuration import profile_on
        frozen=DocumentTaxSnapshot.objects.filter(organisation=organisation,source_id=obj.pk).first()
        profile=profile_on(organisation,obj.issue_date)
        registration=frozen.payload.get('organisation_tax_registration',{}) if frozen else profile.registration if profile else {}
        if registration.get('tin'):result['organisation']['tax_number']=registration['tin']
        if registration.get('vat_registration_number'):result['organisation']['vat_registration_number']=registration['vat_registration_number']
        if result['party']:
            identifiers=frozen.payload.get('tax_identifiers',{}) if frozen else {key:getattr(party,key,'') for key in ('tax_number','registration_number')}
            result['party'].update(identifiers)
    result["version"]=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
    return result


def render_pdf(document):
    """Bounded A4 flow layout with escaping, repeated headings and page numbers."""
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle, Image, KeepTogether
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.pdfgen.canvas import Canvas
    if len(json.dumps(document))>1_000_000 or any(len(str(document.get(field,'')))>8000 for field in ('notes','reference')):
        raise ValidationError("The document exceeds the PDF text limit. Shorten notes or select a smaller document.")
    output=io.BytesIO();styles=getSampleStyleSheet()
    small=ParagraphStyle("DocumentCell",parent=styles["Normal"],fontName="Helvetica",fontSize=8,leading=11,wordWrap="CJK")
    def p(text,style=small): return Paragraph(escape(str(text)).replace("\n","<br/>"),style)
    org=document["organisation"];story=[]
    if org.get("logo_data"):
        image=Image(io.BytesIO(base64.b64decode(org["logo_data"].split(",",1)[1])))
        image._restrictSize(140,65);story.append(image)
    story.extend([p(org["name"],styles["Heading1"]),p(" · ".join(org["address"]))])
    for key in ("trading_name","phone","email","website","registration_number","tax_number","vat_registration_number"):
        if org.get(key):story.append(p(key.replace("_"," ").title()+": "+org[key]))
    story.extend([Spacer(1,12),p(document["title"]+" "+document["number"],styles["Heading2"]),p(f"Date: {document['date']}   Due: {document['due_date']}   Status: {document['status']}"),p(f"Currency: {document['currency']} ({document['currency_basis']})")])
    if document.get("party"):
        story.extend([p(document["party"]["name"],styles["Heading3"]),p(" · ".join(document["party"]["address"]))])
    if document.get('party'):
        for key in ('tax_number','registration_number'):
            if document['party'].get(key):story.append(p(key.replace('_',' ').title()+': '+document['party'][key]))
    if document.get("reference"):story.append(p("Reference: "+document["reference"]))
    story.append(Spacer(1,10))
    n=len(document["columns"]);width=A4[0]-72
    widths=[width*(.38 if i==0 else .62/(n-1)) for i in range(n)]
    if n==5:widths=[45,100,width-275,65,65]
    if document["kind"].endswith("-statement"):widths=[58,width-253,65,65,65]
    table=LongTable([[p(x) for x in document["columns"]]]+[[p(x) for x in row] for row in document["rows"]],colWidths=widths,repeatRows=1,splitInRow=1)
    table.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(0,0),(-1,0),colors.HexColor("#eeeeee")),("LINEBELOW",(0,0),(-1,-1),.3,colors.HexColor("#bbbbbb")),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    story.append(table);story.append(Spacer(1,12))
    story.append(KeepTogether([p(f"{label}: {document['currency']} {value}",styles["Heading3"]) for label,value in document["totals"]]))
    if document.get("notes"):story.extend([p("Notes",styles["Heading3"]),p(document["notes"])])
    if org.get("payment_instructions") and document["kind"] in ("invoice","quote","customer-payment"):
        story.extend([p("Payment instructions",styles["Heading3"]),p(org["payment_instructions"])])
    def footer(canvas,doc):
        canvas.saveState();canvas.setFont("Helvetica",8);canvas.drawRightString(A4[0]-36,22,f"Page {doc.page}");canvas.restoreState()
    def invariant_canvas(*args,**kwargs): return Canvas(*args,**{**kwargs,"invariant":1})
    SimpleDocTemplate(output,pagesize=A4,rightMargin=36,leftMargin=36,topMargin=36,bottomMargin=36,title=document["title"]+" "+document["number"],author=org["name"]).build(story,onFirstPage=footer,onLaterPages=footer,canvasmaker=invariant_canvas)
    if output.tell()>10_000_000:raise ValidationError("The PDF exceeds the 10 MB limit.")
    return output.getvalue()

@transaction.atomic
def statement_contract(*,organisation,kind,pk,start_date=None,end_date=None):
    from apps.contacts.models import Contact
    from apps.finance.services.statements.historical import historical_statement
    payable=kind=='supplier-statement'
    contact=Contact.objects.filter(organisation=organisation,pk=pk,**{'is_supplier' if payable else 'is_customer':True}).first()
    if not contact:raise Http404()
    data=historical_statement(organisation=organisation,contact=contact,payable=payable,start_date=start_date,end_date=end_date)
    transactions=data['transactions']
    if len(transactions)>1000:raise ValidationError('Select a shorter period: statements are limited to 1,000 ledger lines.')
    result={'schema_version':1,'kind':kind,'title':'Supplier statement' if payable else 'Customer statement','number':contact.account_number or contact.name,
        'organisation':identity(organisation),'currency':data['currency'],'currency_basis':'base','status':'As of '+str(data['end_date']),
        'date':str(data['start_date'] or ''),'due_date':'','reference':'','notes':'Unallocated amounts and dated reversals are included in the ledger balance. Transaction currencies are translated at their historical carrying values.',
        'party':{'name':contact.name,'email':contact.email,'address':[getattr(contact,f,'') for f in ('address_line_1','address_line_2','city','region','postal_code','country_code') if getattr(contact,f,'')]},
        'columns':['Date','Description','Debit','Credit','Balance'],
        'rows':[[str(x['date']),x['description'],str(x['debit']),str(x['credit']),str(x['balance'])] for x in transactions] or [['','No activity in the selected period','','',str(data['closing_balance'])]],
        'totals':[['Opening balance',str(data['opening_balance'])],['Closing balance',str(data['closing_balance'])]],'correction':None}
    result['version']=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
    return result
