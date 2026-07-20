export const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";

export function stripeHostedCheckoutUrl(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 2_000) return null;
  try {
    const url = new URL(candidate);
    if (url.origin !== STRIPE_CHECKOUT_ORIGIN || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
