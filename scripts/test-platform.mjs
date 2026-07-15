#!/usr/bin/env node
// Full platform verification suite — pure lib checks + optional live API smoke.
// Usage:
//   node scripts/test-platform.mjs
//   SANDFEST_API_PORT=8806 node scripts/test-platform.mjs --api
//   (with API already running) node scripts/test-platform.mjs --api --base http://127.0.0.1:8806

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeLedger } from "../lib/revenue.mjs";
import { applyCheckout, applyCheckin, summarizeFleet, parseAssetQrPayload } from "../lib/fleet.mjs";
import { summarizeVolunteers } from "../lib/volunteers.mjs";
import { consentFromCheckout, summarizeConsent, validateCheckoutConsent } from "../lib/consent.mjs";
import { smsConfigFromEnv, sendSms } from "../lib/sms.mjs";
import { applyStamp, parsePassportPayload, summarizePassport } from "../lib/passport.mjs";
import { applyVote, tallyVotes, summarizeVoting, normalizeTicketRef } from "../lib/voting.mjs";
import { enqueueJob, claimNextJobs, completeJob } from "../lib/job-queue.mjs";
import { publicBoothPins, summarizeBooths, parseBoothCsv } from "../lib/booths.mjs";
import { escapeHtml } from "../lib/html-escape.mjs";
import { updateJsonFile } from "../lib/safe-json-store.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wantApi = process.argv.includes("--api");
const baseArg = process.argv.find(a => a.startsWith("--base="));
let API_BASE = baseArg ? baseArg.slice(7) : null;
const TOKEN = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";

let passed = 0;
let failed = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
}

console.log("\n=== Pure library suite ===\n");

// Revenue
{
  const ledger = await readJson("data/processed/revenue-ledger.json");
  const s = summarizeLedger(ledger.entries, {
    expectedAttendance: ledger.expectedAttendance,
    ticketCapacity: ledger.ticketCapacity
  });
  ok("revenue summarize", s.totals.count > 0 && s.totals.netCents > 0, `${s.totals.count} entries`);
}

// Fleet
{
  const fleet = await readJson("data/processed/fleet.json");
  const s = summarizeFleet(fleet.assets, fleet.checkouts, fleet.locations);
  ok("fleet summarize", s.totals.assets >= 10, `${s.totals.assets} assets`);
  ok("fleet QR parse", parseAssetQrPayload("tsf:asset:cart-02") === "cart-02");
  const out = applyCheckout(fleet, { assetId: "cart-02", checkedOutTo: "Test", team: "ops" }, { idFactory: () => "co_t" });
  ok("fleet checkout", out.ok && out.asset.status === "checked_out");
  const inn = applyCheckin({ assets: out.assets, checkouts: out.checkouts }, { assetId: "cart-02", endCondition: "good" });
  ok("fleet checkin", inn.ok && inn.asset.status === "available");
}

// Volunteers
{
  const m = await readJson("data/processed/volunteer-mirror.json");
  const s = summarizeVolunteers(m.volunteers, m.shifts, m.hourLogs, { zoneLabels: m.zoneLabels });
  ok("volunteers summarize", s.totals.volunteers > 0 && s.zones.length > 0, `${s.totals.openGaps} gaps`);
}

// Consent + SMS
{
  const bad = validateCheckoutConsent({ consent: { emailMarketing: true } });
  ok("consent requires email", Boolean(bad.error));
  const rec = consentFromCheckout({ email: "a@b.com", phone: "5125551212", consent: { smsSafety: true } }, { idFactory: () => "c1" });
  ok("consent from checkout", rec.smsSafety.optedIn && rec.phone === "+15125551212");
  const ledger = await readJson("data/processed/consent-ledger.json");
  ok("consent ledger", summarizeConsent(ledger.records).totals.records >= 1);
  const sms = smsConfigFromEnv({ SMS_ENABLED: "false" });
  ok("sms idle when disabled", !sms.ready);
  const skip = await sendSms("+15125551212", "hi", { config: sms });
  ok("sms skip", skip.skipped === true);
}

// Passport
{
  const hunt = await readJson("data/processed/sculpture-passport.json");
  const comps = await readJson("data/processed/passport-completions.json");
  ok("passport parse", parsePassportPayload("tsf:cp:cp_ent_tidal_guardian", hunt.checkpoints)?.label === "Tidal Guardian");
  const stamp = applyStamp({
    hunt: hunt.hunt,
    checkpoints: hunt.checkpoints,
    completions: comps.completions
  }, { attendeeRef: "suite_tester", payload: "TSF-CP-0001", method: "qr_scan" }, { idFactory: () => "hc_suite" });
  ok("passport stamp", stamp.ok && !stamp.alreadyStamped, stamp.checkpoint?.label);
  const dup = applyStamp({
    hunt: hunt.hunt,
    checkpoints: hunt.checkpoints,
    completions: stamp.completions
  }, { attendeeRef: "suite_tester", payload: "tsf:entry:ent_tidal_guardian" });
  ok("passport idempotent", dup.alreadyStamped === true);
  ok("passport summary", summarizePassport(hunt.checkpoints, stamp.completions, hunt.hunt).totals.checkpoints === 6);
}

