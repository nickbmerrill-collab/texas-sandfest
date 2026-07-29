#!/usr/bin/env node
// Texas SandFest board presentation: certified product, controlled activation.
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx");

const C = {
  deep: "12333A",
  gulf: "006D77",
  mist: "E7F2EF",
  sand: "F4DFAC",
  foam: "F8F5EC",
  coral: "E85D4A",
  ink: "172126",
  muted: "65747C",
  white: "FFFDF7",
  line: "D5CFC0"
};

const SLIDE_COUNT = 12;
const FOOTER = "Texas SandFest  ·  Confidential board briefing  ·  July 2026";
const GENERATED_AT = "2026-07-29T00:00:00Z";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Heyelab / Texas SandFest Platform";
pres.company = "Heyelab";
pres.subject = "Certified product, controlled activation, board decisions";
pres.title = "A Certified Festival Platform";
pres.lang = "en-US";
pres.theme = {
  headFontFace: "Georgia",
  bodyFontFace: "Calibri",
  lang: "en-US"
};

function addText(slide, text, options) {
  slide.addText(text, {
    fontFace: "Calibri",
    color: C.ink,
    margin: 0,
    fit: "shrink",
    breakLine: false,
    ...options
  });
}

function addFooter(slide, page) {
  addText(slide, FOOTER, {
    x: 0.5, y: 5.28, w: 7.7, h: 0.24,
    fontSize: 9.5, color: C.muted
  });
  addText(slide, `${page} / ${SLIDE_COUNT}`, {
    x: 8.55, y: 5.28, w: 0.95, h: 0.24,
    fontSize: 9.5, color: C.muted, align: "right"
  });
}

function addNotes(slide, body, sources = []) {
  slide.addNotes(`${body}\n[Sources]\n${sources.map(source => `- Internal: ${source}`).join("\n")}`);
}

function addBackground(slide, fill = C.foam) {
  slide.background = { color: fill };
}

function addSectionTitle(slide, title) {
  addText(slide, title, {
    x: 0.5, y: 0.32, w: 9, h: 0.5,
    fontFace: "Georgia", fontSize: 25, bold: true, color: C.deep
  });
}

function addCard(slide, { x, y, w, h, fill = C.white, accent = null }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: fill },
    line: { color: fill === C.deep ? C.deep : "E8E0D0", transparency: 8 },
    radius: 0.08
  });
  if (accent) {
    slide.addShape(pres.ShapeType.rect, {
      x, y, w: 0.12, h,
      fill: { color: accent },
      line: { color: accent }
    });
  }
}

function addPill(slide, label, { x, y, w, color = C.gulf }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h: 0.34,
    fill: { color },
    line: { color },
    radius: 0.08
  });
  addText(slide, label, {
    x, y: y + 0.07, w, h: 0.18,
    align: "center", fontSize: 9.5, bold: true, color: C.white
  });
}

function addNumber(slide, n, x, y) {
  slide.addShape(pres.ShapeType.ellipse, {
    x, y, w: 0.36, h: 0.36,
    fill: { color: C.gulf },
    line: { color: C.gulf }
  });
  addText(slide, String(n), {
    x, y: y + 0.07, w: 0.36, h: 0.16,
    align: "center", fontSize: 11, bold: true, color: C.white
  });
}

async function normalizeDeckPackage(file) {
  const zip = await JSZip.loadAsync(await readFile(file));
  const fixedDate = new Date(GENERATED_AT);
  const core = await zip.file("docProps/core.xml")?.async("string");
  if (core) {
    zip.file("docProps/core.xml", core.replace(
      /<dcterms:(created|modified) xsi:type="dcterms:W3CDTF">[^<]+<\/dcterms:\1>/g,
      (_match, tag) => `<dcterms:${tag} xsi:type="dcterms:W3CDTF">${GENERATED_AT}</dcterms:${tag}>`
    ), { date: fixedDate });
  }
  for (const entry of Object.values(zip.files)) entry.date = fixedDate;
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX"
  });
  await writeFile(file, buffer);
}

