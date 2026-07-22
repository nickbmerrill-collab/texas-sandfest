#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { BOARD_DEMO_PREFLIGHT_CHECK_COUNT, boardDemoLoopbackUrl } from "../lib/board-demo-readiness.mjs";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
const SOURCE_PRESENTATION = path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx");
const BASELINE_DOCUMENTS = [
  ["2027 board priorities", "approved", "preview_ready", "done"],
  ["SandFest board platform briefing", "received", "ready", "open"],
  ["Sponsor benefit approvals", "received", "preview_ready", "open"],
  ["Vendor load-in matrix", "in_review", "preview_ready", "in_progress"]
];
const BASELINE = {
  total: 4,
  active: 4,
  extractionReady: 4,
  extractionQueued: 0,
  openTasks: 10,
  jobsTotal: 21,
  jobsDone: 21,
  jobsFailed: 0,
  documents: BASELINE_DOCUMENTS
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:documents -- [--json]");
  console.log("Uploads, extracts, delegates, reviews, downloads, and audits one private board packet, then restores the board baseline.");
  process.exit(0);
}

function log(value = "") {
  if (!jsonOutput) console.log(value);
}

function preflight(sessionFile) {
  const result = spawnSync(process.execPath, ["scripts/check-board-demo.mjs", "--json"], {
    cwd: ROOT,
    env: { ...process.env, SANDFEST_BOARD_SESSION_FILE: sessionFile },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000
  });
  let report;
  try {
    report = JSON.parse(result.stdout || "null");
  } catch {
    throw new Error(`Board preflight returned invalid JSON: ${result.stderr || result.stdout || "no output"}`);
  }
  if (
    result.status !== 0
    || report?.ok !== true
    || report.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT
    || report.total !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT
  ) {
    throw new Error(`Board preflight failed ${report?.passed ?? 0}/${report?.total ?? BOARD_DEMO_PREFLIGHT_CHECK_COUNT}.`);
  }
  return report;
}