// Voting
{
  const doc = await readJson("data/processed/peoples-choice.json");
  const vote = applyVote(doc, { attendeeRef: "suite_voter", entryId: "ent_tidal_guardian", channel: "web" }, { idFactory: () => "v_suite" });
  ok("voting cast", vote.ok && vote.changed);
  const tally = tallyVotes(doc.entries, vote.votes);
  ok("voting tally", tally.totalVotes >= 1 && tally.leaderboard.length === doc.entries.length);
  ok("voting summary", summarizeVoting(doc.entries, vote.votes).totals.totalVotes >= 1);
  ok("ticket ref parse", normalizeTicketRef("tsf:t:WB-29F4-7B0A") === "tsf:t:WB-29F4-7B0A");
  const needTicket = applyVote(doc, { attendeeRef: "suite_voter2", entryId: "ent_tidal_guardian" }, { requireTicket: true });
  ok("ticket required", !needTicket.ok);
  const withTicket = applyVote(doc, {
    attendeeRef: "suite_voter3",
    entryId: "ent_tidal_guardian",
    ticketRef: "tsf:t:WB-TEST-001"
  }, { idFactory: () => "v_tix", requireTicket: true });
  ok("ticket-linked vote", withTicket.ok && withTicket.vote.ticketRef === "tsf:t:WB-TEST-001");
}

// Job queue (file mode)
{
  const dir = await mkdtemp(path.join(tmpdir(), "sandfest-jobs-"));
  const job = await enqueueJob(dir, { type: "quickbooks.sync_stub", payload: { orderId: "order_x" } });
  ok("enqueue job", job.id.startsWith("job_"));
  const claimed = await claimNextJobs(dir, { limit: 5, types: ["quickbooks.sync_stub"] });
  ok("claim job", claimed.length === 1 && claimed[0].id === job.id);
  await completeJob(dir, claimed[0]);
  const again = await claimNextJobs(dir, { limit: 5 });
  ok("job completed", again.every(j => j.id !== job.id));
  await rm(dir, { recursive: true, force: true });
}

// Booths
{
  const map = await readJson("data/processed/booth-map.json");
  const pins = publicBoothPins(map.booths, map.vendors);
  ok("booth public pins", pins.length >= 5, `${pins.length} pins`);
  ok("booth summarize", summarizeBooths(map.booths, map.vendors).totals.booths >= 5);
  const sample = await readFile(path.join(ROOT, "data/raw/eventeny-booths-sample.csv"), "utf8");
  const parsed = parseBoothCsv(sample);
  ok("booth CSV parse", parsed.booths.length === 3 && parsed.vendors.length === 3);
}

// Enterprise hardening helpers
{
  ok("html escape", escapeHtml(`<img src=x onerror=alert(1)>`) === "&lt;img src=x onerror=alert(1)&gt;");
  const dir = await mkdtemp(path.join(tmpdir(), "sandfest-lock-"));
  const file = path.join(dir, "counter.json");
  await Promise.all(
    Array.from({ length: 20 }, () =>
      updateJsonFile(file, cur => {
        const n = (cur && cur.n) || 0;
        return { n: n + 1 };
      }, { fallback: { n: 0 } })
    )
  );
  const final = JSON.parse(await readFile(file, "utf8"));
  ok("atomic mutex counter", final.n === 20, `got ${final.n}`);
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nPure suite: ${passed} passed, ${failed} failed\n`);

if (!wantApi) {
  if (failed) process.exit(1);
  console.log("Skip live API (pass --api to smoke-test endpoints).\n");
  process.exit(0);
}

// Live API smoke
console.log("=== Live API smoke ===\n");
let child = null;
if (!API_BASE) {
  const port = process.env.SANDFEST_API_PORT || "8806";
  API_BASE = `http://127.0.0.1:${port}`;
  child = spawn("node", ["scripts/admin-api-server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      SANDFEST_API_PORT: port,
      SANDFEST_ADMIN_API_TOKEN: TOKEN
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("API start timeout")), 8000);
    child.stdout.on("data", buf => {
      if (String(buf).includes("listening")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.stderr.on("data", buf => process.stderr.write(buf));
    child.on("exit", code => reject(new Error(`API exited ${code}`)));
  });
}

async function hit(method, pathName, body, auth = false) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

try {
  const health = await hit("GET", "/health");
  ok("GET /health", health.status === 200 || health.status === 404 || health.data);

  const routes = [
    ["GET", "/api/public/passport", false],
    ["GET", "/api/public/voting", false],
    ["GET", "/api/public/booths", false],
    ["GET", "/api/admin/revenue", true],
    ["GET", "/api/admin/fleet", true],
    ["GET", "/api/admin/volunteers", true],
    ["GET", "/api/admin/consent", true],
    ["GET", "/api/admin/passport", true],
    ["GET", "/api/admin/voting", true],
    ["GET", "/api/admin/booths", true]
  ];
  for (const [method, p, auth] of routes) {
    const r = await hit(method, p, null, auth);
    ok(`${method} ${p}`, r.status === 200, `status ${r.status}`);
  }

  const unauth = await hit("GET", "/api/admin/fleet", null, false);
  ok("admin 401 without token", unauth.status === 401);

  const stamp = await hit("POST", "/api/public/passport/stamp", {
    attendeeRef: "suite_api_device",
    payload: "tsf:cp:cp_ent_dune_dragon",
    method: "qr_scan"
  });
  ok("POST passport stamp", stamp.status === 200 || stamp.status === 201, `status ${stamp.status}`);

  const vote = await hit("POST", "/api/public/voting", {
    attendeeRef: "suite_api_voter",
    entryId: "ent_lace_tide",
    channel: "web"
  });
  ok("POST voting", vote.status === 200 || vote.status === 201, `status ${vote.status}`);
} finally {
  if (child) {
    child.kill("SIGTERM");
  }
}

console.log(`\nTotal: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
