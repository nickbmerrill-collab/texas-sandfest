import { OfficeParser } from "officeparser";

const FILE_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"]
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STORED_CHARACTERS = 200_000;
const DEFAULT_MAX_CHUNKS = 200;
const DEFAULT_MAX_CHUNK_CHARACTERS = 2_000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function normalizedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function warningMessage(issue) {
  const code = String(issue?.code || issue?.type || "warning").trim().slice(0, 80);
  const message = String(issue?.message || issue || "Document parser warning").replace(/\s+/g, " ").trim().slice(0, 400);
  return `${code}: ${message}`.slice(0, 500);
}

function safeChunk(chunk, maxCharacters) {
  const text = normalizedText(chunk?.text).slice(0, maxCharacters);
  if (!text) return null;
  const metadata = chunk?.metadata || {};
  return {
    text,
    metadata: {
      pageNumber: Number.isInteger(Number(metadata.pageNumber)) ? Number(metadata.pageNumber) : null,
      slideNumber: Number.isInteger(Number(metadata.slideNumber)) ? Number(metadata.slideNumber) : null,
      sheetName: String(metadata.sheetName || "").trim().slice(0, 160) || null,
      closestHeading: String(metadata.closestHeading || "").trim().slice(0, 240) || null,
      isTableChunk: metadata.isTableChunk === true
    }
  };
}

export function documentExtractionFileType(input) {
  const contentType = typeof input === "string" ? input : input?.contentType;
  return FILE_TYPES.get(String(contentType || "").toLowerCase()) || null;
}

export async function extractDocumentText(buffer, record, options = {}) {
  if (!Buffer.isBuffer(buffer)) return { ok: false, error: "Document bytes are unavailable for extraction." };
  const fileType = documentExtractionFileType(record);
  if (!fileType) return { ok: false, unsupported: true, error: "This document type does not support automatic text extraction." };

  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000);
  const maxStoredCharacters = boundedInteger(options.maxStoredCharacters, DEFAULT_MAX_STORED_CHARACTERS, 10_000, 1_000_000);
  const maxChunks = boundedInteger(options.maxChunks, DEFAULT_MAX_CHUNKS, 1, 500);
  const maxChunkCharacters = boundedInteger(options.maxChunkCharacters, DEFAULT_MAX_CHUNK_CHARACTERS, 200, 5_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const warnings = [];

  try {
    const ast = await OfficeParser.parseOffice(buffer, {
      fileType,
      abortSignal: controller.signal,
      ocr: false,
      extractAttachments: false,
      includeRawContent: false,
      decompressionLimits: {
        maxUncompressedBytes: 64 * 1024 * 1024,
        maxZipEntries: 5_000
      },
      onWarning: issue => warnings.push(warningMessage(issue))
    });
    const textResult = await ast.to("text", {
      includeFormatting: false,
      abortSignal: controller.signal,
      textConfig: { preserveLayout: true, newlineDelimiter: "\n" },
      onWarning: issue => warnings.push(warningMessage(issue))
    });
    const chunksResult = await ast.to("chunks", {
      includeFormatting: false,
      abortSignal: controller.signal,
      chunksConfig: {
        strategy: "fixed-size",
        chunkSize: 1_600,
        chunkOverlap: 120,
        includeMetadata: true,
        stripWhitespace: true
      },
      onWarning: issue => warnings.push(warningMessage(issue))
    });
    const text = normalizedText(textResult?.value);
    const sourceChunks = Array.isArray(chunksResult?.value) ? chunksResult.value : [];
    const chunks = [];
    let storedCharacters = 0;
    for (const sourceChunk of sourceChunks) {
      if (chunks.length >= maxChunks || storedCharacters >= maxStoredCharacters) break;
      const chunk = safeChunk(sourceChunk, Math.min(maxChunkCharacters, maxStoredCharacters - storedCharacters));
      if (!chunk) continue;
      chunks.push(chunk);
      storedCharacters += chunk.text.length;
    }
    const parserWarnings = [...(Array.isArray(ast.warnings) ? ast.warnings.map(warningMessage) : []), ...warnings];
    return {
      ok: true,
      fileType,
      text,
      characterCount: text.length,
      chunks,
      chunkCount: sourceChunks.length,
      storedChunkCount: chunks.length,
      storedCharacters,
      truncated: text.length > maxStoredCharacters || sourceChunks.length > chunks.length,
      warnings: [...new Set(parserWarnings.filter(Boolean))].slice(0, 20)
    };
  } catch (error) {
    return {
      ok: false,
      timedOut: error?.name === "AbortError",
      error: error?.name === "AbortError"
        ? `Document extraction exceeded ${Math.round(timeoutMs / 1_000)} seconds.`
        : `Document extraction failed: ${String(error?.message || error).slice(0, 700)}`
    };
  } finally {
    clearTimeout(timer);
  }
}
