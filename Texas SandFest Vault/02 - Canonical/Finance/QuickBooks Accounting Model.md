---
type: finance_model
status: draft
source: quickbooks_mapping
---

# QuickBooks Accounting Model

QuickBooks Online is the accounting source of truth. SandFest owns operating status and fulfillment.

## Accounting Objects

- Customer: sponsor/customer match.
- Vendor: vendor/payee match.
- Invoice: sponsor package billing.
- Payment: sponsor payment state.
- Bill/Purchase: vendor or event expense tracking.
- SalesReceipt: raffle, merchandise, or other direct sale reconciliation.
- JournalEntry/Account/Class: reviewed reporting categories.

## SandFest Mirrors

- Sponsor invoice status.
- Sponsor payment status.
- Vendor financial status.
- Raffle/merch reconciliation status.
- Donation/scholarship reporting totals after finance review.

## Source Attachments

- `99 - Attachments/quickbooks-mapping.json`
- [[QuickBooks Integration]]
