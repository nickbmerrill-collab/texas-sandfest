# Stripe Ticketing and Apple Pay

SandFest ticket checkout is implemented end to end, but live sales remain configuration-gated. The static visitor artifact always fails closed; only a ready API with approved products and a complete Stripe configuration can mark products available for checkout.

## Current Boundary

- Private product catalog: `data/processed/ticket-products.json`
- Provider-private static catalog: `public/data/ticket-products.json`
- Static UI: `src/main.js`
- Environment contract: `.env.example`
- Public catalog: `GET /api/public/tickets`
- Checkout endpoint: `POST /api/stripe/create-checkout-session`
- Webhook endpoint: `POST /api/stripe/webhook`
- Admin config API: `https://api.heyelab.com/sandfest/api/admin/config`

The browser never decides charge amounts and never receives Stripe Price IDs. It submits product IDs and quantities with a stable `Idempotency-Key`; the server loads trusted products, enforces limits, persists the order, reuses the original Checkout Session on retry, and returns an exact `https://checkout.stripe.com` URL.

Ticket prices, Stripe Price IDs, VIP limits, and sale status are configured through the Heyelab-hosted admin backend. A product becomes publicly purchasable only when it is active, does not require review, has a positive server amount, has a non-placeholder Stripe Price ID, and the ticketing integration is ready. The static catalog never advertises an open sale.

## Products

| Product | Status | Notes |
| --- | --- | --- |
| General Admission 3-Day Wristband | Stripe price required | Public scrape confirms terms but not current price. |
| VIP Friday/Saturday/Sunday | Stripe price required | Limited quantity, 1-day VIP hospitality access, no VIP parking pass. |
| VIP / Sponsor Package | Review-gated | Route to sponsor CRM, QuickBooks invoice, or Stripe Payment Link after approval. |
| Golf Cart Raffle | Review-gated | Public scrape lists $50, 650-ticket cap, eligibility, and drawing rules. Do not activate until compliance review approves the checkout flow and receipt text. |

## Checkout Session Flow

1. Customer builds a cart in the public app.
2. Frontend posts only product IDs and quantities to `/api/stripe/create-checkout-session` with a retry-stable `Idempotency-Key`.
3. Server validates all products against `ticket-products.json` or the production database.
4. Server rejects review-gated products unless the admin approval path has created a one-off checkout.
5. Server rejects products with placeholder Stripe Price IDs or inactive sale status.
6. If Stripe is not configured, server stores a validated pending order and returns `stripe_not_configured`.
7. When Stripe is configured, the server creates a Stripe Checkout Session with trusted `price` IDs and `quantity` values. Reusing the key with the same cart returns the original session; reusing it with a changed cart is rejected.
8. Customer pays through Stripe Checkout. Apple Pay appears for eligible devices/browsers after Stripe and Apple Pay setup is complete.
9. Stripe redirects to the success URL with `{CHECKOUT_SESSION_ID}`.
10. A fresh, signed Stripe webhook locates the stored order by order, Checkout Session, or PaymentIntent identity and verifies event year, amount, currency, payment status, and provider references.
11. Fulfillment is derived from the stored order, never Stripe metadata. Deterministic QR/wristband or will-call records are created only after reconciliation succeeds.
12. Replayed webhook events are acknowledged without creating duplicate fulfillment records. Failed asynchronous payments and mismatches move to review instead of fulfilling.
13. Full refunds close the order and every fulfillment record. Partial refunds retain the cumulative amount and move fulfillment to review.

Enable ticket sales only after sandbox acceptance:

```bash
STRIPE_TICKETING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=https://www.texassandfest.org/tickets/success?session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://www.texassandfest.org/#tickets
```

## Partner Invoice Checkout

Vendor and sponsor charges use a separate, review-gated path from ticket sales:

1. Staff approves the application amount, creates an invoice, and approves that invoice.
2. The partner opens the rotatable private portal and requests checkout for that invoice ID.
3. The API reserves one active checkout for the current server-computed balance and reuses it on retries.
4. `lib/stripe-partner-payments.mjs` creates a one-line Stripe Checkout Session with inline `price_data`; the browser never submits or controls the amount.
5. `checkout.session.completed` or `checkout.session.async_payment_succeeded` must carry a valid, fresh Stripe signature and matching checkout, application, invoice, amount, currency, and paid status.
6. A valid event records one Stripe payment in the partner ledger, updates the invoice balance, and marks the checkout complete. It does not create ticket fulfillment.
7. Replayed event IDs and repeated PaymentIntent IDs are idempotent.
8. `charge.refunded` uses Stripe's cumulative refunded amount to restore the receivable for partial or full refunds.

