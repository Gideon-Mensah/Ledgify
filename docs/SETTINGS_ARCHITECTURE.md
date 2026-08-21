# Ledgify Settings Architecture

## Structure

`/settings` is the permission-aware control centre. Detailed navigation remains inside Settings, while the main application sidebar contains one Settings entry. Supported local pages use `/settings/:section`; established domain workbenches are linked instead of duplicated.

## Settings inventory

| Area | Backend source | Permission | Behaviour |
| --- | --- | --- | --- |
| Organisation profile | `Organisation` via `organisations/:id/` | `manage_organisation_users` | Editable safe serializer fields only |
| Financial settings | `Organisation` | `view_accounting` to discover; update remains backend-protected | Base/reporting currency, timezone and year-start month |
| Financial years | Accounting financial-year API | Financial-year permissions | Existing create/close/reopen workbench |
| Accounting periods | Accounting-period API | Accounting/period permissions | Existing close/reopen workbench |
| Banking | Banking APIs | Accounting/banking permissions | Links to real accounts/import/rules workflows |
| Inventory | Warehouse and inventory APIs | `view_inventory` | Warehouses shown; perpetual WAC and negative-stock rejection are read-only policies |
| Fixed Assets | Fixed Asset category API | `view_fixed_assets` | Category defaults shown; register cross-link |
| Tax | Organisation tax fields and tax APIs | Tax permissions | Existing tax settings/rates/period workflows |
| Payroll | Payroll APIs | `view_payroll` | Existing employees/components/runs workbench |
| Currency & FX | Organisation fields and FX APIs | `view_accounting` | Existing rates/exposure/revaluation workbench |
| Manufacturing | BOM/production APIs | `view_manufacturing` | Existing workbenches; per-order WIP/variance accounts |
| Consolidation | Consolidation APIs | `view_consolidation` | Existing group/mapping/elimination workbench |
| AI | `AISettings` | `manage_ai_settings` | Analysis, drafts, anomalies, sharing controls |
| Users | Organisation memberships | `manage_organisation_users` | Role/status updates; last-owner backend protection |
| Roles | Backend `ROLE_PERMISSIONS` | `manage_organisation_users` | Readable role overview; backend authoritative |
| Security | Auth/session and organisation context | Authenticated user | Safe current-user and isolation information |
| Integrations/System | Deployment configuration | Authenticated user | Non-sensitive status and limitations only |

## Sensitive and read-only settings

- Organisation IDs, creators, internal status and timestamps are never editable.
- Base-currency changes are rejected by the Organisation model after journal activity.
- WAC costing, immutable cost layers and negative-stock rejection are engine policies.
- AI credentials, database credentials, tokens, SMTP passwords and storage secrets are never returned to the browser.
- Membership role/status changes remain organisation-scoped and protect the last owner.

## Configuration gaps

There are no persisted organisation-level models for document numbering preferences, branding, notification preferences, general sales/purchase defaults, global manufacturing defaults, report export preferences, or secure user invitations. These are not presented as editable settings. Password change, 2FA, email-test, database-health and storage-health endpoints are also not currently available.
