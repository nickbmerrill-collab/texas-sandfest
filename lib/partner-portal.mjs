import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "sandfest-local-partner-portal-secret-change-before-production";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function safeBaseUrl(value, production) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return "";
    if (production && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function partnerPortalConfig(env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const configuredSecret = clean(env.SANDFEST_PARTNER_PORTAL_SECRET, 500);
  const secret = configuredSecret || (production ? "" : DEV_SECRET);
  const publicBaseUrl = safeBaseUrl(
    env.SANDFEST_PUBLIC_SITE_URL || (production ? "" : "http://127.0.0.1:5173"),
    production
  );
  const missing = [];
  if (secret.length < 32) missing.push("SANDFEST_PARTNER_PORTAL_SECRET(32+ chars)");
  if (!publicBaseUrl) missing.push(production ? "SANDFEST_PUBLIC_SITE_URL(HTTPS)" : "SANDFEST_PUBLIC_SITE_URL");
  return {
    ready: missing.length === 0,
    production,
    secret,
    publicBaseUrl,
    missing,
    reason: missing.length ? `Missing ${missing.join(", ")}` : null
  };
}

function tokenMessage(application) {
  return [
    "texas-sandfest-partner-portal-v1",
    clean(application?.id, 120),
    clean(application?.reference, 80).toUpperCase(),
    clean(application?.portalAccessId, 120),
    String(Number(application?.portalAccessVersion || 1))
  ].join(":");
}

export function issuePartnerPortalToken(application, options = {}) {
  const config = options.config ?? partnerPortalConfig(options.env);
  if (!config.ready || !application?.id || !application?.reference || !application?.portalAccessId) return null;
  const signature = createHmac("sha256", config.secret).update(tokenMessage(application)).digest("base64url");
  return `tsfp_${signature}`;
}

export function verifyPartnerPortalToken(application, token, options = {}) {
  const expected = issuePartnerPortalToken(application, options);
  const received = clean(token, 200);
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function partnerPortalPath(application, token) {
  if (!application?.reference || !token) return null;
  return `/#partner-status?reference=${encodeURIComponent(application.reference)}&token=${encodeURIComponent(token)}`;
}

export function partnerPortalUrl(application, token, options = {}) {
  const config = options.config ?? partnerPortalConfig(options.env);
  const portalPath = partnerPortalPath(application, token);
  if (!config.ready || !portalPath) return null;
  return new URL(portalPath, `${config.publicBaseUrl}/`).toString();
}

export function findPartnerPortalApplication(docInput, reference, token, options = {}) {
  const referenceValue = clean(reference, 80).toUpperCase();
  const applications = Array.isArray(docInput?.applications) ? docInput.applications : [];
  const application = applications.find(item => clean(item.reference, 80).toUpperCase() === referenceValue
    && verifyPartnerPortalToken(item, token, options));
  if (!application) {
    return { ok: false, error: "Partner application not found or access link invalid." };
  }
  return { ok: true, application };
}

export function publicPartnerPortalStatus(docInput, application, options = {}) {
  const nowMs = new Date(options.now ?? new Date().toISOString()).getTime();
  const payments = (Array.isArray(docInput?.payments) ? docInput.payments : [])
    .filter(item => item.applicationId === application.id && ["succeeded", "partially_refunded"].includes(item.status));
  const expectedAmountCents = money(application.expectedAmountCents || application.requestedAmountCents);
  const paidAmountCents = payments.reduce((sum, item) => sum + Math.max(0, money(item.amountCents) - money(item.refundedAmountCents)), 0);
  const balanceCents = Math.max(0, expectedAmountCents - paidAmountCents);
  const milestones = (Array.isArray(docInput?.milestones) ? docInput.milestones : [])
    .filter(item => item.applicationId === application.id)
    .sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")))
    .map(item => ({
      label: clean(item.label, 160),
      status: clean(item.status, 40) || "open",
      dueAt: item.dueAt ?? null,
      completedAt: item.completedAt ?? null
    }));
  const invoice = (Array.isArray(docInput?.invoices) ? docInput.invoices : [])
    .filter(item => item.applicationId === application.id && item.status !== "voided")
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] ?? null;
  const paymentCheckout = invoice
    ? (Array.isArray(docInput?.paymentCheckouts) ? docInput.paymentCheckouts : [])
      .filter(item => item.invoiceId === invoice.id
        && item.applicationId === application.id
        && item.status === "open"
        && item.checkoutUrl
        && new Date(item.expiresAt || "").getTime() > nowMs)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] ?? null
    : null;
  const nextMilestone = milestones.find(item => item.status === "open") ?? null;
  const brandProfile = (Array.isArray(docInput?.brandProfiles) ? docInput.brandProfiles : [])
    .find(item => item.applicationId === application.id) ?? null;
  const brandAssets = (Array.isArray(docInput?.brandAssets) ? docInput.brandAssets : [])
    .filter(item => item.applicationId === application.id && item.status !== "archived")
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .map(item => ({
      id: item.id,
      kind: clean(item.kind, 40),
      label: clean(item.label, 160),
      sourceType: item.sourceType === "upload" ? "upload" : "external_url",
      sourceUrl: item.sourceType === "external_url" ? item.sourceUrl ?? null : null,
      fileName: item.fileName ?? null,
      contentType: item.contentType ?? null,
      sizeBytes: item.sizeBytes ?? null,
      status: clean(item.status, 40) || "submitted",
      reviewNotes: clean(item.reviewNotes, 1000),
      updatedAt: item.updatedAt ?? item.createdAt ?? null
    }));
  const deliverables = (Array.isArray(docInput?.deliverables) ? docInput.deliverables : [])
    .filter(item => item.applicationId === application.id && item.status !== "cancelled")
    .sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")) || String(a.label).localeCompare(String(b.label)))
    .map(item => ({
      id: item.id,
      label: clean(item.label, 160),
      description: clean(item.description, 1000),
      status: clean(item.status, 40) || "planned",
      dueAt: item.dueAt ?? null,
      proofUrl: item.proofUrl ?? null,
      proofNotes: clean(item.proofNotes, 1000),
      proofVersion: Number(item.proofVersion || 0),
      partnerReviewStatus: clean(item.partnerReviewStatus, 40) || "not_ready",
      partnerReviewNotes: clean(item.partnerReviewNotes, 1000),
      partnerReviewedAt: item.partnerReviewedAt ?? null,
      updatedAt: item.updatedAt ?? item.createdAt ?? null
    }));
  const vendorProfile = (Array.isArray(docInput?.vendorProfiles) ? docInput.vendorProfiles : [])
    .find(item => item.applicationId === application.id) ?? null;
  const vendorDocuments = Array.isArray(docInput?.vendorDocuments) ? docInput.vendorDocuments : [];
  const vendorRequirements = (Array.isArray(docInput?.vendorRequirements) ? docInput.vendorRequirements : [])
    .filter(item => item.applicationId === application.id)
    .sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")) || String(a.label).localeCompare(String(b.label)))
    .map(item => {
      const document = vendorDocuments.find(documentItem => documentItem.id === item.currentDocumentId && !["superseded", "archived"].includes(documentItem.status));
      return {
        id: item.id,
        code: clean(item.code, 80),
        label: clean(item.label, 160),
        required: item.required !== false,
        status: clean(item.status, 40) || "missing",
        dueAt: item.dueAt ?? null,
        reviewNotes: clean(item.reviewNotes, 1000),
        expiresAt: item.expiresAt ?? null,
        document: document ? {
          id: document.id,
          label: clean(document.label, 160),
          sourceType: document.sourceType === "upload" ? "upload" : "external_url",
          sourceUrl: document.sourceType === "external_url" ? document.sourceUrl ?? null : null,
          fileName: document.fileName ?? null,
          contentType: document.contentType ?? null,
          sizeBytes: document.sizeBytes ?? null,
          status: clean(document.status, 40) || "submitted",
          updatedAt: document.updatedAt ?? document.createdAt ?? null
        } : null
      };
    });
  const vendorAssignment = (Array.isArray(docInput?.vendorAssignments) ? docInput.vendorAssignments : [])
    .find(item => item.applicationId === application.id) ?? null;
  return {
    reference: application.reference,
    type: application.type,
    status: application.status,
    organizationName: application.organizationName,
    category: application.category || null,
    packageId: application.packageId || null,
    offeringId: application.offeringId || null,
    offeringName: application.offeringName || null,
    submittedAt: application.createdAt,
    updatedAt: application.updatedAt,
    nextStep: nextMilestone ? { label: nextMilestone.label, dueAt: nextMilestone.dueAt } : null,
    finance: {
      currency: "usd",
      expectedAmountCents,
      paidAmountCents,
      balanceCents,
      paymentStatus: expectedAmountCents === 0 ? "pending_review" : balanceCents === 0 ? "paid" : paidAmountCents > 0 ? "partial" : "unpaid",
      invoice: invoice ? {
        id: invoice.id,
        status: invoice.status,
        amountCents: money(invoice.amountCents),
        balanceCents: money(invoice.balanceCents ?? invoice.amountCents),
        dueAt: invoice.dueAt ?? null
      } : null,
      checkout: paymentCheckout ? {
        status: "open",
        checkoutUrl: paymentCheckout.checkoutUrl,
        expiresAt: paymentCheckout.expiresAt ?? null
      } : null
    },
    milestones,
    branding: application.type === "sponsor" ? {
      profile: brandProfile ? {
        displayName: clean(brandProfile.displayName, 160),
        website: brandProfile.website ?? null,
        tagline: clean(brandProfile.tagline, 240),
        primaryColor: brandProfile.primaryColor ?? null,
        secondaryColor: brandProfile.secondaryColor ?? null,
        instagramUrl: brandProfile.instagramUrl ?? null,
        linkedinUrl: brandProfile.linkedinUrl ?? null,
        usageNotes: clean(brandProfile.usageNotes, 2000),
        status: clean(brandProfile.status, 40) || "draft",
        reviewNotes: clean(brandProfile.reviewNotes, 1000),
        updatedAt: brandProfile.updatedAt ?? null
      } : null,
      assets: brandAssets,
      deliverables
    } : null,
    vendorOnboarding: application.type === "vendor" ? {
      profile: vendorProfile ? {
        legalName: clean(vendorProfile.legalName, 160),
        boothName: clean(vendorProfile.boothName, 160),
        website: vendorProfile.website ?? null,
        publicDescription: clean(vendorProfile.publicDescription, 2000),
        emergencyContactName: clean(vendorProfile.emergencyContactName, 120),
        emergencyContactPhone: clean(vendorProfile.emergencyContactPhone, 40),
        powerNeed: clean(vendorProfile.powerNeed, 20) || "none",
        waterRequired: vendorProfile.waterRequired === true,
        cookingMethod: clean(vendorProfile.cookingMethod, 20) || "none",
        vehicleLengthFeet: vendorProfile.vehicleLengthFeet ?? null,
        accessibilityNotes: clean(vendorProfile.accessibilityNotes, 1000),
        operationalNotes: clean(vendorProfile.operationalNotes, 2000),
        status: clean(vendorProfile.status, 40) || "draft",
        reviewNotes: clean(vendorProfile.reviewNotes, 1000),
        updatedAt: vendorProfile.updatedAt ?? null
      } : null,
      requirements: vendorRequirements,
      assignment: vendorAssignment ? {
        status: clean(vendorAssignment.status, 40) || "unassigned",
        boothNumber: vendorAssignment.boothNumber ?? null,
        zone: vendorAssignment.zone ?? null,
        accessGate: vendorAssignment.accessGate ?? null,
        loadInStart: vendorAssignment.loadInStart ?? null,
        loadInEnd: vendorAssignment.loadInEnd ?? null,
        loadOutStart: vendorAssignment.loadOutStart ?? null,
        loadOutEnd: vendorAssignment.loadOutEnd ?? null,
        parkingPasses: Number(vendorAssignment.parkingPasses || 0),
        staffWristbands: Number(vendorAssignment.staffWristbands || 0),
        instructions: clean(vendorAssignment.instructions, 2000),
        partnerConfirmedAt: vendorAssignment.partnerConfirmedAt ?? null
      } : null
    } : null
  };
}

export function adminPartnerPortalAccess(application) {
  return {
    enabled: Boolean(application?.portalAccessId),
    version: Number(application?.portalAccessVersion || 0),
    issuedAt: application?.portalAccessIssuedAt ?? null
  };
}
