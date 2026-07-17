# QuickBooks Online Integration

## Purpose

QuickBooks should be the accounting ledger for Texas SandFest. The SandFest platform should own operational workflows and mirror only the accounting state needed to manage sponsors, vendors, raffle/merchandise reconciliation, donations, and post-event reporting.

## Integration Boundary

QuickBooks owns:

- Customers.
- Vendors.
- Invoices.
- Bills.
- Payments.
- Sales receipts.
- Chart of accounts.
- Accounting reports and ledger truth.

SandFest owns:

- Sponsor lifecycle.
- Sponsor benefit delivery.
- Vendor approval/load-in/inspection.
- Volunteer operations.
- Eventeny application/ticket context.
- Incident/ops data.
- AI-visible canonical answers.
- Port A Local Co public event/destination data.

## OAuth Requirements

Use Intuit OAuth 2.0 with the accounting scope:

- `com.intuit.quickbooks.accounting`

Required app values:

- `QB_CLIENT_ID`
- `QB_CLIENT_SECRET`
- `QB_REDIRECT_URI`
- `QB_REALM_ID`
- `QB_REFRESH_TOKEN`
- `QB_INVOICE_SYNC_ENABLED=true` after sandbox verification
- A `quickBooksItemId` on each sponsor tier and vendor offering. `QB_SPONSOR_ITEM_ID` and `QB_VENDOR_ITEM_ID` remain fallback mappings for legacy records without a configured package or offering item.

Access tokens expire after one hour, so backend jobs should refresh from a stored refresh token before calls.

## API Version

Use QuickBooks Online Accounting API minor version `75` by default.

## Local Commands

```bash
npm run qb:status
npm run qb:auth-url
npm run qb:callback
npm run qb:company-info
npm run qb:open-invoices
```

These commands are safe to run without credentials for status checks. Calls that contact QuickBooks require configured environment variables.

## Plug-In Steps When Access Arrives

1. Create an Intuit Developer app for QuickBooks Online.
2. Add the redirect URI from `.env.example`:
   `http://127.0.0.1:8787/api/integrations/quickbooks/callback`
3. Add the sandbox or production `QB_CLIENT_ID` and `QB_CLIENT_SECRET` to a local `.env` or deployment secret store.
4. Set `QB_OAUTH_STATE` to a random value.
5. In one terminal, run `npm run qb:callback`.
6. In another terminal, run `npm run qb:auth-url` and open the URL.
7. Approve access in Intuit.
8. Capture `realmId` and `refresh_token` from the callback output.
9. Store `QB_REALM_ID` and `QB_REFRESH_TOKEN` in the secret store.
10. Run `npm run qb:status`, then `npm run qb:company-info`.

Set `QB_WRITE_TOKEN_FILE=true` only if you want the local callback helper to write a private token JSON file under `data/incoming/quickbooks/`. Do not commit that file.

## First Use Cases

### Sponsor Revenue

- Create or match QuickBooks Customer for sponsor.
- Create invoice for selected sponsor package.
- Mirror invoice/payment status back to SandFest Sponsor CRM.
- Keep benefit fulfillment in SandFest, not QuickBooks.

### Reviewed Invoice Workflow

1. Finance creates a SandFest invoice draft from the approved application amount. The browser cannot supply the accounting amount.
2. A `finance_admin` or `super_admin` approves the immutable invoice snapshot.
3. Queueing is rejected until OAuth, realm, refresh token, the explicit sync gate, and the relevant QuickBooks Item ID are ready.
4. The background worker refreshes an access token, finds or creates the QuickBooks Customer, and creates the Invoice.
5. Customer and invoice writes use deterministic QuickBooks `requestid` values so job retries do not duplicate accounting objects.
6. SandFest stores the QuickBooks customer ID, invoice ID, document number, reported balance, attempts, errors, and sync time. The local payment subledger keeps a separate operational balance and flags any difference from the last QuickBooks balance as a reconciliation exception.
7. Finance can queue a versioned balance refresh from the synced invoice card. The worker reads the current QuickBooks Invoice, records its reported total, balance, provider update timestamp, refresh attempts, and check time, and leaves the SandFest payment ledger unchanged.
8. A refresh pending for more than the worker retry window, a terminal refresh failure, a check older than 24 hours, or a QuickBooks amount/balance difference appears in receivables exceptions for finance action.