// 1
{
  const slide = pres.addSlide();
  addBackground(slide, C.deep);
  slide.addShape(pres.ShapeType.rect, { x: 0, y: 4.68, w: 10, h: 0.95, fill: { color: C.gulf }, line: { color: C.gulf } });
  slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 5.625, fill: { color: C.coral }, line: { color: C.coral } });
  addText(slide, "TEXAS SANDFEST", { x: 0.65, y: 1.2, w: 8.8, h: 0.35, fontSize: 13, bold: true, charSpacing: 3, color: C.sand });
  addText(slide, "A Certified Festival Platform", { x: 0.65, y: 1.72, w: 8.8, h: 0.8, fontFace: "Georgia", fontSize: 35, bold: true, color: C.white });
  addText(slide, "Board briefing — certified product, controlled activation, clear decisions", { x: 0.65, y: 2.68, w: 8.6, h: 0.35, fontSize: 15, color: C.sand });
  addText(slide, "Port Aransas  ·  Visitor experience  ·  Partner operations  ·  Event-day command", { x: 0.65, y: 4.92, w: 8.8, h: 0.3, fontSize: 12.5, color: C.white });
  addNotes(slide,
    "Open with the result: this is a working, certified operating platform.\nThe board decision is about the activation path, not whether the concept is technically possible.",
    [".sandfest-runtime/board-capability-certification.json", "README.md"]);
}

// 2
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "The product works; activation is the decision");
  [
    ["Working product", "The presentation stack now completes visitor, partner, staff, finance, document, and event-day workflows end to end."],
    ["Governed launch", "Production capabilities remain closed until the right account, source, policy, origin, and recovery evidence is present."],
    ["Board choice", "Move from feature debate to a controlled activation plan with accountable owners and one provider connected at a time."]
  ].forEach(([title, body], index) => {
    const x = 0.5 + index * 3.1;
    addCard(slide, { x, y: 1.24, w: 2.9, h: 3.25, accent: index === 2 ? C.coral : C.gulf });
    addText(slide, title, { x: x + 0.25, y: 1.56, w: 2.35, h: 0.36, fontFace: "Georgia", fontSize: 17, bold: true, color: C.deep });
    addText(slide, body, { x: x + 0.25, y: 2.12, w: 2.35, h: 1.65, fontSize: 13, color: C.ink, breakLine: false });
  });
  addFooter(slide, 2);
  addNotes(slide,
    "Frame the shift from product exploration to governed launch.\nThe product proof and the production controls are both part of the value proposition.",
    [".sandfest-runtime/board-capability-certification.json", "docs/deploy-runbook.md"]);
}

// 3
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "Control the hub; integrate proven systems");
  addCard(slide, { x: 0.55, y: 1.1, w: 8.9, h: 1.12, fill: C.deep });
  addText(slide, "Own the operating hub. Integrate proven providers. Build the SandFest experiences nobody else will.", {
    x: 0.9, y: 1.42, w: 8.2, h: 0.42, fontFace: "Georgia", fontSize: 18, bold: true, italic: true, color: C.sand, align: "center"
  });
  [
    ["KEEP", "Eventeny + existing systems", "Application, ticket, vendor, volunteer, and accounting source systems"],
    ["BUY", "Stripe · QB · Brevo · Twilio", "Payments, accounting, delivery, SMS, and maps after account activation"],
    ["BUILD", "SandFest web + API + iOS", "Visitor, partner, operations, finance, documents, and field command"],
    ["DEFER", "RFID / closed-loop cashless", "Keep QR/open-loop until network and ROI are proven"]
  ].forEach(([kind, title, body], index) => {
    const y = 2.62 + index * 0.56;
    addPill(slide, kind, { x: 0.65, y, w: 1.2, color: index === 3 ? C.coral : C.gulf });
    addText(slide, title, { x: 2.08, y: y + 0.03, w: 2.55, h: 0.24, fontSize: 12.5, bold: true, color: C.deep });
    addText(slide, body, { x: 4.7, y: y + 0.03, w: 4.65, h: 0.24, fontSize: 11.5, color: C.ink });
  });
  addFooter(slide, 3);
  addNotes(slide,
    "Emphasize that SandFest owns the operating truth while proven providers remain systems of record.\nThis model protects focus and avoids rebuilding commodity software.",
    ["docs/ultimate-festival-platform.md"]);
}

