# Texas SandFest Vault

This vault is the working knowledge base for the Texas SandFest AI platform, iOS app, operations console, and future Port A Local Co integration.

## Current Baseline

- [[Public Ingestion Report]]
- [[Crawl Summary]]
- [[Texas SandFest 2026]]
- [[Process Improvement Notes]]
- [[Architecture]]
- [[iOS App Plan]]
- [[Port A Local Co Integration]]

## Incoming Data Pipeline

Drop new files into:

- `/Users/nick/Projects/Teaxs Sandfest/data/incoming/eventeny` for Eventeny exports.
- `/Users/nick/Projects/Teaxs Sandfest/data/incoming/docs` for PDFs, packets, spreadsheets, contracts, maps, and board docs.
- `/Users/nick/Projects/Teaxs Sandfest/data/incoming/ops` for staffing plans, radio plans, site maps, incident logs, weather plans, and city coordination.
- `/Users/nick/Projects/Teaxs Sandfest/data/incoming/finance` for sponsor invoices, donations, raffle exports, costs, and vendor fees.
- `/Users/nick/Projects/Teaxs Sandfest/data/incoming/comms` for email templates, SMS copy, press drafts, FAQ drafts, and social calendars.

Then run:

```bash
npm run vault:build
```

## Review Rule

Public scrape data is evidence, not truth. Promote facts into `02 - Canonical` only after assigning an owner, source, effective date, and review status.
