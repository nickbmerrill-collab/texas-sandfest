import { createHash } from "node:crypto";

const STORAGE_KEY_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+\.(png|jpg|webp|pdf)$/;
const INCOMING_STORAGE_KEY_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+\.(pdf|txt|csv|json|eml|png|jpg|webp|docx|xlsx|pptx)$/;
const INCOMING_STORAGE_PREFIX = "incoming-documents";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REPORTED_ISSUES = 25;

function collectionRecords(doc, collection) {
  return Array.isArray(doc?.[collection]) ? doc[collection] : [];
}

function safeRecordId(value) {
  return String(value || "unknown").trim().slice(0, 160) || "unknown";
}

function manifestHash(references) {
  const manifest = references
    .map(reference => ({
      storageKey: reference.storageKey,
      sizeBytes: reference.sizeBytes,
      checksumSha256: reference.checksumSha256
    }))
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function isPartnerAssetStorageKey(value) {
  return STORAGE_KEY_PATTERN.test(String(value || ""));
}

export function isIncomingDocumentStorageKey(value) {
  return INCOMING_STORAGE_KEY_PATTERN.test(String(value || ""));
}

export function isPlatformAssetRecoveryStorageKey(value) {
  const key = String(value || "");
  if (isPartnerAssetStorageKey(key)) return true;
  if (!key.startsWith(`${INCOMING_STORAGE_PREFIX}/`)) return false;
  return isIncomingDocumentStorageKey(key.slice(INCOMING_STORAGE_PREFIX.length + 1));
}

export function partnerAssetRecoveryReferences(partnerDoc) {
  const referencesByKey = new Map();
  const invalid = [];
  const counts = {
    uploadRecords: 0,
    brandAssets: 0,
    vendorDocuments: 0,
    externalReferences: 0
  };

  for (const collection of ["brandAssets", "vendorDocuments"]) {
    for (const record of collectionRecords(partnerDoc, collection)) {
      if (record?.sourceType === "external_url") {
        counts.externalReferences += 1;
        continue;
      }
      if (record?.sourceType !== "upload") {
        if (record?.storageKey || record?.checksumSha256) {
          invalid.push({
            collection,
            id: safeRecordId(record?.id),
            storageKey: String(record?.storageKey || "").slice(0, 500),
            reason: "Stored file metadata is not marked as an upload."
          });
        }
        continue;
      }

      counts.uploadRecords += 1;
      counts[collection] += 1;
      const storageKey = String(record?.storageKey || "").trim();
      const checksumSha256 = String(record?.checksumSha256 || "").trim().toLowerCase();
      const sizeBytes = Number(record?.sizeBytes);
      const reasons = [];
      if (!isPartnerAssetStorageKey(storageKey)) reasons.push("invalid storage key");
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) reasons.push("invalid byte count");
      if (!SHA256_PATTERN.test(checksumSha256)) reasons.push("invalid SHA-256 checksum");
      if (reasons.length) {
        invalid.push({
          collection,
          id: safeRecordId(record?.id),
          storageKey: storageKey.slice(0, 500),
          reason: reasons.join(", ")
        });
        continue;
      }

      const source = { collection, id: safeRecordId(record?.id) };
      const existing = referencesByKey.get(storageKey);
      if (!existing) {
        referencesByKey.set(storageKey, { storageKey, sizeBytes, checksumSha256, sources: [source] });
        continue;
      }
      if (existing.sizeBytes !== sizeBytes || existing.checksumSha256 !== checksumSha256) {
        invalid.push({
          collection,
          id: source.id,
          storageKey,
          reason: "Storage key has conflicting size or checksum metadata."
        });
        continue;
      }
      existing.sources.push(source);
    }
  }

  const references = [...referencesByKey.values()].sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  return {
    ok: invalid.length === 0,
    references,
    invalid,
    counts: { ...counts, uniqueFiles: references.length }
  };
}

export function incomingDocumentRecoveryReferences(incomingDoc) {
  const references = [];
  const invalid = [];
  const documents = collectionRecords(incomingDoc, "documents");
  for (const record of documents) {
    const storageKey = String(record?.storageKey || "").trim();
    const checksumSha256 = String(record?.checksumSha256 || "").trim().toLowerCase();
    const sizeBytes = Number(record?.sizeBytes);
    const reasons = [];
    if (!isIncomingDocumentStorageKey(storageKey)) reasons.push("invalid storage key");
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) reasons.push("invalid byte count");
    if (!SHA256_PATTERN.test(checksumSha256)) reasons.push("invalid SHA-256 checksum");
    if (reasons.length) {
      invalid.push({
        collection: "incomingDocuments",
        id: safeRecordId(record?.id),
        storageKey: storageKey.slice(0, 500),
        reason: reasons.join(", ")
      });
      continue;
    }
    references.push({
      storageKey: `${INCOMING_STORAGE_PREFIX}/${storageKey}`,
      sizeBytes,
      checksumSha256,
      sources: [{ collection: "incomingDocuments", id: safeRecordId(record?.id) }]
    });
  }
  references.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  return {
    ok: invalid.length === 0,
    references,
    invalid,
    counts: {
      uploadRecords: documents.length,
      incomingDocuments: documents.length,
      uniqueFiles: references.length
    }
  };
}

