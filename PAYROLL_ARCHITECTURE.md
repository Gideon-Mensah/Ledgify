# Ledgify payroll architecture

Payroll is organisation-scoped and country-neutral. `Employee` stores employment and payment master data. Sensitive bank details are returned only through payroll-protected endpoints and should be encrypted at rest by the production database/secrets layer.

`PayrollComponent` defines earning, deduction, or employer-cost behavior and maps it to configured chart-of-account records. `EmployeePayrollComponent` assigns fixed or quantity/rate values to an employee. Adapter-calculated components are reserved for future statutory rule packs.

Calculation replaces draft calculations deterministically and creates one `Payslip` per eligible employee. `PayslipLine` snapshots the component name, type, amount, flags, and accounts. Later component changes therefore do not alter calculated or posted history. Gross earnings minus deductions equals net pay; employer costs are tracked separately.

Lifecycle: Draft → Calculated → Approved → Posted → Paid. Posting uses the existing journal and accounting-period services:

- Earnings debit configured expense accounts.
- Net pay credits the pay-run payroll liability account.
- Deductions credit their configured liability/control accounts.
- Employer costs debit their expense accounts and credit their liability accounts.
- Payments debit payroll liability and credit a selected organisation bank account.

Payments can be partial and are allocated deterministically by employee number. Journals remain the authoritative accounting ledger. Payroll reports provide summary, employee earnings, liability, journals, and year-to-date figures from posted/paid payslips.

`PayrollJurisdictionAdapter` exposes employee validation, tax, social-security, and pension calculation hooks. The base adapter returns zero statutory values. No PAYE, National Insurance, pension, or other country rule is embedded. Production country packs must define current rules, statutory identifiers, filing formats, and compliance tests separately.
