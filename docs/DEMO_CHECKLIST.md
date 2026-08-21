# Ledgify Client Demo Checklist

## Preparation

1. Backend: `cd accounting-backend && source venv/bin/activate && python manage.py runserver`
2. Frontend (from the Ledgify repository root): `npm run dev`
3. Seed or refresh the idempotent dataset:
   - Existing user: `python manage.py seed_demo_data --email YOUR_EMAIL`
   - New user: set `LEDGIFY_DEMO_EMAIL` and `LEDGIFY_DEMO_PASSWORD`, then run `python manage.py seed_demo_data`
4. Frontend API setting, when not using the default: `VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1`

The repository currently hosts the frontend at its root rather than in a separate `accounting-frontend` directory. Never put a production password in source control. The seed command has no reset/delete mode and never removes unrelated organisations.

## Presentation order

| Step | Demonstration | Expected result | Backup route |
|---|---|---|---|
| 1 | Start backend | Django reports no startup errors | Run `python manage.py check` and restart |
| 2 | Start frontend | Vite displays the local URL | Use `npm run build` to confirm bundle health |
| 3 | Login | User is authenticated without console/API errors | Refresh and sign in again |
| 4 | Select organisation | Select **Ledgify Demo Ltd** | Use the header organisation switcher |
| 5 | Dashboard | Live cash, AR, AP, profit, aging, and recent activity appear | Open Reports to show the same ledger data |
| 6 | Customers | Four demo customers appear | Use Bluewave Consulting Ltd |
| 7 | Create invoice | Zero-tax invoice saves for an active customer | Open an existing demo invoice |
| 8 | Approve invoice | Status becomes Approved and journal is created | Open `DEMO-INV-003` |
| 9 | Record payment | Amount due falls and status becomes Partly paid/Paid | Open `DEMO-INV-002` for partial-payment state |
| 10 | Show journal | Posted invoice/payment entries are visible | Use Journal list and source references |
| 11 | Trial Balance | Debit equals credit and no warning appears | Use the seeded as-of date |
| 12 | Profit & Loss | Service revenue and operating expenses appear | Return to dashboard Net Profit |
| 13 | Balance Sheet | Assets equal liabilities plus equity | Use Trial Balance if navigation is interrupted |
| 14 | Aged Receivables | Current and overdue demo balances appear | Show customer statement |
| 15 | Suppliers | Five demo suppliers appear | Use Microsoft or Amazon Business |
| 16 | Bill workflow | Create/approve/pay a zero-tax bill | Open `DEMO-BILL-002` for partial-payment state |
| 17 | Banking | Business Current Account and transactions appear | Return to Bank Accounts |
| 18 | Reconciliation | Suggestions/manual coding are available; accepted items refresh | Use the £89 money-out item for manual coding |
| 19 | Products | Four goods and one service appear | Open Business Laptop |
| 20 | Stock Adjustment | Valid adjustment posts with success feedback | Use existing `DEMO-STOCK-*` movements |
| 21 | Inventory | Quantity, movement history, and WAC valuation agree | Open product stock summary |
| 22 | Return Dashboard | Updated live values and recent activity appear | Refresh the page once |

## Safety notes

- Do not close the active demo financial period or run year-end close.
- Do not repeatedly reconcile the same bank transaction. Use the safe Unreconcile action first.
- Use zero tax for invoices and bills.
- An excessive stock-out should be rejected; this is expected validation, not a demo failure.
- Run `python manage.py seed_demo_data --email YOUR_EMAIL` immediately before the presentation to restore any missing seeded records without duplicating existing ones.

