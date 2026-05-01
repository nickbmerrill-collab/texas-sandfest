# Incoming Ingestion

All private or exported files should land in `data/incoming/` first. The scanner builds a review queue before anything is promoted into the app, vault, QuickBooks mapping, or customer-facing content.

## Drop Folders

- `data/incoming/eventeny`: tickets, applications, vendors, sponsors, messages, orders
- `data/incoming/quickbooks`: company info, customers, invoices, payments, vendors, bills, reports
- `data/incoming/finance`: budgets, reconciliations, sponsor finance, raffle, merch, grant totals
- `data/incoming/ops`: runbooks, maps, permits, staffing, emergency plans, load-in docs
- `data/incoming/docs`: PDFs, docs, board packets, policy references
- `data/incoming/comms`: emails, social calendars, press releases, SMS templates

## Command

```bash
npm run incoming:scan
```

## Outputs

- `data/processed/incoming-inventory.json`
- `data/processed/incoming-inventory.md`
- `public/data/incoming-inventory.json` after `npm run public:sync`

## Rule

Do not wire new exports directly into the customer app. Scan first, review source ownership, classify records, then promote into canonical app data.
