"""Reviewed catalogue facts; activation is always organisation-controlled."""
from datetime import date

GRA_VAT_SOURCE = 'https://gra.gov.gh/domestic-tax/tax-types/vat/'
GRA_NOTICE_SOURCE = 'https://gra.gov.gh/news/portfolio/notice-to-all-vat-registered-taxpayers/'
GRA_WHT_SOURCE = 'https://gra.gov.gh/portfolio/withholding-tax/'
GRA_WHT_CODES = 'https://gra.gov.gh/wp-content/uploads/2020/09/WHT-TAX-CODES_DESCRIPTION-AND-RATES_2015.pdf'
GRA_VAT_WHT_SOURCE = 'https://gra.gov.gh/domestic-tax/tax-types/vat-withholding/'
GHANA_VERSION = '2026.1'
GHANA_EFFECTIVE = date(2026, 1, 1)
CHECKED_ON = date(2026, 9, 12)
VAT_COMPONENTS = [
    {'code': 'VAT', 'name': 'VAT', 'kind': 'PERCENT', 'rate': '15', 'depends_on': [], 'recoverable_percent': '100', 'reporting_group': 'VAT'},
    {'code': 'NHIL', 'name': 'NHIL', 'kind': 'PERCENT', 'rate': '2.5', 'depends_on': [], 'recoverable_percent': '100', 'reporting_group': 'NHIL'},
    {'code': 'GETFUND', 'name': 'GETFund Levy', 'kind': 'PERCENT', 'rate': '2.5', 'depends_on': [], 'recoverable_percent': '100', 'reporting_group': 'GETFUND'},
]
GHANA_CODES = [
    ('GHS-STD-SALES', 'Standard-rated sale', 'SALES', 'STANDARD', False),
    ('GHS-STD-PURCHASE', 'Standard-rated purchase', 'PURCHASES', 'STANDARD', False),
    ('GHS-ZERO-SALES', 'Zero-rated sale', 'SALES', 'ZERO', False),
    ('GHS-ZERO-PURCHASE', 'Zero-rated purchase', 'PURCHASES', 'ZERO', False),
    ('GHS-EXEMPT-SALES', 'Exempt sale', 'SALES', 'EXEMPT', False),
    ('GHS-EXEMPT-PURCHASE', 'Exempt purchase', 'PURCHASES', 'EXEMPT', False),
    ('GHS-OUT-SCOPE', 'Outside scope', 'BOTH', 'OUT_SCOPE', False),
    ('GHS-IMPORT-GOODS', 'Imported goods — review customs treatment', 'PURCHASES', 'IMPORT_GOODS', True),
    ('GHS-IMPORT-SERVICES', 'Imported services — review reverse-charge treatment', 'PURCHASES', 'IMPORT_SERVICES', True),
    ('GHS-DIGITAL-NR', 'Non-resident digital services — eligibility review', 'BOTH', 'STANDARD', True),
    ('GHS-CREDIT', 'Credit — original source snapshot required', 'BOTH', 'STANDARD', True),
    ('GHS-DEBIT', 'Debit — original source snapshot required', 'BOTH', 'STANDARD', True),
]
# Categories are available for classification. Official portal codes/rates must
# be verified together with an effective date before use; none is fabricated.
WHT_CATEGORIES = ['GOODS', 'SERVICES', 'WORKS', 'RENT', 'INTEREST', 'DIVIDENDS',
                  'ROYALTIES', 'COMMISSIONS', 'MANAGEMENT_TECHNICAL', 'OTHER']
TRACKING_OBLIGATIONS = ['CIT', 'PAYE', 'SSNIT', 'RENT', 'CST', 'EXCISE', 'CUSTOMS', 'CAPITAL_GAINS', 'OTHER']
CONTROL_ROLES = ['OUTPUT_VAT', 'INPUT_VAT', 'OUTPUT_NHIL', 'INPUT_NHIL',
                 'OUTPUT_GETFUND', 'INPUT_GETFUND', 'VAT_CLEARING', 'TAX_ADJUSTMENTS',
                 'WHT_PAYABLE', 'WHT_RECEIVABLE', 'VAT_WHT_CREDIT', 'VAT_WHT_PAYABLE']
OVERRIDE_NOTICE = 'Organisation-created tax rule. Confirm this rate and treatment with your accountant or the Ghana Revenue Authority.'
