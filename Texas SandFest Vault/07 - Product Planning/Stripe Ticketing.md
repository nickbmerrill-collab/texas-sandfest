# Stripe Ticketing and Apple Pay

This scaffold makes SandFest ready for Stripe checkout without enabling live charges in the static prototype.

## Current Boundary

- Product catalog: `data/processed/ticket-products.json`
- Public copy: `public/data/ticket-products.json`
- Static UI: `src/main.js`
- Environment placeholders: `.env.example`
- Future backend endpoint: `POST /api/stripe/create-checkout-session`
- Future webhook endpoint: `POST /api/stripe/webhook`
- Admin config API: `https://sandfest-api.heyelab.com/api/admin/config`

The browser must never decide charge amounts. The frontend can submit product IDs and quantities, but the server must load trusted products, enforce limits, create the Checkout Session, and return Stripe's hosted URL.

Ticket prices, Stripe Price IDs, VIP limits, and sponsor package settings should be configured through the Heyelab-hosted admin backend, then served back to the public website and iOS app through public-safe API endpoints.

## Products

| Product | Status | Notes |
| --- | --- | --- |
| General Admission 3-Day Wristband | Stripe price required | Public scrape confirms terms but not current price. |
| VIP Friday/Saturday/Sunday | Stripe price required | Limited quantity, 1-day VIP hospitality access, no VIP parking pass. |
| VIP / Sponsor Package | Review-gated | Route to sponsor CRM, QuickBooks invoice, or Stripe Payment Link after approval. |
| Golf Cart Raffle | Review-gated | Public scrape lists $50, 650-ticket cap, eligibility, and drawing rules. Do not activate until compliance review approves the checkout flow and receipt text. |

## Checkout Session Flow

1. Customer builds a cart in the public app.
2. Frontend posts only product IDs and quantities to `/api/stripe/create-checkout-session`.
3. Server validates all products against `ticket-products.json` or the production database.
4. Server rejects review-gated products unless the admin approval path has created a one-off checkout.
5. Server rejects products with placeholder Stripe Price IDs or inactive sale status.
6. If Stripe is not configured, server stores a validated pending order and returns `stripe_not_configured`.
7. When Stripe is configured, server creates a Stripe Checkout Session with trusted `price` IDs and `quantity` values.
8. Customer pays through Stripe Checkout. Apple Pay appears for eligible devices/browsers after Stripe and Apple Pay setup is complete.
9. Stripe redirects to the success URL with `{CHECKOUT_SESSION_ID}`.
10. Webhook fulfillment creates QR/wristband records, will-call records, receipts, and finance events.
11. Replayed webhook events are acknowledged without creating duplicate fulfillment records.

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

Fulfillment must be idempotent by Stripe event ID and Checkout Session ID. A webhook may arrive more than once, and the success redirect is not enough to fulfill an order.

The local prototype now stores payment events under stable Stripe event filenames. If the same event ID arrives again, the API returns `duplicate: true` and does not queue fulfillment. If a different successful event arrives for a Checkout Session that already has fulfillment records, the event is recorded with `fulfillmentStatus: "already_queued"` and reuses the existing fulfillment IDs.

Store:

- Stripe Checkout Session ID
- Stripe PaymentIntent ID
- buyer email and phone
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
- Verify webhook signatures using the raw request body.
- Replay the same sandbox webhook twice and confirm no additional fulfillment records are created.
- Test with Stripe CLI and sandbox cards before live keys.
- Verify Apple Pay on Safari/iPhone and in the native app if native checkout is enabled.
- Run a finance reconciliation dry run into QuickBooks sandbox.
