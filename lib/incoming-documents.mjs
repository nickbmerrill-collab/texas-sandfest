import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EVENT_ID } from "./event-context.mjs";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const MAX_CONFIGURED_BYTES = 25 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const INCOMING_DOCUMENT_DOMAINS = Object.freeze([
  "eventeny",
  "quickbooks",
  "finance",
  "ops",
  "docs",
  "comms"
]);

export const INCOMING_DOCUMENT_STATUSES = Object.freeze([
  "received",
  "in_review",
  "approved",
  "changes_requested",
  "archived"
]);

export const INCOMING_DOCUMENT_OWNER_TEAMS = Object.freeze([
  "operations",
  "sponsor",
  "finance",
  "volunteer-captains",
  "traffic",
  "guest-services",
  "production"
]);

const DOMAIN_SET = new Set(INCOMING_DOCUMENT_DOMAINS);
const STATUS_SET = new Set(INCOMING_DOCUMENT_STATUSES);
const OWNER_SET = new Set(INCOMING_DOCUMENT_OWNER_TEAMS);

const UTF8_RULE = {
  kind: "text",
  matches(buffer) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return !buffer.includes(0);
    } catch {
      return false;
    }
  }
};

function zipEntryNames(buffer) {
  if (buffer.length < 22) return null;
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return null;
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) return null;
  const centralEnd = centralOffset + centralSize;
  if (centralOffset < 0 || centralEnd > endOffset) return null;
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralEnd || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (fileNameLength === 0 || nextOffset > centralEnd || localOffset + 4 > centralOffset) return null;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
    entries.push(buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8"));
    offset = nextOffset;
  }
  return offset === centralEnd ? entries : null;
}

function openXmlRule(rootPrefix) {
  return {
    kind: "binary",
    matches(buffer) {
      const entries = zipEntryNames(buffer);
      return Boolean(entries?.includes("[Content_Types].xml") && entries.some(name => name.startsWith(rootPrefix)));
    }
  };
}

const TYPES = Object.freeze({
  "application/pdf": {
    extension: ".pdf",
    kind: "binary",
    matches: buffer => buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  },
  "text/plain": { extension: ".txt", ...UTF8_RULE },
  "text/csv": { extension: ".csv", ...UTF8_RULE },
  "application/json": {
    extension: ".json",
    kind: "text",
    matches(buffer) {
      if (!UTF8_RULE.matches(buffer)) return false;
      try {
        JSON.parse(buffer.toString("utf8"));
        return true;
      } catch {
        return false;
      }
    }
  },
  "message/rfc822": { extension: ".eml", ...UTF8_RULE },
  "image/png": {
    extension: ".png",
    kind: "binary",
    matches: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  },
  "image/jpeg": {
    extension: ".jpg",
    kind: "binary",
    matches: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  "image/webp": {
    extension: ".webp",
    kind: "binary",
    matches: buffer => buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extension: ".docx", ...openXmlRule("word/") },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extension: ".xlsx", ...openXmlRule("xl/") },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { extension: ".pptx", ...openXmlRule("ppt/") }
});

const TYPE_BY_EXTENSION = new Map(Object.entries(TYPES).map(([contentType, rule]) => [rule.extension, contentType]));
const STORAGE_KEY_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+\.(pdf|txt|csv|json|eml|png|jpg|webp|docx|xlsx|pptx)$/;

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function iso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function optionalDateTime(value, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || String(value).trim() === "") return { ok: true, value: null };
  const parsed = iso(value);
  return parsed ? { ok: true, value: parsed } : { ok: false, error: `${label} must be a valid date and time.` };
}

export function defaultIncomingDocumentReviewDueAt(now = new Date().toISOString(), days = 3) {
  const base = new Date(now);
  if (Number.isNaN(base.getTime())) return null;
  const boundedDays = Math.max(1, Math.min(30, Math.round(Number(days) || 3)));
  return new Date(base.getTime() + boundedDays * 86_400_000).toISOString();
}

function safePart(value, fallback) {
  const clean = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return clean || fallback;
}

