import { createHash } from "node:crypto";
import { REQUIRED_TICKET_POLICY_NOTICES } from "./ticket-policy-schema.mjs";

export { REQUIRED_TICKET_POLICY_NOTICES } from "./ticket-policy-schema.mjs";

const REQUIRED_NOTICE_IDS = new Set(REQUIRED_TICKET_POLICY_NOTICES.map(item => item.id));

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNotice(notice = {}) {
  return {
    id: cleanText(notice.id).toLowerCase(),
    label: cleanText(notice.label),
    summary: cleanText(notice.summary)
  };
}

export function normalizeTicketCheckoutPolicy(policyInput = {}) {
  const policy = policyInput && typeof policyInput === "object" ? policyInput : {};
  return {
    eventId: cleanText(policy.eventId),
    version: cleanText(policy.version),
    status: cleanText(policy.status).toLowerCase() || "draft",
    acknowledgment: cleanText(policy.acknowledgment),
    notices: (Array.isArray(policy.notices) ? policy.notices : []).map(normalizeNotice),
    approvedAt: cleanText(policy.approvedAt) || null,
    approvedBy: cleanText(policy.approvedBy) || null,
    updatedAt: cleanText(policy.updatedAt) || null
  };
}

export function ticketCheckoutPolicyDigest(policyInput = {}) {
  const policy = normalizeTicketCheckoutPolicy(policyInput);
  const canonical = {
    eventId: policy.eventId,
    version: policy.version,
    acknowledgment: policy.acknowledgment,
    notices: [...policy.notices]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, label, summary }) => ({ id, label, summary }))
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function ticketCheckoutPolicyReadiness(catalogInput = {}, options = {}) {
  const policy = normalizeTicketCheckoutPolicy(catalogInput?.checkoutPolicy);
  const errors = [];
  const expectedEventId = cleanText(options.eventId);
  const now = new Date(options.now || Date.now());
  const approvedAt = policy.approvedAt ? new Date(policy.approvedAt) : null;
  const noticeIds = new Set();

  if (policy.status !== "approved") errors.push("Ticket checkout policy requires approval.");
  if (!policy.eventId) errors.push("Ticket checkout policy requires an event ID.");
  if (expectedEventId && policy.eventId !== expectedEventId) errors.push(`Ticket checkout policy must match ${expectedEventId}.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(policy.version)) errors.push("Ticket checkout policy requires a version of 3 to 80 safe characters.");
  if (policy.acknowledgment.length < 20 || policy.acknowledgment.length > 500) errors.push("Ticket checkout policy requires a 20 to 500 character acknowledgment.");
  if (!approvedAt || !Number.isFinite(approvedAt.getTime())) errors.push("Ticket checkout policy requires an approval timestamp.");
  if (approvedAt && Number.isFinite(approvedAt.getTime()) && approvedAt.getTime() > now.getTime() + 5 * 60_000) errors.push("Ticket checkout policy approval cannot be in the future.");
  if (!policy.approvedBy) errors.push("Ticket checkout policy requires an approving actor.");
  if (policy.notices.length > 12) errors.push("Ticket checkout policy cannot contain more than 12 notices.");

  for (const notice of policy.notices) {
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(notice.id)) errors.push("Ticket policy notice IDs must be 2 to 64 safe characters.");
    if (noticeIds.has(notice.id)) errors.push(`Ticket policy notice is duplicated: ${notice.id}.`);
    noticeIds.add(notice.id);
    if (notice.label.length < 3 || notice.label.length > 120) errors.push(`Ticket policy notice ${notice.id || "unknown"} requires a 3 to 120 character label.`);
    if (notice.summary.length < 20 || notice.summary.length > 2_000) errors.push(`Ticket policy notice ${notice.id || "unknown"} requires a 20 to 2,000 character summary.`);
  }
  for (const required of REQUIRED_NOTICE_IDS) {
    if (!noticeIds.has(required)) errors.push(`Ticket checkout policy is missing ${required}.`);
  }

  return {
    ready: errors.length === 0,
    errors,
    policy,
    digest: ticketCheckoutPolicyDigest(policy)
  };
}

export function validateTicketPolicyAcceptance(catalogInput = {}, acceptanceInput = {}, options = {}) {
  const readiness = ticketCheckoutPolicyReadiness(catalogInput, options);
  if (!readiness.ready) return { ok: false, code: "policy_not_ready", error: readiness.errors.join(" "), readiness };
  const acceptance = acceptanceInput && typeof acceptanceInput === "object" ? acceptanceInput : {};
  if (acceptance.accepted !== true) return { ok: false, code: "policy_acceptance_required", error: "Accept the current ticket policies before checkout.", readiness };
  if (cleanText(acceptance.version) !== readiness.policy.version || cleanText(acceptance.digest) !== readiness.digest) {
    return { ok: false, code: "policy_version_changed", error: "Ticket policies changed. Review and accept the current version before checkout.", readiness };
  }
  return {
    ok: true,
    evidence: {
      version: readiness.policy.version,
      digest: readiness.digest,
      noticeIds: readiness.policy.notices.map(item => item.id)
    },
    readiness
  };
}

function publicProduct(product, { checkoutEnabled }) {
  return {
    id: String(product?.id || ""),
    name: String(product?.name || ""),
    category: String(product?.category || "ticket"),
    priceLabel: String(product?.priceLabel || ""),
    unitAmount: Number.isInteger(product?.unitAmount) ? product.unitAmount : null,
    quantity: {
      min: Number.isInteger(product?.quantity?.min) ? product.quantity.min : 1,
      max: Number.isInteger(product?.quantity?.max) ? product.quantity.max : 12
    },
    checkoutMode: String(product?.checkoutMode || "payment"),
    requiresReview: product?.requiresReview === true,
    fulfillment: String(product?.fulfillment || "manual_review"),
    description: String(product?.description || ""),
    terms: Array.isArray(product?.terms) ? product.terms.map(item => String(item)).filter(Boolean).slice(0, 20) : [],
    availableForCheckout: checkoutEnabled === true
      && product?.active !== false
      && product?.requiresReview !== true
      && /^price_[A-Za-z0-9_]+$/.test(product?.stripePriceId || "")
      && !String(product?.stripePriceId || "").startsWith("price_replace")
      && Number.isInteger(product?.unitAmount)
      && product.unitAmount > 0
  };
}

export function publicTicketCatalog(catalogInput, options = {}) {
  const catalog = catalogInput && typeof catalogInput === "object" ? catalogInput : {};
  const policy = ticketCheckoutPolicyReadiness(catalog, { eventId: options.eventId });
  const checkoutEnvironment = options.checkoutEnvironment === "board_sandbox"
    ? "board_sandbox"
    : options.checkoutEnabled === true ? "stripe" : "disabled";
  const checkoutEnabled = options.checkoutEnabled === true && policy.ready;
  return {
    lastUpdated: catalog.lastUpdated || null,
    currency: String(catalog.currency || "usd").toLowerCase(),
    provider: "stripe",
    checkoutEnvironment,
    checkoutEndpoint: "/api/stripe/create-checkout-session",
    checkoutPolicy: policy.ready
      ? {
          ready: true,
          demonstration: checkoutEnvironment === "board_sandbox",
          version: policy.policy.version,
          digest: policy.digest,
          acknowledgment: policy.policy.acknowledgment,
          notices: policy.policy.notices.map(({ id, label, summary }) => ({ id, label, summary }))
        }
      : {
          ready: false,
          demonstration: false,
          version: null,
          digest: null,
          acknowledgment: "",
          notices: []
        },
    applePay: catalog.applePay && typeof catalog.applePay === "object"
      ? {
          status: String(catalog.applePay.status || "not_configured"),
          webDomain: String(catalog.applePay.webDomain || "")
        }
      : { status: "not_configured", webDomain: "" },
    products: (Array.isArray(catalog.products) ? catalog.products : [])
      .filter(product => product?.active !== false)
      .map(product => publicProduct(product, { ...options, checkoutEnabled }))
      .filter(product => product.id && product.name)
  };
}
