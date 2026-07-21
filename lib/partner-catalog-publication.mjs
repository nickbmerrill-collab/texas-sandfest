import { createHash } from "node:crypto";

const CATALOG_KINDS = new Set(["sponsor", "vendor"]);
const PUBLICATION_STATUSES = new Set(["pending", "published", "board_demo"]);

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function instant(value) {
  const input = text(value, 64);
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function httpsUrl(value) {
  try {
    const parsed = new URL(text(value, 500));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function kind(value) {
  const candidate = text(value, 20).toLowerCase();
  return CATALOG_KINDS.has(candidate) ? candidate : null;
}

function kindLabel(value) {
  return value === "sponsor" ? "sponsorship program" : "vendor program";
}

export function partnerCatalogDigest(kindInput, items = []) {
  const catalogKind = kind(kindInput);
  if (!catalogKind) throw new Error("Partner catalog kind must be sponsor or vendor.");
  return createHash("sha256")
    .update(JSON.stringify(stableValue({ kind: catalogKind, items: Array.isArray(items) ? items : [] })))
    .digest("hex");
}

export function normalizePartnerCatalogPublication(input = {}) {
  const status = text(input.status, 20).toLowerCase();
  const digest = text(input.catalogDigest, 64).toLowerCase();
  return {
    status: PUBLICATION_STATUSES.has(status) ? status : "pending",
    eventId: text(input.eventId, 120) || null,
    catalogDigest: /^[a-f0-9]{64}$/.test(digest) ? digest : null,
    sourceUrl: httpsUrl(input.sourceUrl),
    sourceCheckedAt: instant(input.sourceCheckedAt),
    publishedAt: instant(input.publishedAt),
    publishedBy: text(input.publishedBy, 160) || null,
    heldAt: instant(input.heldAt),
    heldBy: text(input.heldBy, 160) || null,
    holdReason: text(input.holdReason, 500) || null,
    lastUpdated: instant(input.lastUpdated)
  };
}

export function partnerCatalogPublicationReadiness(input = {}, options = {}) {
  const catalogKind = kind(input.kind);
  if (!catalogKind) throw new Error("Partner catalog kind must be sponsor or vendor.");
  const items = Array.isArray(input.items) ? input.items : [];
  const publication = normalizePartnerCatalogPublication(input.publication);
  const catalogDigest = partnerCatalogDigest(catalogKind, items);
  const now = new Date(options.now ?? Date.now());
  const maxSourceAgeDays = Math.max(1, Number(options.maxSourceAgeDays ?? 180));
  const sourceCheckedAt = publication.sourceCheckedAt ? new Date(publication.sourceCheckedAt) : null;
  const sourceAgeDays = sourceCheckedAt
    ? Math.floor((now.getTime() - sourceCheckedAt.getTime()) / 86_400_000)
    : null;
  const catalogReady = input.catalogReady === true && items.length > 0;
  const allowBoardDemo = options.allowBoardDemo === true;

  if (allowBoardDemo && publication.status === "board_demo") {
    const ready = catalogReady && publication.eventId === text(input.eventId, 120) && publication.catalogDigest === catalogDigest;
    return {
      ready,
      checks: {
        boardDemo: true,
        event: publication.eventId === text(input.eventId, 120),
        catalog: catalogReady,
        digest: publication.catalogDigest === catalogDigest
      },
      missing: ready ? [] : ["board catalog"],
      publication,
      catalogDigest,
      sourceAgeDays: null,
      maxSourceAgeDays,
      reason: ready
        ? `${items.length} synthetic ${kindLabel(catalogKind)} item${items.length === 1 ? " is" : "s are"} isolated to the board demonstration.`
        : `The synthetic ${kindLabel(catalogKind)} is not bound to the current board catalog.`
    };
  }

  const checks = {
    published: publication.status === "published" && Boolean(publication.publishedAt && publication.publishedBy),
    event: Boolean(publication.eventId && publication.eventId === text(input.eventId, 120)),
    source: Boolean(publication.sourceUrl && sourceCheckedAt && sourceAgeDays >= 0 && sourceAgeDays <= maxSourceAgeDays),
    catalog: catalogReady,
    digest: publication.catalogDigest === catalogDigest
  };
  const missing = Object.entries(checks).filter(([, ready]) => !ready).map(([name]) => name);
  return {
    ready: missing.length === 0,
    checks,
    missing,
    publication,
    catalogDigest,
    sourceAgeDays,
    maxSourceAgeDays,
    reason: missing.length
      ? `The ${text(input.eventId, 120) || "current-event"} ${kindLabel(catalogKind)} is not published: ${missing.join(", ")}.`
      : `${items.length} ${kindLabel(catalogKind)} item${items.length === 1 ? " is" : "s are"} source-reviewed and published.`
  };
}

export function publishPartnerCatalog(input = {}, patch = {}, options = {}) {
  const catalogKind = kind(input.kind);
  if (!catalogKind) return { ok: false, error: "Partner catalog kind must be sponsor or vendor." };
  const eventId = text(options.eventId ?? input.eventId, 120);
  const actorId = text(options.actorId, 160) || "unknown";
  const now = instant(options.now ?? new Date().toISOString());
  const sourceUrl = httpsUrl(patch.sourceUrl);
  const sourceCheckedAt = instant(patch.sourceCheckedAt);
  const items = Array.isArray(input.items) ? input.items : [];
  const errors = [];
  if (!/^texas-sandfest-\d{4}$/.test(eventId)) errors.push("A current Texas SandFest event id is required.");
  if (input.catalogReady !== true || !items.length) errors.push(`The ${kindLabel(catalogKind)} catalog must be valid and non-empty.`);
  if (!sourceUrl) errors.push(`An HTTPS official ${kindLabel(catalogKind)} source is required.`);
  if (!sourceCheckedAt) errors.push(`The official ${kindLabel(catalogKind)} source-check time is required.`);
  if (sourceCheckedAt && now && sourceCheckedAt > now) errors.push("The official source-check time cannot be in the future.");
  if (errors.length) return { ok: false, error: errors[0], errors };

  const publication = {
    ...normalizePartnerCatalogPublication(input.publication),
    status: options.boardDemo === true ? "board_demo" : "published",
    eventId,
    catalogDigest: partnerCatalogDigest(catalogKind, items),
    sourceUrl: options.boardDemo === true ? null : sourceUrl,
    sourceCheckedAt: options.boardDemo === true ? null : sourceCheckedAt,
    publishedAt: options.boardDemo === true ? null : now,
    publishedBy: options.boardDemo === true ? null : actorId,
    heldAt: null,
    heldBy: null,
    holdReason: null,
    lastUpdated: now
  };
  return { ok: true, publication };
}

export function holdPartnerCatalog(input = {}, options = {}) {
  const catalogKind = kind(input.kind);
  if (!catalogKind) return { ok: false, error: "Partner catalog kind must be sponsor or vendor." };
  const reason = text(options.reason, 500);
  if (reason.length < 8) return { ok: false, error: `A ${kindLabel(catalogKind)} hold reason of at least 8 characters is required.` };
  const now = instant(options.now ?? new Date().toISOString());
  return {
    ok: true,
    publication: {
      ...normalizePartnerCatalogPublication(input.publication),
      status: "pending",
      eventId: text(options.eventId ?? input.eventId, 120) || null,
      catalogDigest: null,
      publishedAt: null,
      publishedBy: null,
      heldAt: now,
      heldBy: text(options.actorId, 160) || "unknown",
      holdReason: reason,
      lastUpdated: now
    }
  };
}

export function refreshPartnerCatalogPublication(input = {}, options = {}) {
  const catalogKind = kind(input.kind);
  if (!catalogKind) throw new Error("Partner catalog kind must be sponsor or vendor.");
  const publication = normalizePartnerCatalogPublication(input.publication);
  const items = Array.isArray(input.items) ? input.items : [];
  const nextDigest = partnerCatalogDigest(catalogKind, items);
  const now = instant(options.now ?? new Date().toISOString());
  const eventId = text(options.eventId ?? input.eventId, 120) || null;
  if (options.boardDemo === true) {
    return {
      ...publication,
      status: "board_demo",
      eventId,
      catalogDigest: nextDigest,
      sourceUrl: null,
      sourceCheckedAt: null,
      publishedAt: null,
      publishedBy: null,
      heldAt: null,
      heldBy: null,
      holdReason: null,
      lastUpdated: now
    };
  }
  if (publication.status === "published" && publication.eventId === eventId && publication.catalogDigest === nextDigest) {
    return publication;
  }
  return {
    ...publication,
    status: "pending",
    eventId,
    catalogDigest: null,
    publishedAt: null,
    publishedBy: null,
    heldAt: null,
    heldBy: null,
    holdReason: publication.status === "published" ? "Catalog content changed after publication and requires source review." : publication.holdReason,
    lastUpdated: now
  };
}

export function publicPartnerCatalogPublication(readiness = {}, kindInput) {
  const catalogKind = kind(kindInput);
  if (!catalogKind) throw new Error("Partner catalog kind must be sponsor or vendor.");
  const publication = normalizePartnerCatalogPublication(readiness.publication);
  return {
    available: readiness.ready === true,
    status: readiness.ready === true ? publication.status : "pending",
    eventId: publication.eventId,
    sourceUrl: readiness.ready === true ? publication.sourceUrl : null,
    sourceCheckedAt: readiness.ready === true ? publication.sourceCheckedAt : null,
    message: readiness.ready === true
      ? publication.status === "board_demo"
        ? `Synthetic ${kindLabel(catalogKind)} available in this board demonstration.`
        : `The current ${kindLabel(catalogKind)} is source-reviewed and published.`
      : `The current ${kindLabel(catalogKind)} has not been published yet.`
  };
}