export function platformAssetRecoveryReferences(partnerDoc, incomingDoc) {
  const partner = partnerAssetRecoveryReferences(partnerDoc);
  const incoming = incomingDocumentRecoveryReferences(incomingDoc);
  const references = [...partner.references, ...incoming.references]
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  return {
    ok: partner.ok && incoming.ok,
    references,
    invalid: [...partner.invalid, ...incoming.invalid],
    counts: {
      uploadRecords: Number(partner.counts.uploadRecords || 0) + Number(incoming.counts.uploadRecords || 0),
      brandAssets: Number(partner.counts.brandAssets || 0),
      vendorDocuments: Number(partner.counts.vendorDocuments || 0),
      incomingDocuments: Number(incoming.counts.incomingDocuments || 0),
      externalReferences: Number(partner.counts.externalReferences || 0),
      uniqueFiles: references.length
    }
  };
}

export async function verifyPartnerAssetRecovery(extraction, readAsset, options = {}) {
  if (typeof readAsset !== "function") throw new TypeError("readAsset must be a function.");
  const minimumFiles = Number(options.minimumFiles ?? 1);
  if (!Number.isSafeInteger(minimumFiles) || minimumFiles < 1) {
    throw new TypeError("minimumFiles must be a positive integer.");
  }

  const references = Array.isArray(extraction?.references) ? extraction.references : [];
  const invalid = Array.isArray(extraction?.invalid) ? extraction.invalid : [];
  const sourceCounts = extraction?.counts && typeof extraction.counts === "object" ? extraction.counts : {};
  const issues = invalid.map(item => ({
    type: "invalid_metadata",
    storageKey: item.storageKey || null,
    collection: item.collection || null,
    id: item.id || null,
    detail: item.reason || "Invalid upload metadata."
  }));
  let verified = 0;
  let bytes = 0;
  let missing = 0;
  let mismatched = 0;
  let unreadable = 0;

  for (const reference of references) {
    let result;
    try {
      result = await readAsset(reference.storageKey);
    } catch {
      result = { ok: false, reason: "unreadable" };
    }
    if (!result?.ok || !Buffer.isBuffer(result.buffer)) {
      const reason = result?.reason === "missing" ? "missing" : "unreadable";
      if (reason === "missing") missing += 1;
      else unreadable += 1;
      issues.push({ type: reason, storageKey: reference.storageKey });
      continue;
    }

    const actualSize = result.buffer.length;
    const actualChecksum = createHash("sha256").update(result.buffer).digest("hex");
    const sizeMatches = actualSize === reference.sizeBytes;
    const checksumMatches = actualChecksum === reference.checksumSha256;
    if (!sizeMatches || !checksumMatches) {
      mismatched += 1;
      issues.push({
        type: "mismatch",
        storageKey: reference.storageKey,
        sizeMatches,
        checksumMatches
      });
      continue;
    }
    verified += 1;
    bytes += actualSize;
  }

  if (references.length < minimumFiles) {
    issues.push({ type: "minimum_files", required: minimumFiles, found: references.length });
  }

  const allIssues = issues.length;
  return {
    ok: allIssues === 0,
    counts: {
      referenced: references.length,
      verified,
      uploadRecords: Number(sourceCounts.uploadRecords || 0),
      brandAssets: Number(sourceCounts.brandAssets || 0),
      vendorDocuments: Number(sourceCounts.vendorDocuments || 0),
      incomingDocuments: Number(sourceCounts.incomingDocuments || 0),
      externalReferences: Number(sourceCounts.externalReferences || 0),
      bytes,
      missing,
      mismatched,
      unreadable,
      invalid: invalid.length
    },
    minimumFiles,
    manifestSha256: manifestHash(references),
    issues: issues.slice(0, MAX_REPORTED_ISSUES),
    issuesTruncated: Math.max(0, allIssues - MAX_REPORTED_ISSUES)
  };
}