// 4
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "One system connects every experience");
  addCard(slide, { x: 3.22, y: 2.08, w: 3.56, h: 1.35, fill: C.deep });
  addText(slide, "SandFest Admin API\nSystem of record", { x: 3.48, y: 2.42, w: 3.04, h: 0.62, fontFace: "Georgia", fontSize: 18, bold: true, color: C.white, align: "center", breakLine: false });
  [
    ["Visitor", "Plan, buy, navigate, ask, vote, and get help", 0.55, 1.12],
    ["Partner", "Apply, pay, submit proof, and track readiness", 6.95, 1.12],
    ["Operations", "Revenue, budgets, work, documents, incidents", 0.55, 3.72],
    ["Field + iOS", "Fleet, QR, coverage, and live command", 6.95, 3.72]
  ].forEach(([title, body, x, y]) => {
    addCard(slide, { x, y, w: 2.55, h: 1.12 });
    addText(slide, title, { x: x + 0.2, y: y + 0.2, w: 2.15, h: 0.28, fontSize: 13.5, bold: true, color: C.gulf });
    addText(slide, body, { x: x + 0.2, y: y + 0.55, w: 2.15, h: 0.34, fontSize: 11.5, color: C.ink });
  });
  addFooter(slide, 4);
  addNotes(slide,
    "Walk clockwise: visitor, partner, operations, then field and iOS.\nAll four experiences share the same governed API and annual event context.",
    ["README.md"]);
}

// 5
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "Ten journeys prove the product end to end");
  const items = [
    ["01", "Certification gate", "10/10 journeys · Chromium 14/14 · WebKit 14/14 · baseline restored"],
    ["02", "Visitor + guest services", "Guidance, Ask Sandy, tickets, voting, and private help cases"],
    ["03", "Partners", "Sponsor/vendor intake, portal, branding, compliance, booth readiness"],
    ["04", "Finance", "Tickets, refunds, revenue, receivables, budgets, and exports"],
    ["05", "People + work", "Staff, volunteer, and team routing with a private mobile lifecycle"],
    ["06", "Outreach", "Qualified prospects, invitation conversion, and reviewed automation"],
    ["07", "Documents", "Private intake, extraction, review, audit, and checksum download"],
    ["08", "Event-day command", "Synthetic conditions, eight cameras, incidents, dispatch, recovery"]
  ];
  items.forEach(([number, title, body], index) => {
    const col = index < 4 ? 0 : 1;
    const row = index % 4;
    const x = 0.48 + col * 4.78;
    const y = 0.96 + row * 0.92;
    addCard(slide, { x, y, w: 4.45, h: 0.78 });
    addText(slide, number, { x: x + 0.16, y: y + 0.18, w: 0.44, h: 0.28, fontFace: "Georgia", fontSize: 15, bold: true, color: C.coral });
    addText(slide, title, { x: x + 0.7, y: y + 0.12, w: 3.5, h: 0.24, fontSize: 12.5, bold: true, color: C.deep });
    addText(slide, body, { x: x + 0.7, y: y + 0.4, w: 3.5, h: 0.24, fontSize: 10.5, color: C.muted });
  });
  addFooter(slide, 5);
  addNotes(slide,
    "This is the core evidence slide.\nCall out that every journey restores the same 12-of-12 baseline before the next journey begins.",
    [".sandfest-runtime/board-capability-certification.json"]);
}

// 6
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "What we will demonstrate to the board");
  [
    ["Visitor experience", "Plan Your Visit\nAsk Sandy + tickets\nMap, passport, and voting\nGuest Services follow-through"],
    ["Operations command", "Revenue + budget\nPartner readiness\nDelegated work + documents\nIncidents + communications"],
    ["Partner + field", "Sponsor/vendor portals\nPayments + proof\nVolunteer/fleet handoff\niOS visitor + admin modes"]
  ].forEach(([title, body], index) => {
    const x = 0.55 + index * 3.12;
    addCard(slide, { x, y: 1.16, w: 2.9, h: 3.45, fill: index === 1 ? C.deep : C.white });
    addText(slide, title, { x: x + 0.22, y: 1.48, w: 2.46, h: 0.35, fontFace: "Georgia", fontSize: 16.5, bold: true, color: index === 1 ? C.sand : C.gulf });
    addText(slide, body, { x: x + 0.22, y: 2.12, w: 2.46, h: 1.75, fontSize: 13.2, color: index === 1 ? C.white : C.ink, breakLine: false });
  });
  addFooter(slide, 6);
  addNotes(slide,
    "Use these columns as the live demo route.\nKeep the walkthrough outcome-oriented: show the closed loops, not every control.",
    ["docs/board-runtime.md", "README.md"]);
}

