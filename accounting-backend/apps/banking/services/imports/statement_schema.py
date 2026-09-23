"""Canonical statement schema, bounded readers and conservative value parsing."""
import csv
import io
import re
import zipfile
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from django.conf import settings
from common.exceptions import BusinessRuleError

FIELDS = [
 ('transaction_date','Date',True,['date','transaction date','posting date','value date','booked date','booking date']),
 ('description','Description',True,['description','details','narrative','transaction','memo','payee']),
 ('reference','Reference',False,['reference','ref','transaction reference','payment reference']),
 ('amount','Amount',False,['amount','transaction amount']),
 ('transaction_type','Transaction type',False,['transaction type','type','credit debit','cr dr','direction']),
 ('credit','Money In',False,['money in','credit','credits','deposit','deposits','paid in']),
 ('debit','Money Out',False,['money out','debit','debits','withdrawal','withdrawals','paid out']),
 ('balance','Balance',False,['balance','running balance','closing balance']),
 ('currency','Currency',False,['currency','currency code','ccy']),
 ('external_id','External ID',False,['external id','transaction id','bank transaction id']),
]
TEMPLATE_FIELDS=[field for field in FIELDS if field[0] not in {'amount','transaction_type'}]
DATE_FORMATS={'auto':'Detect safely','%d/%m/%Y':'DD/MM/YYYY','%m/%d/%Y':'MM/DD/YYYY','%Y-%m-%d':'YYYY-MM-DD','%d-%m-%Y':'DD-MM-YYYY','%d %b %Y':'DD Mon YYYY'}
MAX_COLUMNS=64

def normalise(value): return re.sub(r'[^a-z0-9]','',str(value).strip().casefold())
def schema():
    return {'fields':[{'key':key,'label':label,'required':required,'aliases':aliases} for key,label,required,aliases in FIELDS],
            'formats':['CSV','XLSX'],'max_bytes':getattr(settings,'BANK_IMPORT_MAX_BYTES',5*1024*1024),
            'max_rows':getattr(settings,'BANK_IMPORT_MAX_ROWS',10000),'date_formats':DATE_FORMATS,
            'template_headers':[f[1] for f in TEMPLATE_FIELDS],
            'example':['2026-09-23','Example bank receipt','EXAMPLE-001','5000.00','','37500.00','','bank-reference-001']}

def template_csv():
    output=io.StringIO();csv.writer(output).writerow([field[1] for field in TEMPLATE_FIELDS]);return '\ufeff'+output.getvalue()

def validate_upload(name, content, mime=''):
    if len(content)>getattr(settings,'BANK_IMPORT_MAX_BYTES',5*1024*1024):raise BusinessRuleError('The statement exceeds the configured upload size limit.')
    suffix=PurePosixPath(name).suffix.lower()
    if suffix not in {'.csv','.xlsx'}:raise BusinessRuleError("This file type is not supported. Upload CSV or XLSX. PDF statements cannot be automatically imported.")
    allowed={'.csv':{'','text/csv','text/plain','application/csv','application/vnd.ms-excel','application/octet-stream'},'.xlsx':{'','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream','application/zip'}}
    if mime.lower() not in allowed[suffix]:raise BusinessRuleError('File content type does not match the selected statement format.')
    if suffix=='.xlsx' and not content.startswith(b'PK\x03\x04'):raise BusinessRuleError('The file is not a valid XLSX workbook.')
    if suffix=='.csv' and (b'\x00' in content or content.startswith((b'MZ',b'PK',b'%PDF',b'\x7fELF'))):raise BusinessRuleError('The file is not a text CSV statement.')
    return suffix[1:]

