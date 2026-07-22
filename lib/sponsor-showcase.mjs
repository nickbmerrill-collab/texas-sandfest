import { normalizePartnerOperations } from "./partner-ops.mjs";
import { safePublicHttpsUrl } from "./public-outbound-url.mjs";

const PUBLIC_APPLICATION_STATUSES = new Set(["approved", "contracted", "invoiced", "partial", "paid", "active", "complete"]);
const PUBLIC_LOGO_KINDS = new Set(["primary_logo", "alternate_logo"]);
const PUBLIC_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeColor(value) {
  const candidate = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : null;
}

function eligibleSponsorApplication(doc, applicationId) {
  return doc.applications.find(application => application.id === applicationId
    && application.type === "sponsor"
    && PUBLIC_APPLICATION_STATUSES.has(application.status)) || null;
}

function approvedUploadedLogo(doc, applicationId) {
  return doc.brandAssets
    .filter(asset => asset.applicationId === applicationId
      && asset.status === "approved"
      && asset.sourceType === "upload"
      && PUBLIC_LOGO_KINDS.has(asset.kind)
      && PUBLIC_IMAGE_TYPES.has(asset.contentType)
      && asset.storageKey)
    .sort((a, b) => Number(b.kind === "primary_logo") - Number(a.kind === "primary_logo")
      || String(b.reviewedAt || b.updatedAt || "").localeCompare(String(a.reviewedAt || a.updatedAt || "")))[0] || null;
}

export function publicSponsorShowcase(docInput) {
  const doc = normalizePartnerOperations(docInput);
  return doc.brandProfiles
    .filter(profile => profile.status === "approved")
    .map(profile => {
      const application = eligibleSponsorApplication(doc, profile.applicationId);
      if (!application) return null;
      const logo = approvedUploadedLogo(doc, application.id);
      return {
        id: profile.id,
        _expectedAmountCents: Number(application.expectedAmountCents || 0),
        displayName: String(profile.displayName || application.organizationName || "").trim(),
        tagline: String(profile.tagline || "").trim(),
        website: safePublicHttpsUrl(profile.website),
        primaryColor: safeColor(profile.primaryColor),
        secondaryColor: safeColor(profile.secondaryColor),
        packageId: application.packageId || null,
        packageName: application.packageName || null,
        logo: logo ? {
          path: `/api/public/sponsor-showcase/assets/${encodeURIComponent(logo.id)}`,
          contentType: logo.contentType,
          label: logo.label || `${profile.displayName} logo`
        } : null
      };
    })
    .filter(item => item?.displayName)
    .sort((a, b) => b._expectedAmountCents - a._expectedAmountCents || a.displayName.localeCompare(b.displayName))
    .map(({ _expectedAmountCents, ...item }) => item);
}

export function approvedPublicSponsorAsset(docInput, assetId) {
  const doc = normalizePartnerOperations(docInput);
  const asset = doc.brandAssets.find(item => item.id === assetId
    && item.status === "approved"
    && item.sourceType === "upload"
    && PUBLIC_LOGO_KINDS.has(item.kind)
    && PUBLIC_IMAGE_TYPES.has(item.contentType)
    && item.storageKey);
  if (!asset) return null;
  const application = eligibleSponsorApplication(doc, asset.applicationId);
  const profile = doc.brandProfiles.find(item => item.applicationId === asset.applicationId && item.status === "approved");
  return application && profile ? asset : null;
}
