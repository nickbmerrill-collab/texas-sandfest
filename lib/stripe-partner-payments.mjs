const STRIPE_API_ORIGIN = "https://api.stripe.com";

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeHttpUrl(value, { httpsOnly = false } = {}) {
  const candidate = clean(value);
  try {
    const url = new URL(candidate);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
    if (httpsOnly && url.protocol !== "https:") return "";
    return candidate;
  } catch {
    return "";
  }
}

export function stripePartnerPaymentsConfig(env = process.env) {
  const enabled = env.STRIPE_PARTNER_PAYMENTS_ENABLED === "true";
  const production = env.SANDFEST_ENV === "production";
  const secretKey = clean(env.STRIPE_SECRET_KEY, 500);
  const webhookSecret = clean(env.STRIPE_WEBHOOK_SECRET, 500);
  const successUrl = safeHttpUrl(
    env.STRIPE_PARTNER_SUCCESS_URL || "http://127.0.0.1:5173/#partner-payment-success?session_id={CHECKOUT_SESSION_ID}",
    { httpsOnly: production }
  );
  const cancelUrl = safeHttpUrl(
    env.STRIPE_PARTNER_CANCEL_URL || "http://127.0.0.1:5173/#partner-status",
    { httpsOnly: production }
  );
  const apiBaseUrl = safeHttpUrl(env.STRIPE_API_BASE_URL || STRIPE_API_ORIGIN, { httpsOnly: production }).replace(/\/$/, "");
  const missing = [];
  if (enabled && !secretKey.startsWith("sk_")) missing.push("STRIPE_SECRET_KEY");
  if (enabled && !webhookSecret.startsWith("whsec_")) missing.push("STRIPE_WEBHOOK_SECRET");
  if (enabled && !successUrl) missing.push("STRIPE_PARTNER_SUCCESS_URL");
  if (enabled && !cancelUrl) missing.push("STRIPE_PARTNER_CANCEL_URL");
  if (enabled && !apiBaseUrl) missing.push("STRIPE_API_BASE_URL");
  if (enabled && production && apiBaseUrl !== STRIPE_API_ORIGIN) missing.push("STRIPE_API_BASE_URL(official Stripe origin)");
  return {
    enabled,
    ready: enabled && missing.length === 0,
    production,
    secretKey,
    webhookSecret,
    successUrl,
    cancelUrl,
    apiBaseUrl,
    missing,
    reason: !enabled
      ? "Partner online payments are disabled."
      : missing.length
        ? `Missing or invalid ${missing.join(", ")}`
        : null
  };
}

export function publicStripePartnerPaymentsReadiness(config = stripePartnerPaymentsConfig()) {
  return {
    enabled: config.enabled,
    ready: config.ready,
    provider: "stripe"
  };
}

export function buildStripePartnerCheckoutRequest({ checkout, invoice, application, config }) {
  if (!config?.ready) throw new Error(config?.reason || "Partner online payments are not ready.");
  if (!checkout?.id || !invoice?.id || !application?.id) throw new Error("Partner checkout context is incomplete.");
  const amountCents = Number(checkout.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 1) throw new Error("Partner checkout amount must be a positive integer.");
  const expiresAt = Math.floor(new Date(checkout.expiresAt).getTime() / 1000);
  if (!Number.isFinite(expiresAt)) throw new Error("Partner checkout expiration is invalid.");
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("submit_type", "pay");
  body.set("success_url", config.successUrl);
  body.set("cancel_url", config.cancelUrl);
  body.set("client_reference_id", checkout.id);
  body.set("customer_email", clean(application.contactEmail, 320));
  body.set("expires_at", String(expiresAt));
  body.set("metadata[sandfest_flow]", "partner_invoice");
  body.set("metadata[event_id]", clean(application.eventId || DEFAULT_EVENT_ID, 120));
  body.set("metadata[partner_checkout_id]", checkout.id);
  body.set("metadata[partner_application_id]", application.id);
  body.set("metadata[partner_invoice_id]", invoice.id);
  body.set("payment_intent_data[metadata][sandfest_flow]", "partner_invoice");
  body.set("payment_intent_data[metadata][partner_checkout_id]", checkout.id);
  body.set("payment_intent_data[metadata][partner_application_id]", application.id);
  body.set("payment_intent_data[metadata][partner_invoice_id]", invoice.id);
  body.set("payment_intent_data[description]", clean(invoice.description, 500));
  body.set("line_items[0][price_data][currency]", clean(checkout.currency || "usd", 10).toLowerCase());
  body.set("line_items[0][price_data][unit_amount]", String(amountCents));
  body.set("line_items[0][price_data][product_data][name]", clean(`Texas SandFest ${application.type} invoice`, 120));
  body.set("line_items[0][price_data][product_data][description]", clean(`${application.organizationName} - ${invoice.description}`, 500));
  body.set("line_items[0][quantity]", "1");
  return body;
}

export async function createStripePartnerCheckoutSession(context, options = {}) {
  const config = options.config ?? stripePartnerPaymentsConfig(options.env);
  const body = buildStripePartnerCheckoutRequest({ ...context, config });
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.apiBaseUrl}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `sandfest-partner-${context.checkout.id}`
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Stripe partner Checkout Session creation failed.");
  if (!data.id || !data.url) throw new Error("Stripe returned an incomplete partner Checkout Session.");
  return data;
}

export function stripePartnerEventContext(event) {
  const object = event?.data?.object ?? {};
  const metadata = object.metadata ?? {};
  if (metadata.sandfest_flow !== "partner_invoice" && event?.type !== "charge.refunded") return null;
  return {
    checkoutId: clean(metadata.partner_checkout_id, 160),
    applicationId: clean(metadata.partner_application_id, 160),
    invoiceId: clean(metadata.partner_invoice_id, 160),
    providerSessionId: event.type?.startsWith("checkout.session") ? clean(object.id, 160) : "",
    paymentIntentId: clean(object.payment_intent || object.id, 160),
    providerEventId: clean(event.id, 160),
    amountCents: Number(object.amount_total ?? object.amount_received ?? object.amount ?? 0),
    refundedAmountCents: Number(object.amount_refunded ?? 0),
    currency: clean(object.currency, 10).toLowerCase(),
    paymentStatus: clean(object.payment_status, 40).toLowerCase(),
    failureMessage: clean(object.last_payment_error?.message || object.failure_message, 500)
  };
}
import { DEFAULT_EVENT_ID } from "./event-context.mjs";