def _xlsx(content):
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    def xml(archive,path):
        data=archive.read(path)
        if b'\x00' in data or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():raise BusinessRuleError('XML entities and non-UTF-8 XML are not supported in statement workbooks.')
        return ET.fromstring(data)
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            infos=archive.infolist();names=set(archive.namelist())
            if len(infos)>2000 or sum(item.file_size for item in infos)>32*1024*1024 or any(item.flag_bits&1 for item in infos):raise BusinessRuleError('Workbook is encrypted or exceeds safe extraction limits.')
            if any('vbaproject' in name.lower() or name.lower().endswith(('.bin','.exe','.js')) for name in names):raise BusinessRuleError('Macros and executable workbook content are not supported.')
            for name in names:
                if name.endswith('.rels') and any(node.get('TargetMode')=='External' for node in xml(archive,name)):raise BusinessRuleError('External workbook links are not supported.')
            workbook=xml(archive,'xl/workbook.xml');sheets=workbook.findall('m:sheets/m:sheet',ns)
            if len(sheets)!=1:raise BusinessRuleError('Use a workbook containing one statement worksheet, or export the statement sheet as CSV.')
            rels={node.get('Id'):node.get('Target') for node in xml(archive,'xl/_rels/workbook.xml.rels')}
            target=rels[sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            path=target.lstrip('/') if target.startswith('/') else 'xl/'+target
            if '..' in PurePosixPath(path).parts:raise BusinessRuleError('Invalid workbook worksheet path.')
            shared=[]
            if 'xl/sharedStrings.xml' in names:shared=[''.join(node.itertext()) for node in xml(archive,'xl/sharedStrings.xml').findall('m:si',ns)]
            date_styles=set()
            if 'xl/styles.xml' in names:
                styles=xml(archive,'xl/styles.xml');formats={int(node.get('numFmtId')):node.get('formatCode','') for node in styles.findall('m:numFmts/m:numFmt',ns)}
                for i,style in enumerate(styles.findall('m:cellXfs/m:xf',ns)):
                    code=int(style.get('numFmtId','0'));fmt=formats.get(code,'').lower()
                    if code in {14,15,16,17,22} or (re.search('[dy]',fmt) and 'm' in fmt):date_styles.add(i)
            props=workbook.find('m:workbookPr',ns);epoch=datetime(1904,1,1) if props is not None and props.get('date1904') in {'1','true'} else datetime(1899,12,30)
            rows=[]
            for row in xml(archive,path).findall('m:sheetData/m:row',ns):
                if len(rows)>getattr(settings,'BANK_IMPORT_MAX_ROWS',10000):raise BusinessRuleError('The statement exceeds the configured row limit.')
                values={}
                for cell in row.findall('m:c',ns):
                    if cell.find('m:f',ns) is not None:raise BusinessRuleError('Statement cells contain formulas. Save values only before importing.')
                    match=re.fullmatch(r'([A-Z]+)[1-9][0-9]*',cell.get('r',''))
                    if not match:raise ValueError()
                    index=0
                    for letter in match[1]:index=index*26+ord(letter)-64
                    if index>MAX_COLUMNS:raise BusinessRuleError('The statement has too many columns.')
                    value=cell.find('m:v',ns);value=value.text or '' if value is not None else ''
                    if cell.get('t')=='inlineStr':value=''.join(cell.find('m:is',ns).itertext())
                    elif cell.get('t')=='s':value=shared[int(value)]
                    elif int(cell.get('s','0')) in date_styles and value:value=(epoch+timedelta(days=float(value))).date().isoformat()
                    values[index-1]=value
                rows.append([values.get(i,'') for i in range(max(values,default=-1)+1)])
            return rows
    except (zipfile.BadZipFile,KeyError,ValueError,IndexError,AttributeError,ET.ParseError,OverflowError,RuntimeError,NotImplementedError,OSError) as exc:
        raise BusinessRuleError('The workbook is malformed or not a supported XLSX statement. Export a clean CSV or XLSX file.') from exc

def read_statement(name,content,mime=''):
    kind=validate_upload(name,content,mime)
    if kind=='xlsx':rows=_xlsx(content)
    else:
        try:
            text=content.decode('utf-8-sig')
            try:delimiter=csv.Sniffer().sniff(text[:16384],delimiters=',;\t').delimiter
            except csv.Error:delimiter=','
            rows=[]
            for row in csv.reader(io.StringIO(text),delimiter=delimiter,strict=True):
                if not any(value.strip() for value in row):continue
                if len(rows)>getattr(settings,'BANK_IMPORT_MAX_ROWS',10000):raise BusinessRuleError('The statement exceeds the configured row limit.')
                if len(row)>MAX_COLUMNS:raise BusinessRuleError('The statement has too many columns.')
                rows.append(row)
        except (UnicodeDecodeError,csv.Error):raise BusinessRuleError('CSV must be valid UTF-8 text with consistent quoted columns.') from None
    rows=[row for row in rows if any(str(value).strip() for value in row)]
    if len(rows)<2:raise BusinessRuleError('Include a header row and at least one statement row.')
    if len(rows)-1>getattr(settings,'BANK_IMPORT_MAX_ROWS',10000):raise BusinessRuleError('The statement exceeds the configured row limit.')
    headers=[str(value).strip() for value in rows[0]]
    if len(headers)>MAX_COLUMNS or len(headers)<2 or any(not value or len(value)>255 for value in headers) or len(set(map(normalise,headers)))!=len(headers):raise BusinessRuleError('Use unique, non-empty column headings of at most 255 characters in the first row (maximum 64 columns).')
    records=[]
    for number,values in enumerate(rows[1:],2):
        if kind=='xlsx':values=values+['']*max(0,len(headers)-len(values))
        records.append((number,dict(zip(headers,values)),'' if len(values)==len(headers) else 'The number of values does not match the file headings.'))
    return headers,records,kind

def detect_statement(name,content,mime=''):
    headers,rows,kind=read_statement(name,content,mime);mapping={};ambiguous=[]
    for key,label,_,aliases in FIELDS:
        matches=[header for header in headers if normalise(header) in {normalise(alias) for alias in aliases}]
        if len(matches)==1:mapping[key]=matches[0]
        elif matches:ambiguous.append(label)
    return {**schema(),'headers':headers,'mapping':mapping,'ambiguous_fields':ambiguous,'sample_rows':[{key:str(value)[:1000] for key,value in row.items()} for _,row,_ in rows[:5]],'total_rows':len(rows),'file_type':kind}

def read_date(value,choice):
    value=str(value).strip()
    if not value:raise ValueError('Transaction date is missing.')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):return datetime.strptime(value,'%Y-%m-%d').date()
    if choice!='auto':return datetime.strptime(value,choice).date()
    for fmt in ('%d %b %Y','%d %B %Y'):
        try:return datetime.strptime(value,fmt).date()
        except ValueError:pass
    match=re.fullmatch(r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})',value)
    if match:
        left,right,year=map(int,match.groups())
        if left>12:return datetime(year,right,left).date()
        if right>12:return datetime(year,left,right).date()
        if left==right:return datetime(year,right,left).date()
        raise ValueError('Date is ambiguous. Choose DD/MM/YYYY or MM/DD/YYYY in Map columns.')
    raise ValueError('Transaction date could not be read. Choose the date format in Map columns.')

def read_money(value,blank=False):
    text=str(value or '').strip()
    if not text and blank:return Decimal('0')
    # Grouping commas must be groups of three; decimal commas are never guessed.
    if not re.fullmatch(r'[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?',text):raise ValueError('Amount could not be read. Use a decimal point, at most two decimal places and optional thousands commas.')
    number=Decimal(text.replace(',',''))
    if abs(number)>=Decimal('10000000000000000'):raise ValueError('Amount exceeds the supported limit.')
    return number.quantize(Decimal('.01'))
