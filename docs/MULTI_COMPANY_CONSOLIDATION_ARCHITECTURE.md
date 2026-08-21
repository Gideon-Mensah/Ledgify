# Multi-company consolidation

Consolidation groups are owned by a parent organisation but never grant membership or ledger access to subsidiaries. Dedicated parent-organisation permissions protect all group data. Member journals remain independent and immutable.

The group chart and effective-dated mappings translate posted member account balances into versioned snapshots. Foreign subsidiaries use immutable FX rates; income and expense are marked average-policy and balance-sheet accounts closing-policy. Historical equity and CTA require explicit group configuration and are never guessed.

Eliminations are separate consolidation-only journals. They do not create organisation journals. Reports combine the latest member snapshot version with posted eliminations to produce trial balance, profit and loss, balance sheet, and a cash-flow foundation based on mapped categories.

Preparation fails on material unmapped balances. Finalisation requires a balanced consolidated trial balance and preserves snapshots/history. Re-preparation appends a new snapshot version rather than deleting prior evidence.

FULL consolidation is currently production-limited to 100%-owned members. Proportionate consolidation, equity accounting, acquisition accounting, and non-controlling interests are intentionally blocked pending a complete accounting implementation. Automated elimination suggestions, CTA auto-balancing, reversal UI, and advanced intercompany matching remain further enhancements.
