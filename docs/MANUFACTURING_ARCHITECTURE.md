# Manufacturing architecture

Milestone 14A provides atomic WAC-backed production material issues, returns, finished-goods receipts, manufacturing journal source types, and immutable production-cost audit records. User-facing services enforce manufacturing permissions; low-level primitives permit internal calls only after their parent workflow authorizes the operation.

Milestone 14B adds organisation-scoped BOMs, non-overlapping effective versions, ordered components, cycle detection, multi-level explosion, scrap factors, and current-WAC cost roll-up. Explosion aggregates terminal raw materials and does not double-count manufactured intermediates.

Production orders start as drafts without accounting effects. Release validates and explodes the BOM, then snapshots terminal requirements and current WAC values. Subsequent BOM edits cannot alter snapshots. Requirements and shortage reporting compare net issued quantities with current warehouse stock. Whole material-issue batches are atomic and reuse 14A accounting, so failures roll back movements, layers, journals, audit records, quantities, and order state. Returns preserve issued history and increase returned quantity separately.

APIs expose BOM/version listing, explosion/costing, production-order release, requirements, shortages, cost summaries, material issue, and return. Permissions distinguish viewing, BOM management, order creation/release, and material issue.

Milestone 14C completes WIP accounting. Labour, overhead, and subcontract allocations post debit WIP and credit the caller-supplied, active organisation clearing account. Costs can be added while production is released, in progress, partly completed, or completed; a completed order remains open for legitimate late allocations until close. No account codes are inferred or hardcoded.

Partial completion uses a deterministic cumulative allocation. For a non-final receipt, cumulative cost transferred is:

`round(total eligible WIP cost × cumulative completed quantity ÷ planned quantity, 2)`

The current receipt receives that cumulative target less all earlier completion transfers. The final receipt receives all eligible WIP not previously transferred, eliminating rounding residue. Eligible cost is net material cost plus labour, overhead, and subcontract cost. Material returns reduce it. Every completion reuses the inventory costing engine, appends a production-completion stock movement and WAC layer, and posts debit Finished Goods / credit WIP.

Current WIP is materials minus material returns, plus labour, overhead, and subcontract cost, minus finished-goods completion transfers, plus prior variance adjustments. Closing requires physical production to be fully completed. Any remaining WIP is posted to the configured production-variance account (debit variance / credit WIP for a positive residual, reversed for a negative residual), recorded in the immutable production-cost audit trail, and verified as zero before the order becomes closed. Closed orders reject further costing and completion activity.

The production-order API exposes `add-labour`, `add-overhead`, `add-subcontract`, `complete`, and `close`. Separate permissions govern production cost allocation, completion, and close.
