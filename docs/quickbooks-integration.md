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

- Whether sponsor invoices are created in SandFest or manually in QuickBooks and mirrored back.
- Whether Eventeny sponsor payment state should reconcile against QuickBooks invoices.
- Whether each sponsor tier maps to QuickBooks Items, Classes, or both.
- How nonprofit/scholarship donation categories should map to accounts/classes.
