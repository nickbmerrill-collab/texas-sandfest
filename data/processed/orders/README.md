# Order Event Store

The local admin API writes checkout attempts and Stripe webhook events here while the backend is still file-backed.

- `pending/`: validated checkout attempts, not-configured responses, Stripe session creation attempts, and failed session creation records.
- `payment-events/`: received Stripe webhook payloads, signature status, and fulfillment queue state.
- `fulfillment/`: line-item fulfillment records for QR/wristband, VIP will-call, raffle review, sponsor follow-up, and manual review.

Stripe event records use stable filenames by event ID. Replayed webhook events should update no fulfillment records, and successful checkout events also check existing fulfillment by Checkout Session ID before creating new records.

Move these records into the production database before live ticket sales.
