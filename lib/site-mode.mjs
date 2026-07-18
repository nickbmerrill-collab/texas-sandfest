export const OPS_DEMO_SECTION_IDS = Object.freeze([
  "operations",
  "admin-config",
  "admin-documents",
  "admin-partners",
  "admin-revenue",
  "admin-volunteers",
  "admin-island-conditions",
  "admin-system-monitor",
  "admin",
  "workflows",
  "surfaces",
  "finance",
  "roadmap"
]);

export function normalizeSiteMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["public", "visitor"].includes(normalized)) return "public";
  if (["ops", "operations"].includes(normalized)) return "ops";
  return null;
}

export function siteModeForHash(hash, opsSectionIds = OPS_DEMO_SECTION_IDS) {
  let id = String(hash || "").replace(/^#/, "");
  try { id = decodeURIComponent(id); } catch { /* keep the raw fragment */ }
  if (!id) return null;
  return new Set(opsSectionIds).has(id) ? "ops" : "public";
}

export function resolveInitialSiteMode({
  adminEntry = false,
  opsDemoEnabled = false,
  queryMode = null,
  hash = "",
  savedMode = null,
  opsSectionIds = OPS_DEMO_SECTION_IDS
} = {}) {
  if (adminEntry) return "ops";
  if (!opsDemoEnabled) return "public";

  const requested = normalizeSiteMode(queryMode);
  if (requested) return requested;

  const linked = siteModeForHash(hash, opsSectionIds);
  if (linked) return linked;

  return normalizeSiteMode(savedMode) || "public";
}
