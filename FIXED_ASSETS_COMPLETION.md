# Fixed Assets and Depreciation Completion

Ledgify now has an organisation-scoped backend fixed-asset register with configurable categories, account mappings, useful lives, straight-line and reducing-balance accounting depreciation, immutable posted schedules, activation, disposal, and reporting APIs.

Activation posts Dr Fixed Asset / Cr the explicitly selected bank, payable, or clearing account. Depreciation posts Dr Depreciation Expense / Cr Accumulated Depreciation and is unique per asset and posting period. Disposal derecognises cost and accumulated depreciation, records proceeds, and posts the calculated gain or loss. Every journal uses existing creation/posting services and therefore respects organisation accounts, balanced entries, audit source identifiers, and period locks.

Reports cover the fixed-asset register, schedules, asset journals/movements, and disposals. The active frontend register, category/asset creation, activation, details, and depreciation routes use the shared backend API and existing Ledgify styling.

Permissions are `VIEW_FIXED_ASSETS`, `MANAGE_FIXED_ASSETS`, and `RUN_DEPRECIATION`. Tax depreciation, VAT, component accounting, revaluation, impairment, construction-in-progress, and automated purchase/bill capitalisation are outside Milestone 9.

Reducing balance uses a deterministic double-declining monthly rate of `2 / useful_life_months`, capped so net book value never falls below residual value. Straight line uses `(cost - residual value) / useful_life_months`.