function exactBase(value, label) {
  const url = boardDemoLoopbackUrl(value, label);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an exact loopback origin.`);
  }
  return url.origin;
}

function activeSession(session, report) {
  if (
    !session
    || session.schemaVersion !== BOARD_DEMO_SESSION_SCHEMA_VERSION
    || session.status !== "ready"
    || !boardDemoSessionProcessAlive(session)
  ) {
    throw new Error("The supervised board session is not ready.");
  }
  const apiBase = exactBase(session.endpoints?.apiBase, "Board API");
  const webBase = exactBase(session.endpoints?.webBase, "Board web");
  const operations = new URL(String(report.links?.operations || ""));
  if (
    operations.origin !== webBase
    || operations.pathname !== "/admin.html"
    || operations.searchParams.get("apiBase") !== apiBase
  ) {
    throw new Error("Board Operations link does not match the active supervised session.");
  }
  return { apiBase, operations: operations.toString() };
}

async function adminJson(apiBase, pathName) {
  const response = await fetch(`${apiBase}${pathName}`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`${pathName} returned ${response.status}.`);
  return response.json();
}

function documentBaselineRecords(payload) {
  return (payload?.documents || [])
    .map(item => [item.title, item.status, item.extractionStatus, item.reviewTask?.status || null])
    .sort((left, right) => left[0].localeCompare(right[0]));
}

async function baselineSnapshot(apiBase) {
  const [documents, partners, jobs] = await Promise.all([
    adminJson(apiBase, "/api/admin/documents?limit=200"),
    adminJson(apiBase, "/api/admin/partners"),
    adminJson(apiBase, "/api/admin/jobs?limit=100")
  ]);
  return {
    total: documents.summary?.total,
    active: documents.summary?.active,
    extractionReady: documents.summary?.extractionReady,
    extractionQueued: documents.summary?.extractionQueued,
    openTasks: partners.summary?.operations?.openTasks,
    jobsTotal: jobs.summary?.total,
    jobsDone: jobs.summary?.done,
    jobsFailed: jobs.summary?.failed,
    documents: documentBaselineRecords(documents)
  };
}

function baselineMatches(snapshot) {
  return Object.entries(BASELINE).every(([key, value]) => (
    key === "documents"
      ? JSON.stringify(snapshot?.documents) === JSON.stringify(value)
      : snapshot?.[key] === value
  ));
}

async function waitForReset(sessionFile, { generation, resetCount }) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const session = await readBoardDemoSession(sessionFile);
    if (
      session?.status === "ready"
      && Number(session.resetCount || 0) > resetCount
      && session.lastPreflight?.passed === BOARD_DEMO_PREFLIGHT_CHECK_COUNT
    ) {
      try {
        const apiBase = exactBase(session.endpoints?.apiBase, "Reset board API");
        const healthResponse = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(2_000) });
        const health = healthResponse.ok ? await healthResponse.json() : null;
        if (health?.boardDemoGeneration && health.boardDemoGeneration !== generation) {
          return { session, apiBase, generation: health.boardDemoGeneration };
        }
      } catch {
        // Service replacement briefly makes the loopback API unavailable.
      }
    }
    await delay(250);
  }
  throw new Error("The board supervisor did not restore the prepared baseline in time.");
}

async function resetBaseline(sessionFile, session) {
  const apiBase = exactBase(session.endpoints?.apiBase, "Board API");
  const healthResponse = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5_000) });
  const health = healthResponse.ok ? await healthResponse.json() : null;
  if (!health?.boardDemoResetReady || !health.boardDemoGeneration) {
    throw new Error("The active board API does not expose the supervised reset capability.");
  }
  const resetCount = Number(session.resetCount || 0);
  const response = await fetch(`${apiBase}/api/admin/board-demo/reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(5_000)
  });
  const accepted = await response.json().catch(() => ({}));
  if (response.status !== 202 || accepted.accepted !== true || accepted.generation !== health.boardDemoGeneration) {
    throw new Error(`Board reset was not accepted safely (${response.status}).`);
  }

  const restored = await waitForReset(sessionFile, {
    generation: health.boardDemoGeneration,
    resetCount
  });
  const report = preflight(sessionFile);
  const snapshot = await baselineSnapshot(restored.apiBase);
  if (!baselineMatches(snapshot)) {
    throw new Error(`Board reset did not restore the exact document baseline: ${JSON.stringify(snapshot)}.`);
  }
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    ...snapshot,
    preflight: `${report.passed}/${report.total}`
  };
}

function localDateTimeInput(value) {
  const date = new Date(value);
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function presentationUploadCopy(buffer, comment) {
  const endOfDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfDirectory < 0 || endOfDirectory + 22 > buffer.length) {
    throw new Error("The board presentation ZIP directory is invalid.");
  }
  const originalLength = buffer.readUInt16LE(endOfDirectory + 20);
  if (endOfDirectory + 22 + originalLength !== buffer.length) {
    throw new Error("The board presentation ZIP comment is invalid.");
  }
  const originalComment = buffer.subarray(endOfDirectory + 22);
  const addedComment = Buffer.from(comment, "ascii");
  const commentLength = originalComment.length + addedComment.length;
  if (commentLength > 65_535) throw new Error("The board presentation ZIP comment is too long.");
  const copy = Buffer.concat([buffer.subarray(0, endOfDirectory + 22), originalComment, addedComment]);
  copy.writeUInt16LE(commentLength, endOfDirectory + 20);
  return copy;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function waitForExtractedDocument(apiBase, documentId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await adminJson(apiBase, "/api/admin/documents?limit=200");
    const document = payload.documents?.find(item => item.id === documentId);
    if (document?.extractionStatus === "ready") return document;
    if (document?.extractionStatus === "failed" || document?.extractionStatus === "needs_review") {
      throw new Error(`Document extraction stopped at ${document.extractionStatus}.`);
    }
    await delay(250);
  }
  throw new Error("Private document extraction did not finish in time.");
}