// 7
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "What is certified now—and what stays gated");
  [
    ["Board presentation stack", "Certified now", C.gulf],
    ["Synthetic provider safeguards", "Board-safe", C.gulf],
    ["Deployed-site acceptance", "deployment:verify:site", C.gulf],
    ["Payments + accounting", "Post-board gate", C.coral],
    ["Communications", "Post-board gate", C.coral],
    ["Public protection", "Post-board gate", C.coral],
    ["Native distribution", "Account-owned gate", C.coral],
    ["Recovery + public cutover", "Release gate", C.coral]
  ].forEach(([title, status, color], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.6 + col * 4.55;
    const y = 1.05 + row * 0.82;
    addCard(slide, { x, y, w: 4.25, h: 0.62, accent: color });
    addText(slide, title, { x: x + 0.27, y: y + 0.14, w: 2.4, h: 0.22, fontSize: 12.2, bold: true, color: C.deep });
    addText(slide, status, { x: x + 2.82, y: y + 0.14, w: 1.15, h: 0.22, fontSize: 10.5, bold: true, color, align: "right" });
  });
  addFooter(slide, 7);
  addNotes(slide,
    "State the boundary plainly: the board demo is real product behavior with synthetic providers.\nNo external message, charge, live feed, or production claim is required for the presentation; deployed previews use deployment:verify:site.",
    [".sandfest-runtime/board-capability-certification.json", "docs/deploy-runbook.md"]);
}

// 8
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "Certified demo to controlled production");
  [
    ["Board-ready now", "10-journey certificate ✓\nVisitor + Operations ✓\nPartner handoffs ✓\nDocuments + incidents ✓\nSynthetic providers ✓"],
    ["Post-board activation", "Managed data plane\nOIDC + Turnstile\nStripe / QB / Brevo / Twilio\nDomain + Apple signing\nProvider acceptance"],
    ["Operational cutover", "Approved 2027 content\nReal roster/vendor imports\nStaff training + runbook\nRecovery drill\nLive cameras when approved"]
  ].forEach(([title, body], index) => {
    const x = 0.55 + index * 3.12;
    addCard(slide, { x, y: 1.05, w: 2.9, h: 3.6, fill: index === 0 ? C.mist : C.white, accent: index === 0 ? C.gulf : C.coral });
    addText(slide, title, { x: x + 0.22, y: 1.28, w: 2.45, h: 0.28, fontSize: 13.4, bold: true, color: C.deep });
    addText(slide, body, { x: x + 0.22, y: 1.78, w: 2.45, h: 2.25, fontSize: 12.5, color: C.ink, breakLine: false });
  });
  addFooter(slide, 8);
  addNotes(slide,
    "The activation sequence is intentionally staged.\nEach provider earns production enablement through its own account, configuration, and acceptance proof.",
    ["docs/deploy-runbook.md", "docs/ultimate-festival-platform.md"]);
}

// 9
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "Board decisions that unlock the next stage");
  addText(slide, "Accounts and source documents remain with SandFest; activation proceeds one capability at a time.", {
    x: 0.5, y: 0.84, w: 9, h: 0.28, fontSize: 11.5, color: C.muted, italic: true
  });
  [
    ["Account owners", "Providers, Apple, domain, and recovery"],
    ["Deployment approval", "Managed API, Postgres, and private storage"],
    ["Production identity", "OIDC tenant, admin roles, and recovery owner"],
    ["Public protection", "Turnstile, production origins, and callbacks"],
    ["Authoritative documents", "Sponsor, vendor, budget, map, and permit sources"],
    ["Content approval", "2027 facts, policies, guidance, roster, schedule"],
    ["Native release", "Apple agreement, prefix, profile, and AASA"],
    ["Event resilience", "Connectivity, cameras, and safety sign-off"]
  ].forEach(([title, body], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.55 + col * 4.65;
    const y = 1.32 + row * 0.78;
    addCard(slide, { x, y, w: 4.3, h: 0.62 });
    addText(slide, title, { x: x + 0.2, y: y + 0.12, w: 3.8, h: 0.2, fontSize: 11.8, bold: true, color: C.deep });
    addText(slide, body, { x: x + 0.2, y: y + 0.34, w: 3.8, h: 0.18, fontSize: 10.4, color: C.muted });
  });
  addFooter(slide, 9);
  addNotes(slide,
    "Ask for owners and approvals, not passwords in the meeting.\nSource documents remain private and enter the governed ingestion workflow after the board session.",
    ["docs/incoming-access-intake.md", "docs/deploy-runbook.md"]);
}

