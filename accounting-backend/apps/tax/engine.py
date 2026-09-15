"""Decimal-only component calculator. No jurisdiction or transport logic lives here.

Policy: two-decimal HALF_UP at line/component level, matching Phase 2. Inclusive
prices solve the common base algebraically; any cent residual is allocated to
one component and recorded explicitly. Dependencies may name earlier components
only, making ordering deterministic and circular tax-on-tax impossible.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from common.exceptions import BusinessRuleError

ZERO = Decimal('0.00')
CENT = Decimal('0.01')


def decimal(value):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or abs(result)>Decimal('1e24'):
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise BusinessRuleError('Enter a finite decimal value.') from None


def money(value):
    amount=decimal(value)
    if abs(amount)>Decimal('9999999999999999.99'):
        raise BusinessRuleError('Tax amount exceeds the supported ledger precision.')
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)


def validate_components(components, *, maximum_rate='1000', high_rate='100', confirm_high=False):
    if not isinstance(components, list) or not 1 <= len(components) <= 12:
        raise BusinessRuleError('Configure between one and twelve tax components.')
    seen = set()
    for component in components:
        code = str(component.get('code', ''))
        if not code or len(code) > 30 or code in seen:
            raise BusinessRuleError('Component codes must be present, unique and at most 30 characters.')
        kind = component.get('kind', 'PERCENT')
        rate = decimal(component.get('rate', 0))
        if kind not in {'PERCENT', 'FIXED'} or rate < 0 or rate > decimal(maximum_rate):
            raise BusinessRuleError('Component amount exceeds the configured validation limits.')
        if rate > decimal(high_rate) and not confirm_high:
            raise BusinessRuleError('Explicit confirmation is required for an unusually high component amount.')
        dependencies = component.get('depends_on', [])
        if not isinstance(dependencies, list) or len(set(dependencies)) != len(dependencies) or not set(dependencies) <= seen:
            raise BusinessRuleError('Tax dependencies must reference distinct earlier components; self references and cycles are not allowed.')
        if kind == 'FIXED' and dependencies:
            raise BusinessRuleError('A fixed amount cannot depend on another tax component.')
        recoverable = decimal(component.get('recoverable_percent', 100))
        if not 0 <= recoverable <= 100:
            raise BusinessRuleError('Recoverability must be between zero and 100 percent.')
        seen.add(code)
    return components


def calculate_components(*, quantity, unit_price, discount=0, components, inclusive=False,
                         classification='STANDARD', scope='SALES', maximum_rate='1000', confirm_high=True):
    validate_components(components, maximum_rate=maximum_rate, confirm_high=confirm_high)
    quantity, unit_price, discount = map(decimal, (quantity, unit_price, discount))
    if quantity <= 0 or unit_price < 0 or discount < 0:
        raise BusinessRuleError('Quantity must be positive; price and discount cannot be negative.')
    priced = money(quantity * unit_price) - money(discount)
    if priced < 0:
        raise BusinessRuleError('Discount exceeds the line amount.')
    if classification not in {'STANDARD', 'ZERO', 'EXEMPT', 'OUT_SCOPE', 'IMPORT_GOODS', 'IMPORT_SERVICES', 'REVERSE_CHARGE'}:
        raise BusinessRuleError('Select a supported tax classification.')
    untaxed = classification in {'ZERO', 'EXEMPT', 'OUT_SCOPE'}
    # Represent each unrounded component as a * taxable_base + b.
    coefficients = {}
    for c in components:
        rate = decimal(c.get('rate', 0)) / 100
        dependencies = c.get('depends_on', [])
        a = rate * (1 + sum((coefficients[k][0] for k in dependencies), ZERO))
        b = rate * sum((coefficients[k][1] for k in dependencies), ZERO)
        if c.get('kind', 'PERCENT') == 'FIXED':
            a, b = ZERO, decimal(c['rate']) * quantity
        coefficients[c['code']] = (ZERO, ZERO) if untaxed else (a, b)
    a = sum((v[0] for v in coefficients.values()), ZERO)
    b = sum((v[1] for v in coefficients.values()), ZERO)
    net = money((priced - b) / (1 + a)) if inclusive else priced
    if net < 0:
        raise BusinessRuleError('Inclusive amount is below its fixed taxes.')
    calculated = []
    prior = {}
    for component in components:
        c = dict(component)
        base = net + sum((prior[k] for k in c.get('depends_on', [])), ZERO)
        amount = ZERO if untaxed else money(decimal(c['rate']) * quantity if c.get('kind') == 'FIXED' else base * decimal(c['rate']) / 100)
        prior[c['code']] = amount
        c.update(base=str(base), amount=str(amount), rounding_adjustment='0.00')
        calculated.append(c)
    total_tax = sum((decimal(c['amount']) for c in calculated), ZERO)
    if inclusive:
        residual = priced - net - total_tax
        if residual:
            candidates = [c for c in calculated if decimal(c['amount']) + residual >= 0]
            if not candidates or abs(residual) > CENT * len(calculated):
                raise BusinessRuleError('Inclusive tax components do not reconcile.')
            target = max(candidates, key=lambda c: decimal(c['amount']))
            target['amount'] = str(decimal(target['amount']) + residual)
            target['rounding_adjustment'] = str(residual)
            total_tax += residual
    for c in calculated:
        recoverable = money(decimal(c['amount']) * decimal(c.get('recoverable_percent', 100)) / 100) if scope == 'PURCHASES' else ZERO
        c['recoverable_amount'] = str(recoverable)
        c['nonrecoverable_amount'] = str(decimal(c['amount']) - recoverable) if scope == 'PURCHASES' else '0.00'
    return {'net_amount': net, 'tax_amount': total_tax, 'gross_amount': net + total_tax,
            'components': calculated, 'classification': classification,
            'rounding_policy': 'LINE_COMPONENT_2DP_HALF_UP_INCLUSIVE_RESIDUAL_LARGEST', 'inclusive': bool(inclusive)}
