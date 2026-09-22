"""Invoice PDF presentation only; amounts come unchanged from the document contract."""
import base64
import io
import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Image, KeepTogether, LongTable, Paragraph, Spacer, Table, TableStyle

CURRENCIES = json.loads(Path(__file__).with_name('currency_metadata.json').read_text())


def display_date(value):
    try:
        parsed = date.fromisoformat(value)
        return f"{parsed.day:02d} {('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')[parsed.month-1]} {parsed.year}"
    except (ValueError, TypeError):
        return value or '—'


def display_money(value, currency):
    digits = CURRENCIES.get(currency, {}).get('minor_units', 2)
    return f'{currency} {Decimal(value):,.{digits}f}'


def display_row(row, currency):
    description, quantity, price, discount, tax, amount = row
    lines = description.split('\n')
    match = re.fullmatch(r'(ZERO|EXEMPT|OUT_SCOPE)(?:: (.*))?', lines[-1])
    treatment = ''
    if match:
        lines.pop()
        treatment = {'ZERO': 'Zero-rated', 'EXEMPT': 'Exempt', 'OUT_SCOPE': 'Out of scope'}[match[1]]
        if match[2]: treatment += ': ' + match[2]
    quantity = re.sub(r'(\.\d*?[1-9])0+$|\.0+$', lambda m: m[1] or '', str(quantity))
    return ['\n'.join(lines), quantity, display_money(price, currency), display_money(discount, currency), display_money(tax, currency) + ('\n' + treatment if treatment else ''), display_money(amount, currency)]


def invoice_story(document, width):
    normal = ParagraphStyle('InvoiceText', fontName='Helvetica', fontSize=9, leading=12, textColor=colors.HexColor('#344054'), wordWrap='CJK')
    title = ParagraphStyle('InvoiceTitle', parent=normal, fontSize=25, leading=32, textColor=colors.HexColor('#101828'))
    heading = ParagraphStyle('InvoiceHeading', parent=normal, fontName='Helvetica-Bold', fontSize=16, leading=21)
    label = ParagraphStyle('InvoiceLabel', parent=normal, fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#667085'), spaceBefore=12, spaceAfter=8)
    right = ParagraphStyle('InvoiceNumeric', parent=normal, fontSize=8, leading=12, alignment=2)
    cell = ParagraphStyle('InvoiceCell', parent=normal, fontSize=8, leading=12)
    def p(text, style=normal):
        return Paragraph(escape(str(text)).replace('\n', '<br/>'), style)
    org = document['organisation']
    company = []
    if org.get('logo_data'):
        image = Image(io.BytesIO(base64.b64decode(org['logo_data'].split(',', 1)[1])))
        image._restrictSize(140, 65)
        company.append(image)
    company.extend([p(org['name'], heading), Spacer(1, 8)])
    company.extend(p(line) for line in org.get('address', []))
    for key in ('trading_name', 'phone', 'email', 'website', 'registration_number', 'tax_number', 'vat_registration_number'):
        if org.get(key): company.append(p(key.replace('_', ' ').title() + ': ' + org[key]))
    details = [p(document['title'].upper(), title), p(document['number'], heading), Spacer(1, 12)]
    for name, value in [('Invoice date', display_date(document['date'])), ('Due date', display_date(document.get('due_date'))), ('Currency', document['currency'] + ' · ' + document['currency_basis'] + ' currency'), ('Status', document['status'].replace('_', ' ').title())]:
        if name != 'Due date' or document.get('due_date'): details.append(p(name + ': ' + value))
    header = Table([[company, details]], colWidths=[width*.56, width*.44])
    header.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),16),('BOTTOMPADDING',(0,0),(-1,-1),20),('LINEBELOW',(0,0),(-1,-1),.5,colors.HexColor('#e4e7ec'))]))
    story = [header]
    party = document.get('party')
    if party:
        story.extend([p('BILL TO', label), p(party['name'], heading)])
        story.extend(p(line) for line in party.get('address', []))
        for key in ('tax_number', 'registration_number'):
            if party.get(key): story.append(p(key.replace('_', ' ').title() + ': ' + party[key]))
    if document.get('reference'): story.append(p('Reference: ' + document['reference']))
    story.append(Spacer(1, 20))
    rows = [['Description', 'Quantity', 'Unit price', 'Discount', 'Tax', 'Amount']] + [display_row(row, document['currency']) for row in document['rows']]
    table = LongTable([[p(value, cell if i == 0 else right) for i, value in enumerate(row)] for row in rows], colWidths=[width*.32]+[width*.136]*5, repeatRows=1, splitInRow=1)
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#f2f4f7')),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#e4e7ec')),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.extend([table, Spacer(1, 18)])
    totals = Table([[p(name), p(display_money(value, document['currency']), right)] for name, value in document['totals']], colWidths=[170, 130], hAlign='RIGHT')
    commands = [('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]
    for i, (name, _) in enumerate(document['totals']):
        if name in ('Total', 'Amount due'):
            commands.extend([('BACKGROUND',(0,i),(-1,i),colors.HexColor('#eff8fa')),('LINEABOVE',(0,i),(-1,i),.5,colors.HexColor('#cce5ea'))])
    totals.setStyle(TableStyle(commands))
    story.append(KeepTogether([totals]))
    for name, text in [('NOTES', document.get('notes')), ('PAYMENT INFORMATION', org.get('payment_instructions'))]:
        if text: story.extend([p(name, label), p(text)])
    if document.get('correction'):
        correction = document['correction']
        story.extend([p('REVERSAL ' + correction['reference'], label), p(display_date(correction['date']) + ' · ' + correction['actor']), p(correction['reason']), p(correction['at'])])
    return story