async function saveReview(page, documentId, { status, notes }) {
  const card = page.locator(`[data-admin-document="${documentId}"]`);
  await card.locator('[name="status"]').selectOption(status);
  await card.locator('[name="notes"]').fill(notes);
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/documents/${documentId}`
      && response.request().method() === "PATCH"
  ));
  await card.locator("[data-save-admin-document]").click();
  const response = await responsePromise;
  if (response.status() !== 200) throw new Error(`Document review returned ${response.status()}.`);
  return response.json();
}

async function proveDocumentLifecycle(page, apiBase, runId) {
  const source = await readFile(SOURCE_PRESENTATION);
  const upload = presentationUploadCopy(source, `board-document-proof-${runId}`);
  const fileName = `SandFest-Board-Ingestion-Proof-${runId}.pptx`;
  const title = `Board ingestion proof ${runId}`;
  const form = page.locator("#admin-document-upload");
  await form.locator('[name="file"]').setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: upload
  });
  await form.locator('[name="domain"]').selectOption("docs");
  await form.locator('[name="ownerTeam"]').selectOption("production");
  await form.locator('[name="reviewDueAt"]').fill(localDateTimeInput(Date.now() + 2 * 86_400_000));
  await form.locator('[name="title"]').fill(title);
  const uploadResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/documents/upload"
      && response.request().method() === "POST"
  ));
  await form.locator('button[type="submit"]').click();
  const uploadResponse = await uploadResponsePromise;
  const uploadPayload = await uploadResponse.json().catch(() => ({}));
  if (
    uploadResponse.status() !== 201
    || !uploadPayload.document?.id
    || uploadPayload.document?.title !== title
    || uploadPayload.document?.reviewTask?.status !== "open"
    || uploadPayload.extractionJob?.status !== "queued"
  ) {
    throw new Error(`Document upload did not create extraction and review work (${uploadResponse.status()}).`);
  }
  const documentId = uploadPayload.document.id;
  const extractionJobId = uploadPayload.extractionJob.id;
  await expect(page.locator("#admin-document-upload-status")).toContainText("queued for private text extraction");
  await expect(page.locator(`[data-admin-document="${documentId}"]`)).toContainText(title);
  await expect(page.locator(`[data-admin-document="${documentId}"]`)).toContainText("Task open");

  const extracted = await waitForExtractedDocument(apiBase, documentId);
  if (
    extracted.extractedCharacterCount < 5_000
    || extracted.extractedChunkCount < 1
    || !String(extracted.textPreview || "").includes("TEXAS SANDFEST")
  ) {
    throw new Error("Extracted document evidence is incomplete.");
  }
  const jobs = await adminJson(apiBase, "/api/admin/jobs?limit=100");
  const extractionJob = jobs.jobs?.find(item => item.id === extractionJobId);
  if (extractionJob?.type !== "document.extract" || extractionJob.status !== "done") {
    throw new Error("The private extraction job did not retain completed automation evidence.");
  }
  const refreshResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/documents"
      && response.request().method() === "GET"
  ));
  await page.locator("#admin-load-documents").click();
  await refreshResponse;
  const card = page.locator(`[data-admin-document="${documentId}"]`);
  await expect(card).toContainText("Extraction ready");
  await card.locator(".admin-document-preview summary").click();
  await expect(card.locator(".admin-document-preview pre")).toContainText("TEXAS SANDFEST");

  const inReview = await saveReview(page, documentId, {
    status: "in_review",
    notes: "Extraction reviewed during the reset-safe board ingestion proof."
  });
  if (inReview.document?.reviewTask?.status !== "in_progress") {
    throw new Error("Document review did not advance its delegated task to in progress.");
  }
  await expect(page.locator(`[data-admin-document="${documentId}"]`)).toContainText("Task in progress");

  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
  await page.locator(`[data-admin-document="${documentId}"] [data-download-admin-document]`).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const downloaded = downloadPath ? await readFile(downloadPath) : null;
  if (!downloaded || sha256(downloaded) !== sha256(upload) || download.suggestedFilename() !== fileName) {
    throw new Error("Downloaded document bytes did not match the governed upload.");
  }

  const approved = await saveReview(page, documentId, {
    status: "approved",
    notes: "Extraction and source bytes approved for board operations."
  });
  if (approved.document?.reviewTask?.status !== "done") {
    throw new Error("Document approval did not complete its delegated task.");
  }
  await expect(page.locator(`[data-admin-document="${documentId}"]`)).toContainText("Approved");
  await expect(page.locator(`[data-admin-document="${documentId}"]`)).toContainText("Task done");

  return {
    documentId,
    title,
    fileName,
    sizeBytes: upload.length,
    checksumSha256: sha256(upload),
    extractedCharacterCount: extracted.extractedCharacterCount,
    extractedChunkCount: extracted.extractedChunkCount,
    extractionJobStatus: extractionJob.status,
    reviewTaskStatus: approved.document.reviewTask.status
  };
}

async function proveAudit(apiBase, document) {
  const payload = await adminJson(apiBase, "/api/admin/audit?limit=200");
  const records = (payload.audit || [])
    .map(item => item.record)
    .filter(record => record?.target?.type === "incomingDocument" && record.target.id === document.documentId);
  const actions = new Set(records.map(record => record.action));
  for (const action of ["document.upload", "document.review", "document.download"]) {
    if (!actions.has(action)) throw new Error(`Document audit is missing ${action}.`);
  }
  const serialized = JSON.stringify(records);
  if (
    serialized.includes("storageKey")
    || serialized.includes("extractionChunks")
    || serialized.includes("TEXAS SANDFEST")
    || serialized.includes(SOURCE_PRESENTATION)
  ) {
    throw new Error("Document audit exposed private source or storage details.");
  }
  return { records: records.length, actions: [...actions].sort() };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  document: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board document-ingestion proof ===\n");
  const report = preflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initialSnapshot = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initialSnapshot)) {
    log("Restoring the prepared four-document baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    endpoints = activeSession(session, preflight(sessionFile));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const operations = new URL(endpoints.operations);
  operations.hash = "admin-documents";
  await page.goto(operations.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: timeoutMs });
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await expect(page.locator("#admin-document-list [data-admin-document]")).toHaveCount(BASELINE.total);

  resetRequired = true;
  result.document = await proveDocumentLifecycle(page, endpoints.apiBase, runId);
  result.audit = await proveAudit(endpoints.apiBase, result.document);
  log("Verified private upload, extraction, delegated review, byte-identical download, approval, and privacy-safe audit evidence.");
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact document baseline at ${result.reset.preflight} readiness.`);
    } catch (error) {
      workflowError = workflowError
        ? new Error(`${workflowError.message} Baseline restoration also failed: ${error.message}`)
        : error;
    }
  }
}

if (workflowError) {
  result.error = workflowError.message;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else console.error(`\nBoard document-ingestion proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard document-ingestion proof passed.");
    console.log(`Upload:      ${result.document.fileName} (${result.document.sizeBytes} bytes)`);
    console.log(`Extraction:  ${result.document.extractedCharacterCount} characters · ${result.document.extractedChunkCount} chunks`);
    console.log(`Delegation:  review task ${result.document.reviewTaskStatus}`);
    console.log(`Integrity:   SHA-256 ${result.document.checksumSha256}`);
    console.log(`Audit:       ${result.audit.records} private lifecycle records`);
    console.log(`Reset:       ${result.reset.total} documents · ${result.reset.openTasks} open tasks · ${result.reset.preflight} ready`);
  }
}
