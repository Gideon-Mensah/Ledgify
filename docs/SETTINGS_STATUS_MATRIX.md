# Settings Status Matrix

| Settings Area | Frontend | Backend | Editable | Permission Protected | Status | Outstanding Work |
| --- | --- | --- | --- | --- | --- | --- |
| Organisation Profile | Control-centre form | Organisation serializer/API | Yes | Yes | READY | Branding not stored |
| Financial Settings | Control-centre form | Organisation fields | Yes, subject to safeguards | Yes | READY | Dedicated account selectors remain in FX workbench |
| Financial Years | Linked workbench | Full API | Yes | Yes | READY | Replace legacy prompt interactions in a future focused pass |
| Accounting Periods | Linked workbench | Full API | Yes | Yes | READY | Replace legacy prompt interactions in a future focused pass |
| Accounting Defaults | Explanatory/domain links | No central defaults model | No | Domain enforced | PARTIAL | Add safe defaults model if required |
| Document Numbering | Not shown | No configuration API | No | N/A | NOT_IMPLEMENTED | Authoritative configurable sequences needed |
| Sales Settings | Domain workflow only | No settings model | No | Domain enforced | NOT_IMPLEMENTED | Persisted defaults needed |
| Purchase Settings | Domain workflow only | No settings model | No | Domain enforced | NOT_IMPLEMENTED | Persisted defaults needed |
| Banking Settings | Linked workflows | Bank APIs | Per bank/rule | Yes | PARTIAL | No global preference model |
| Inventory Settings | Policy and warehouses | Inventory APIs | Warehouses elsewhere | Yes | READY | Global reorder defaults not stored |
| Fixed Asset Settings | Category summary/cross-link | Category API | In Asset Register | Yes | READY | Dedicated category edit page optional |
| Tax Settings | Linked workbench | Organisation/tax APIs | Yes | Yes | READY | Filing adapters remain jurisdiction-dependent |
| Payroll Settings | Linked workbench | Payroll APIs | Components/runs | Yes | PARTIAL | No organisation payroll-default model |
| Currency Settings | Linked workbench | Organisation/FX APIs | Yes | Yes | READY | Base currency locks after postings |
| Manufacturing Settings | Linked workbench | Manufacturing APIs | Per order/BOM | Yes | PARTIAL | No global defaults model |
| Consolidation Settings | Linked workbench | Consolidation APIs | Yes | Yes | READY | NCI/equity/proportionate/CTA unsupported |
| AI Settings | Control-centre safety form | AISettings API | Yes | Yes | READY | Provider status endpoint is response-metadata based |
| Users | Membership list/role/status | Membership API | Yes | Yes | PARTIAL | Safe email invite/profile expansion needed |
| Roles/Permissions | Readable role catalogue | Backend roles/permissions | No | Yes | READY | Custom roles not implemented |
| Security | Safe status | Auth APIs | No | Authenticated | PARTIAL | Password change and 2FA APIs needed |
| Notifications | Not shown | No preferences model | No | N/A | NOT_IMPLEMENTED | Persistence/API needed |
| Integrations | Safe status cards | Deployment configuration | No | Authenticated | PARTIAL | Dedicated health endpoints optional |
| System Information | Safe client information | No system-status API | No | Authenticated | PARTIAL | Non-sensitive health/version endpoint optional |
