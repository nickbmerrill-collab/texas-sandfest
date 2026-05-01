# Ingestion Control

Use this area to track incoming internal files before promoting anything into canonical records.

| Lane | Drop Folder | Expected Files |
| --- | --- | --- |
| [[Eventeny Intake]] | `data/incoming/eventeny` | ticket exports, vendor applications, sponsor applications, volunteer applications |
| [[Documents Intake]] | `data/incoming/docs` | PDFs, spreadsheets, packets, contracts, maps, board docs, runbooks |
| [[Ops Intake]] | `data/incoming/ops` | staffing, radio plan, site map, incident log, weather plan, city coordination |
| [[Finance Intake]] | `data/incoming/finance` | sponsor invoices, donation distributions, raffle data, permit costs, vendor fees |
| [[QuickBooks Intake]] | `data/incoming/quickbooks` | OAuth callback captures, company info snapshots, invoice/payment exports, chart of accounts reports |
| [[Comms Intake]] | `data/incoming/comms` | email templates, SMS copy, press copy, FAQ drafts, social calendar |

## Intake Checklist

- Identify source owner.
- Identify date range and event year.
- Mark sensitivity: public, internal, financial, contract, personal, operational.
- Extract entities.
- Link source note.
- Promote stable facts into `02 - Canonical`.
- Keep raw source unchanged.