Creating the QuickBooks invoice does not email it automatically. Sending, payment terms, and collections remain finance-controlled in QuickBooks until a separate reviewed send policy is approved.

A lower QuickBooks balance indicates accounting activity that SandFest has not yet matched. The read-only refresh never manufactures a check, card, Eventeny, Stripe, or QuickBooks payment in SandFest. Finance must identify the provider transaction and record or import it with its real external reference; the next refresh then proves that the two ledgers agree.

### Receivables and Payment Controls

- Only `finance_admin` and `super_admin` can record or reverse partner payments.
- Payment methods and received dates are validated. A method-specific external reference is idempotent per application, preventing webhook or operator retries from double-posting a transaction.
- Successful payments allocate to the active invoice atomically. Payments received before invoice creation are held as unapplied funds and allocated when finance creates the invoice.
- Overpayments remain visible as unapplied credit. The receivables workspace reports current, 1-30, 31-60, 61-90, 90+, and unbilled balances plus overdue, sync, unapplied-fund, and provider-balance exceptions.
- Marking a payment refunded or void records an action already completed with the bank, card processor, Eventeny, Stripe, or QuickBooks. It does not initiate movement of money at that provider. A reason and audit record are required, and the local invoice/application balance is restored immediately.

### Provider Settlement Imports

- Only `finance_admin` and `super_admin` receive `revenue:write` and may preview or commit settlement CSVs.
- Finance selects Eventeny, Square, Stripe, or manual as the provider. Every accepted row is locked to the configured current event and must include an external reference, ISO date, supported revenue category, and exact gross amount in dollars or cents.
- Preview performs no write. It reports valid rows, invalid rows, existing provider references, gross, fees, net, and a content/provider/event hash. Commit rejects any changed CSV or provider until it is previewed again.
- Receipt, refund, and void signs are normalized, supplied net must equal gross minus fees, and duplicate keys use provider + entry type + external reference across both settlement and site-native partner records.
- Commit uses the atomic file/Postgres document update, materializes historical rows onto their prior event before advancing the ledger context, records a bounded import receipt, and writes `revenue.import.commit` to the admin audit log. Replaying the same hash cannot add another entry or receipt.
- This import records completed provider activity. It does not initiate charges, refunds, payouts, bank deposits, or QuickBooks journal entries.

### Vendor Finance

- Match vendor records to QuickBooks Vendor objects where needed.
- Track bills, purchases, or vendor payments if SandFest owes money.
- Keep application, permits, booth, inspection, and load-in in SandFest.

### Raffle / Merchandise

- Reconcile raffle sales and merchandise sales with QuickBooks sales receipts/payments.
- Avoid storing unnecessary entrant personal data in the operational platform.

### Donation + Scholarship Reporting

- Pull categorized totals for post-event impact.
- Require finance review before publishing nonprofit or scholarship allocation numbers.

## Security Rules

- Do not commit credentials or tokens.
- Store refresh tokens in a secrets manager or encrypted deployment environment.
- Restrict production QuickBooks access to finance/admin roles.
- Log sync metadata, not full sensitive accounting payloads.
- Never expose QuickBooks private records to Port A Local Co.

## Open Decisions

- Whether Eventeny sponsor payment state should reconcile against QuickBooks invoices.
- Whether each sponsor tier should add a QuickBooks Class in addition to its required Item mapping.
- How nonprofit/scholarship donation categories should map to accounts/classes.