// 10
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "Explicit gates control the remaining risk");
  [
    ["Live-provider exposure", "Every integration stays disabled until credentials, callbacks, origins, and acceptance evidence are complete."],
    ["Data + privacy", "Public APIs expose approved fields only; private files, contacts, tokens, and review notes stay governed."],
    ["Event-day resilience", "Offline-safe visitor experiences and a supervised stack protect the demo; recovery drills gate production."],
    ["Change control", "Source drift, dirty code, stale certificates, or incomplete baseline restoration block presentation and release."]
  ].forEach(([title, body], index) => {
    const y = 1.05 + index * 0.9;
    addCard(slide, { x: 0.55, y, w: 8.9, h: 0.72, accent: index === 0 ? C.coral : C.gulf });
    addText(slide, title, { x: 0.88, y: y + 0.12, w: 8.2, h: 0.22, fontSize: 12.8, bold: true, color: C.deep });
    addText(slide, body, { x: 0.88, y: y + 0.38, w: 8.2, h: 0.2, fontSize: 11.3, color: C.ink });
  });
  addFooter(slide, 10);
  addNotes(slide,
    "Connect each risk to the gate that contains it.\nThe platform is designed to make incomplete launch evidence visible instead of silently degrading.",
    ["README.md", "docs/deploy-runbook.md"]);
}

// 11
{
  const slide = pres.addSlide();
  addBackground(slide);
  addSectionTitle(slide, "Five board decisions move the product forward");
  const decisions = [
    "Endorse SandFest as the operating hub while retaining proven systems of record.",
    "Approve the staged post-board activation plan and managed production foundation.",
    "Assign owners for provider accounts, identity, DNS, Apple signing, and recovery.",
    "Authorize collection and review of current finance, partner, schedule, map, permit, and policy sources.",
    "Keep RFID, closed-loop cashless, and unapproved providers deferred until evidence supports activation."
  ];
  decisions.forEach((decision, index) => {
    const y = 1.02 + index * 0.68;
    addNumber(slide, index + 1, 0.62, y + 0.04);
    addText(slide, decision, { x: 1.18, y, w: 8.2, h: 0.42, fontSize: 13.5, color: C.ink });
  });
  addFooter(slide, 11);
  addNotes(slide,
    "Pause on this slide and secure explicit agreement for each item.\nCapture one accountable owner and next date for every approved activation category.",
    ["docs/ultimate-festival-platform.md", "docs/deploy-runbook.md"]);
}

// 12
{
  const slide = pres.addSlide();
  addBackground(slide, C.deep);
  slide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 5.625, fill: { color: C.coral }, line: { color: C.coral } });
  addText(slide, "Board decision", { x: 0.72, y: 1.26, w: 8.6, h: 0.35, fontSize: 13, bold: true, charSpacing: 2, color: C.sand });
  addText(slide, "Approve the activation path. Move from certified demo to controlled production.", {
    x: 0.72, y: 1.88, w: 8.65, h: 0.92, fontFace: "Georgia", fontSize: 27, bold: true, color: C.white
  });
  addText(slide, "Proof: 10/10 journeys · Chromium 14/14 · WebKit 14/14 · 12/12 readiness", {
    x: 0.72, y: 3.22, w: 8.5, h: 0.28, fontSize: 13.2, color: C.sand
  });
  addText(slide, "Deployed preview gate: deployment:verify:site", {
    x: 0.72, y: 3.58, w: 8.5, h: 0.28, fontSize: 13.2, bold: true, color: C.sand
  });
  addText(slide, "Runbook: docs/board-runtime.md · docs/deploy-runbook.md\nBlueprint: docs/ultimate-festival-platform.md", {
    x: 0.72, y: 4.14, w: 8.5, h: 0.56, fontSize: 12.2, color: C.white, breakLine: false
  });
  addNotes(slide,
    "Close by tying the requested decision back to the verified proof.\nAfter approval, activate one provider at a time and preserve the same fail-closed acceptance discipline.",
    [".sandfest-runtime/board-capability-certification.json", "docs/board-runtime.md", "docs/deploy-runbook.md"]);
}

await pres.writeFile({ fileName: OUT });
await normalizeDeckPackage(OUT);
console.log(`Wrote ${OUT}`);