function safeFileName(value) {
  const clean = path.basename(String(value ?? "document")).replace(/[\r\n"\\/]+/g, "-").trim().slice(0, 180);
  return clean || "document";
}

function normalizedContentType(input, fileName) {
  const declared = String(input || "").split(";")[0].trim().toLowerCase();
  if (TYPES[declared]) return declared;
  return TYPE_BY_EXTENSION.get(path.extname(String(fileName || "")).toLowerCase()) || declared;
}

function textPreview(buffer, rule) {
  if (rule.kind !== "text") return { extractionStatus: "stored", textPreview: null, previewTruncated: false };
  const normalized = buffer.toString("utf8").replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").trim();
  return {
    extractionStatus: "preview_ready",
    textPreview: normalized.slice(0, 2_000),
    previewTruncated: normalized.length > 2_000
  };
}

function privateStoragePath(config, storageKey) {
  const directory = path.resolve(config.directory);
  const filePath = path.resolve(directory, storageKey);
  const relative = path.relative(directory, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return null;
  return filePath;
}

export function incomingDocumentStorageConfig(root, env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const configuredDirectory = String(env.SANDFEST_INCOMING_DOCUMENT_DIR || "").trim();
  const directory = path.resolve(configuredDirectory || path.join(root, "data", "processed", "incoming-documents"));
  const requestedMax = Number(env.SANDFEST_INCOMING_DOCUMENT_MAX_BYTES || DEFAULT_MAX_BYTES);
  const maxBytes = Number.isFinite(requestedMax) && requestedMax >= 1024
    ? Math.min(Math.round(requestedMax), MAX_CONFIGURED_BYTES)
    : DEFAULT_MAX_BYTES;
  return {
    ready: !production || Boolean(configuredDirectory),
    production,
    directory,
    maxBytes,
    allowedTypes: Object.keys(TYPES),
    reason: production && !configuredDirectory
      ? "SANDFEST_INCOMING_DOCUMENT_DIR must point to persistent private storage in production."
      : null
  };
}

export function validateIncomingDocumentUpload(input, options = {}) {
  const buffer = Buffer.isBuffer(input?.buffer) ? input.buffer : Buffer.from(input?.buffer || []);
  const fileName = safeFileName(input?.fileName);
  const contentType = normalizedContentType(input?.contentType, fileName);
  const rule = TYPES[contentType];
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  if (!buffer.length) return { ok: false, error: "Choose a non-empty document." };
  if (buffer.length > maxBytes) return { ok: false, error: `Document exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.` };
  if (!rule) return { ok: false, error: "Documents must be PDF, text, CSV, JSON, EML, PNG, JPEG, WebP, DOCX, XLSX, or PPTX files." };
  if (!rule.matches(buffer)) return { ok: false, error: "The uploaded file contents do not match its declared file type." };
  return {
    ok: true,
    buffer,
    contentType,
    extension: rule.extension,
    fileName,
    sizeBytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
    ...textPreview(buffer, rule)
  };
}

export async function saveIncomingDocumentUpload(root, input, options = {}) {
  const config = options.config ?? incomingDocumentStorageConfig(root, options.env);
  if (!config.ready) return { ok: false, error: config.reason };
  const validated = validateIncomingDocumentUpload(input, { maxBytes: config.maxBytes });
  if (!validated.ok) return validated;
  const eventPart = safePart(input.eventId, "event");
  const documentPart = safePart(input.documentId, "document");
  const storageKey = `${eventPart}/${documentPart}${validated.extension}`;
  const filePath = privateStoragePath(config, storageKey);
  if (!filePath) return { ok: false, error: "Invalid document storage path." };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, validated.buffer, { flag: "wx", mode: 0o600 });
  return {
    ok: true,
    storageKey,
    fileName: validated.fileName,
    contentType: validated.contentType,
    sizeBytes: validated.sizeBytes,
    checksumSha256: validated.checksumSha256,
    extractionStatus: validated.extractionStatus,
    textPreview: validated.textPreview,
    previewTruncated: validated.previewTruncated
  };
}

export async function readIncomingDocumentUpload(root, storageKey, options = {}) {
  const config = options.config ?? incomingDocumentStorageConfig(root, options.env);
  if (!config.ready) return { ok: false, error: config.reason };
  const key = String(storageKey || "");
  if (!STORAGE_KEY_PATTERN.test(key)) return { ok: false, error: "Invalid document storage key." };
  const filePath = privateStoragePath(config, key);
  if (!filePath) return { ok: false, error: "Invalid document storage path." };
  try {
    return { ok: true, buffer: await readFile(filePath) };
  } catch (error) {
    return { ok: false, error: error?.code === "ENOENT" ? "Document file not found." : "Document file could not be read." };
  }
}

export async function deleteIncomingDocumentUpload(root, storageKey, options = {}) {
  const config = options.config ?? incomingDocumentStorageConfig(root, options.env);
  const key = String(storageKey || "");
  if (!STORAGE_KEY_PATTERN.test(key)) return false;
  const filePath = privateStoragePath(config, key);
  if (!filePath) return false;
  await rm(filePath, { force: true });
  return true;
}

export function verifyIncomingDocumentBytes(record, buffer) {
  if (!Buffer.isBuffer(buffer)) return { ok: false, error: "Document bytes are unavailable." };
  const sizeMatches = buffer.length === Number(record?.sizeBytes);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const checksumMatches = SHA256_PATTERN.test(String(record?.checksumSha256 || "")) && checksum === record.checksumSha256;
  return {
    ok: sizeMatches && checksumMatches,
    sizeMatches,
    checksumMatches,
    checksumSha256: checksum,
    error: sizeMatches && checksumMatches ? null : "Stored document does not match its governed metadata."
  };
}

export function incomingDocumentDownloadName(record) {
  return safeFileName(record?.fileName || `sandfest-document${TYPES[record?.contentType]?.extension || ""}`);
}

export function emptyIncomingDocumentIntake(eventId = DEFAULT_EVENT_ID) {
  return {
    _note: "Private staff document intake metadata. File bytes remain on the configured private storage mount.",
    eventId,
    lastUpdated: null,
    documents: []
  };
}

function normalizeRecord(record) {
  const status = STATUS_SET.has(record?.status) ? record.status : "received";
  const domain = DOMAIN_SET.has(record?.domain) ? record.domain : "docs";
  const ownerTeam = OWNER_SET.has(record?.ownerTeam) ? record.ownerTeam : null;
  return {
    id: text(record?.id, 180),
    eventId: text(record?.eventId, 80),
    domain,
    title: text(record?.title, 180) || safeFileName(record?.fileName),
    fileName: safeFileName(record?.fileName),
    contentType: text(record?.contentType, 160),
    sizeBytes: Number(record?.sizeBytes) || 0,
    checksumSha256: text(record?.checksumSha256, 64).toLowerCase(),
    storageKey: text(record?.storageKey, 500),
    status,
    ownerTeam,
    reviewDueAt: iso(record?.reviewDueAt),
    notes: text(record?.notes, 2_000) || null,
    extractionStatus: record?.extractionStatus === "preview_ready" ? "preview_ready" : "stored",
    textPreview: text(record?.textPreview, 2_000) || null,
    previewTruncated: record?.previewTruncated === true,
    uploadedAt: iso(record?.uploadedAt),
    uploadedBy: text(record?.uploadedBy, 180) || "unknown",
    reviewedAt: iso(record?.reviewedAt),
    reviewedBy: text(record?.reviewedBy, 180) || null,
    archivedAt: iso(record?.archivedAt),
    archivedBy: text(record?.archivedBy, 180) || null,
    updatedAt: iso(record?.updatedAt) || iso(record?.uploadedAt)
  };
}

export function normalizeIncomingDocumentIntake(input, options = {}) {
  const fallbackEventId = text(options.eventId, 80) || DEFAULT_EVENT_ID;
  const eventId = text(input?.eventId, 80) || fallbackEventId;
  return {
    _note: text(input?._note, 500) || emptyIncomingDocumentIntake(eventId)._note,
    eventId,
    lastUpdated: iso(input?.lastUpdated),
    documents: (Array.isArray(input?.documents) ? input.documents : [])
      .map(normalizeRecord)
      .filter(record => record.id && record.eventId === eventId)
  };
}

export function createIncomingDocument(inputDoc, input, options = {}) {
  const eventId = text(options.eventId, 80) || DEFAULT_EVENT_ID;
  const doc = normalizeIncomingDocumentIntake(inputDoc, { eventId });
  if (doc.eventId !== eventId) return { ok: false, eventContextMismatch: true, error: `Document intake belongs to ${doc.eventId}; expected ${eventId}.`, doc };
  const domain = text(input?.domain, 40).toLowerCase();
  const title = text(input?.title, 180);
  const checksumSha256 = text(input?.checksumSha256, 64).toLowerCase();
  const ownerTeam = text(input?.ownerTeam, 80) || null;
  const reviewDueAt = optionalDateTime(input?.reviewDueAt, "Document review due date");
  if (!DOMAIN_SET.has(domain)) return { ok: false, error: "Choose a valid document domain.", doc };
  if (!title) return { ok: false, error: "Document title is required.", doc };
  if (!SHA256_PATTERN.test(checksumSha256)) return { ok: false, error: "Document checksum is invalid.", doc };
  if (ownerTeam && !OWNER_SET.has(ownerTeam)) return { ok: false, error: "Choose a valid owner team.", doc };
  if (!reviewDueAt.ok) return { ...reviewDueAt, doc };
  const duplicate = doc.documents.find(record => record.checksumSha256 === checksumSha256);
  if (duplicate) return { ok: true, duplicate: true, document: duplicate, doc };
  const now = iso(options.now) || new Date().toISOString();
  const id = text(input?.id, 180) || (options.idFactory ? options.idFactory("incoming_document") : `incoming_document_${randomUUID()}`);
  const record = normalizeRecord({
    ...input,
    id,
    eventId,
    domain,
    title,
    checksumSha256,
    ownerTeam,
    reviewDueAt: reviewDueAt.value ?? null,
    status: "received",
    notes: null,
    uploadedAt: now,
    uploadedBy: text(options.actorId, 180) || "unknown",
    reviewedAt: null,
    reviewedBy: null,
    archivedAt: null,
    archivedBy: null,
    updatedAt: now
  });
  const next = { ...doc, lastUpdated: now, documents: [...doc.documents, record] };
  return { ok: true, duplicate: false, document: record, doc: next };
}

export function updateIncomingDocument(inputDoc, documentId, patch, options = {}) {
  const eventId = text(options.eventId, 80) || DEFAULT_EVENT_ID;
  const doc = normalizeIncomingDocumentIntake(inputDoc, { eventId });
  if (doc.eventId !== eventId) return { ok: false, eventContextMismatch: true, error: `Document intake belongs to ${doc.eventId}; expected ${eventId}.`, doc };
  const index = doc.documents.findIndex(record => record.id === documentId);
  if (index < 0) return { ok: false, error: "Document not found.", doc };
  const current = doc.documents[index];
  const status = patch?.status == null ? current.status : text(patch.status, 40);
  const ownerTeam = patch?.ownerTeam == null ? current.ownerTeam : text(patch.ownerTeam, 80) || null;
  const reviewDueAt = optionalDateTime(patch?.reviewDueAt, "Document review due date");
  if (!STATUS_SET.has(status)) return { ok: false, error: "Choose a valid document status.", doc };
  if (ownerTeam && !OWNER_SET.has(ownerTeam)) return { ok: false, error: "Choose a valid owner team.", doc };
  if (!reviewDueAt.ok) return { ...reviewDueAt, doc };
  const now = iso(options.now) || new Date().toISOString();
  const actorId = text(options.actorId, 180) || "unknown";
  const nextReviewDueAt = reviewDueAt.value === undefined ? current.reviewDueAt : reviewDueAt.value;
  const changed = status !== current.status
    || ownerTeam !== current.ownerTeam
    || nextReviewDueAt !== current.reviewDueAt
    || (Object.hasOwn(patch || {}, "notes") && text(patch.notes, 2_000) !== (current.notes || ""));
  if (!changed) return { ok: true, changed: false, document: current, doc };
  const reviewed = ["in_review", "approved", "changes_requested"].includes(status);
  const archived = status === "archived";
  const record = normalizeRecord({
    ...current,
    status,
    ownerTeam,
    reviewDueAt: nextReviewDueAt,
    notes: Object.hasOwn(patch || {}, "notes") ? text(patch.notes, 2_000) || null : current.notes,
    reviewedAt: reviewed ? now : current.reviewedAt,
    reviewedBy: reviewed ? actorId : current.reviewedBy,
    archivedAt: archived ? now : status !== current.status && current.status === "archived" ? null : current.archivedAt,
    archivedBy: archived ? actorId : status !== current.status && current.status === "archived" ? null : current.archivedBy,
    updatedAt: now
  });
  const documents = doc.documents.slice();
  documents[index] = record;
  return { ok: true, changed: true, document: record, before: current, doc: { ...doc, lastUpdated: now, documents } };
}

export function summarizeIncomingDocuments(inputDoc, options = {}) {
  const doc = normalizeIncomingDocumentIntake(inputDoc, options);
  const byStatus = Object.fromEntries(INCOMING_DOCUMENT_STATUSES.map(status => [status, 0]));
  const byDomain = Object.fromEntries(INCOMING_DOCUMENT_DOMAINS.map(domain => [domain, 0]));
  let bytes = 0;
  let previewReady = 0;
  const nowMs = new Date(options.now || new Date().toISOString()).getTime();
  let overdue = 0;
  let dueSoon = 0;
  for (const record of doc.documents) {
    byStatus[record.status] += 1;
    byDomain[record.domain] += 1;
    bytes += Number(record.sizeBytes || 0);
    if (record.extractionStatus === "preview_ready") previewReady += 1;
    const dueMs = record.reviewDueAt ? new Date(record.reviewDueAt).getTime() : NaN;
    if (!["approved", "archived"].includes(record.status) && Number.isFinite(dueMs) && Number.isFinite(nowMs)) {
      if (dueMs < nowMs) overdue += 1;
      else if (dueMs <= nowMs + 3 * 86_400_000) dueSoon += 1;
    }
  }
  return {
    total: doc.documents.length,
    active: doc.documents.length - byStatus.archived,
    unassigned: doc.documents.filter(record => record.status !== "archived" && !record.ownerTeam).length,
    bytes,
    previewReady,
    overdue,
    dueSoon,
    byStatus,
    byDomain,
    lastUpdated: doc.lastUpdated
  };
}

export function adminIncomingDocument(record) {
  const normalized = normalizeRecord(record);
  const { storageKey: _storageKey, ...safe } = normalized;
  return safe;
}
