# Commercial Documents Completion

Ledgify now has backend-backed Quote, Sales Order, Purchase Order, Customer Credit, Customer Refund, Supplier Credit, and Supplier Refund workflows.

Quotes can be created, accepted, and converted once into draft invoices. Sales orders can be created, approved, partially fulfilled through the WAC inventory issue service, and converted once to invoices. Purchase orders can be approved, partially received through the WAC receipt service, and converted to bills. Inventory receipt billing clears the explicit GRNI account rather than recording inventory twice.

Operational quotes and orders create no journal and do not affect GL, AR/AP, aging, or inventory. Invoice and bill approval remains the sole revenue/AR and AP posting path. Inventory fulfilment and receipt remain separate posting actions. Credits, applications, and refunds reuse the existing journal-aware, period-aware services.

The API is organisation-scoped and permission-controlled. New commercial permissions cover quote creation/acceptance, sales-order creation/approval/fulfilment, and purchase-order creation/approval/receipt. Approved operational documents cannot be deleted; conversion relationships use protected links.

Active quote, sales-order, purchase-order, and customer-credit list/detail routes now read real backend data through the shared API client. The original Ledgify styles are reused without redesign.

Limitations: backend numbering remains organisation-unique but client-supplied; partial sales invoicing is not implemented; PO bill conversion bills all available received inventory transactions and full non-inventory lines; physical returns and financial credits are explicitly separate; VAT/GST, manufacturing, payroll, and Milestone 8 are excluded.