Enable the flow only after sandbox validation:

```bash
STRIPE_PARTNER_PAYMENTS_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PARTNER_SUCCESS_URL=https://www.texassandfest.org/#partner-payment-success?session_id={CHECKOUT_SESSION_ID}
STRIPE_PARTNER_CANCEL_URL=https://www.texassandfest.org/#partner-status
```

Production readiness requires the official `https://api.stripe.com` API origin, HTTPS redirect URLs, and a webhook timestamp within `STRIPE_WEBHOOK_TOLERANCE_SECONDS` (300 seconds by default).

Local records are written to:

- `data/processed/orders/pending/`
- `data/processed/orders/payment-events/`
- `data/processed/orders/fulfillment/`

## Apple Pay Setup

Web checkout:

- Use Stripe Checkout or Payment Element.
- Confirm Apple Pay is enabled in Stripe payment method settings.
- Register/verify the production web domain for Apple Pay if the chosen Stripe flow requires it.
- Serve the Apple Pay verification file from the production domain if required.

iOS app:

- Add Stripe iOS SDK support when payments move into native checkout.
- Create Apple Merchant ID `merchant.org.texassandfest` or the final approved identifier.
- Add Apple Pay capability in Xcode.
- Create PaymentIntents on the server. Do not create trusted amounts in Swift.

## Webhooks and Fulfillment

Required events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `payment_intent.payment_failed`
- `charge.refunded`

Fulfillment is idempotent by Stripe event ID, Checkout Session ID, stored order ID, and deterministic fulfillment ID. A webhook may arrive more than once, and the success redirect is never enough to fulfill an order.

Payment evidence stores a privacy-minimized object summary and reconciliation result, not the raw Stripe event or customer details. If the same event ID arrives again, the API returns `duplicate: true` and does not create more fulfillment. A different valid success event for an already fulfilled session reuses the existing fulfillment IDs.

Store:

- Stripe Checkout Session ID
- Stripe PaymentIntent ID
- buyer email and phone on the private order only
- line items and quantities
- QR/wristband fulfillment status
- refund status
- QuickBooks sync status

Fulfillment statuses:

- `queued`
- `needs_review`
- `ready`
- `issued`
- `checked_in`
- `refunded`
- `voided`

## QuickBooks Reconciliation

Stripe should own card/wallet payment capture. QuickBooks should receive reviewed sales receipts, deposits, fees, sponsor invoices, and revenue categories after finance approves the mapping.

Recommended categories:

- General admission revenue
- VIP wristband revenue
- Sponsor revenue
- Raffle revenue
- Merchandise revenue
- Stripe fees
- Refunds and chargebacks

## Go-Live Checklist

- Confirm final ticket prices and Stripe Price IDs.
- Confirm whether Eventeny remains the ticketing system or Stripe becomes primary.
- Complete raffle compliance review before online raffle checkout.
- Approve ticket terms: filming notice, service animals policy, resale policy, refund policy, and will-call rules.
- Configure Stripe webhook endpoint with HTTPS.
- Confirm `GET /api/public/tickets` contains no `stripePriceId`, secret, placeholder Price ID, or unavailable product marked purchasable.
- Confirm the static production artifact reports every ticket unavailable until it reaches the ready API.
- Verify webhook signatures using the raw request body.
- Submit one checkout twice with the same key and confirm both responses return the same Checkout Session and only one provider session exists.
- Reuse that key with a changed cart and confirm the API rejects it.
- Replay the same sandbox webhook twice and confirm no additional fulfillment records are created.
- Send amount, currency, event-year, order, and Checkout Session mismatches and confirm no fulfillment is created.
- Exercise paid, asynchronous failure, full refund, and partial refund events against Postgres and verify order plus fulfillment states.
- Test with Stripe CLI and sandbox cards before live keys.
- Verify Apple Pay on Safari/iPhone and in the native app if native checkout is enabled.
- Run a finance reconciliation dry run into QuickBooks sandbox.
