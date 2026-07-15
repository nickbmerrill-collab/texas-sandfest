#!/usr/bin/env node
// Texas SandFest board presentation — coastal brand palette.
import pptxgen from "pptxgenjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx");

const C = {
  deep: "12333A",
  gulf: "006D77",
  sand: "F4DFAC",
  foam: "F8F5EC",
  coral: "E85D4A",
  sun: "F7B733",
  ink: "172126",
  muted: "65747C",
  white: "FFFDF7",
  line: "D5CFC0"
};

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Heyelab / Texas SandFest Platform";
pres.title = "Texas SandFest — Ultimate Festival Platform Board Briefing";
pres.subject = "Build vs buy roadmap, shipped capabilities, budget asks";

function footer(slide, page, total = 12) {
  slide.addText("Texas SandFest  ·  Confidential board briefing  ·  July 2026", {
    x: 0.5, y: 5.28, w: 7.5, h: 0.25,
    fontSize: 10, fontFace: "Calibri", color: C.muted, margin: 0
  });
  slide.addText(`${page} / ${total}`, {
    x: 8.5, y: 5.28, w: 1, h: 0.25,
    fontSize: 10, fontFace: "Calibri", color: C.muted, align: "right", margin: 0
  });
}

// 1 — Title
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.deep } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 4.6, w: 10, h: 1.025, fill: { color: C.gulf } });
  s.addText("TEXAS SANDFEST", {
    x: 0.6, y: 1.3, w: 8.8, h: 0.4,
    fontSize: 14, fontFace: "Calibri", color: C.sand, bold: true, charSpacing: 4, margin: 0
  });
  s.addText("The Ultimate Festival Platform", {
    x: 0.6, y: 1.8, w: 8.8, h: 0.9,
    fontSize: 36, fontFace: "Georgia", color: C.white, bold: true, margin: 0
  });
  s.addText("Board briefing — what we own, what we buy, what’s shipping for 2026–27", {
    x: 0.6, y: 2.85, w: 8.5, h: 0.45,
    fontSize: 16, fontFace: "Calibri", color: C.sand, margin: 0
  });
  s.addText("Port Aransas  ·  3-day beach festival  ·  100,000+ visitors  ·  lean nonprofit ops", {
    x: 0.6, y: 4.85, w: 8.8, h: 0.35,
    fontSize: 13, fontFace: "Calibri", color: C.white, margin: 0
  });
}

// 2 — Why this matters
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Why the board is here", {
    x: 0.5, y: 0.35, w: 9, h: 0.5,
    fontSize: 28, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const cards = [
    { t: "Scale", d: "100k+ guests on a beach corridor. Spreadsheets and radio alone don’t scale to live ops + revenue + safety messaging." },
    { t: "Fragmentation", d: "Eventeny, Stripe, QuickBooks, radio, Wix, and ad-hoc tools each hold a piece of the truth — nobody has one dashboard." },
    { t: "Opportunity", d: "Own the hub (our app + API). Buy commodity SaaS. Build only differentiators: map, passport, fleet, ops coverage, consent." }
  ];
  cards.forEach((c, i) => {
    const x = 0.5 + i * 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 1.2, w: 2.95, h: 3.4,
      fill: { color: C.white }, rectRadius: 0.12,
      shadow: { type: "outer", color: "000000", blur: 8, opacity: 0.08, offset: 2 }
    });
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.2, w: 2.95, h: 0.12, fill: { color: i === 2 ? C.coral : C.gulf } });
    s.addText(c.t, {
      x: x + 0.2, y: 1.55, w: 2.55, h: 0.45,
      fontSize: 18, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
    });
    s.addText(c.d, {
      x: x + 0.2, y: 2.15, w: 2.55, h: 2.1,
      fontSize: 13, fontFace: "Calibri", color: C.ink, margin: 0
    });
  });
  footer(s, 2);
}

// 3 — Operating principle
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Operating principle", {
    x: 0.5, y: 0.35, w: 9, h: 0.5,
    fontSize: 28, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 1.1, w: 9, h: 1.4,
    fill: { color: C.deep }, rectRadius: 0.1
  });
  s.addText("Own the hub. Buy the point solutions. Build only the glue and the differentiators.", {
    x: 0.8, y: 1.4, w: 8.4, h: 0.8,
    fontSize: 20, fontFace: "Georgia", color: C.sand, italic: true, margin: 0
  });
  const rows = [
    ["KEEP", "Eventeny", "Ticketing, vendor apps, COI, booth fees, sponsor tiers (~80% already owned)"],
    ["BUY", "VolunteerLocal, Brevo, Zello, Fathom…", "Volunteer signup, email/SMS marketing, PoC comms, analytics"],
    ["BUILD", "Our Node + web + iOS", "Revenue ledger, map, passport, fleet, ops coverage, consent hub"],
    ["DEFER", "RFID / closed-loop cashless", "QR entry + open-loop tap-to-pay until network + ROI proven"]
  ];
  rows.forEach((r, i) => {
    const y = 2.8 + i * 0.52;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5, y, w: 1.35, h: 0.42,
      fill: { color: i === 3 ? C.coral : C.gulf }, rectRadius: 0.06
    });
    s.addText(r[0], {
      x: 0.5, y, w: 1.35, h: 0.42,
      fontSize: 11, fontFace: "Calibri", color: C.white, bold: true, align: "center", valign: "middle", margin: 0
    });
    s.addText(r[1], {
      x: 2.0, y, w: 2.6, h: 0.42,
      fontSize: 13, fontFace: "Calibri", color: C.deep, bold: true, valign: "middle", margin: 0
    });
    s.addText(r[2], {
      x: 4.6, y, w: 4.9, h: 0.42,
      fontSize: 12, fontFace: "Calibri", color: C.ink, valign: "middle", margin: 0
    });
  });
  footer(s, 3);
}

// 4 — Platform as hub
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("One hub — three experiences", {
    x: 0.5, y: 0.35, w: 9, h: 0.5,
    fontSize: 28, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  // center hub
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.2, y: 2.0, w: 3.6, h: 1.6,
    fill: { color: C.deep }, rectRadius: 0.12
  });
  s.addText("Node Admin API\nSystem of record", {
    x: 3.35, y: 2.35, w: 3.3, h: 1.0,
    fontSize: 16, fontFace: "Georgia", color: C.white, align: "center", bold: true, margin: 0
  });
  const outs = [
    { x: 0.5, y: 1.1, t: "Public Web", d: "Visitor site, tickets, map, passport, votes" },
    { x: 6.9, y: 1.1, t: "iOS App", d: "Attendee + QR + Admin fleet & ops" },
    { x: 0.5, y: 3.9, t: "Ops Console", d: "Revenue, coverage, fleet, alerts" },
    { x: 6.9, y: 3.9, t: "External feeds", d: "Eventeny · Stripe · QB · Twilio" }
  ];
  outs.forEach(o => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: o.x, y: o.y, w: 2.6, h: 1.15,
      fill: { color: C.white }, rectRadius: 0.1
    });
    s.addText(o.t, {
      x: o.x + 0.15, y: o.y + 0.18, w: 2.3, h: 0.35,
      fontSize: 14, fontFace: "Calibri", color: C.gulf, bold: true, margin: 0
    });
    s.addText(o.d, {
      x: o.x + 0.15, y: o.y + 0.55, w: 2.3, h: 0.45,
      fontSize: 12, fontFace: "Calibri", color: C.ink, margin: 0
    });
  });
  footer(s, 4);
}

// 5 — What's shipping
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Shipped this cycle (verified)", {
    x: 0.5, y: 0.3, w: 9, h: 0.45,
    fontSize: 26, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const items = [
    ["01", "Revenue ledger", "One dashboard: Stripe / Eventeny / Square / manual → fees + bank reconciliation"],
    ["02", "Sculptors + corridor map", "Roster, filters, illustrated beach map (no map token required)"],
    ["03", "Sculpture Passport", "QR stamps web + iOS + server progress + prize finisher path"],
    ["04", "Fleet checkout", "Golf carts / UTVs / generators — QR check-out/in, ops panel, iOS Admin tab"],
    ["05", "Volunteer coverage", "Mirror of VolunteerLocal → zone fill vs needed + understaffed board"],
    ["06", "Consent + SMS scaffold", "Separate email / promo SMS / safety SMS; Twilio ready when keys arrive"],
    ["07", "People’s Choice", "One vote per device, live tallies, admin leaderboard"],
    ["08", "Booth / vendor map", "Public pins from Eventeny-shaped CSV; import script ready"]
  ];
  items.forEach((it, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x = 0.45 + col * 4.8;
    const y = 0.95 + row * 0.95;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 4.55, h: 0.85,
      fill: { color: C.white }, rectRadius: 0.08
    });
    s.addText(it[0], {
      x: x + 0.15, y: y + 0.18, w: 0.5, h: 0.5,
      fontSize: 16, fontFace: "Georgia", color: C.coral, bold: true, margin: 0
    });
    s.addText(it[1], {
      x: x + 0.7, y: y + 0.12, w: 3.6, h: 0.32,
      fontSize: 13, fontFace: "Calibri", color: C.deep, bold: true, margin: 0
    });
    s.addText(it[2], {
      x: x + 0.7, y: y + 0.42, w: 3.6, h: 0.35,
      fontSize: 11, fontFace: "Calibri", color: C.muted, margin: 0
    });
  });
  footer(s, 5);
}

// 6 — Live product demo map
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("What the board can open today", {
    x: 0.5, y: 0.35, w: 9, h: 0.45,
    fontSize: 26, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const demos = [
    { title: "Visitor web", body: "Visitor / Operations toggle\nTickets + consent opt-ins\nSculptors, passport, votes\nVendor booth map" },
    { title: "Ops console", body: "Revenue KPIs\nFleet check-out/in\nVolunteer coverage gaps\nPassport & vote stats" },
    { title: "iOS app", body: "Customer: Beach + Sculptors\nAdmin: Fleet + Command\nQR scanner for stamps &\ncart checkout" }
  ];
  demos.forEach((d, i) => {
    const x = 0.5 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 1.15, w: 3.0, h: 3.5,
      fill: { color: i === 1 ? C.deep : C.white }, rectRadius: 0.12
    });
    s.addText(d.title, {
      x: x + 0.2, y: 1.4, w: 2.6, h: 0.45,
      fontSize: 18, fontFace: "Georgia", color: i === 1 ? C.sand : C.gulf, bold: true, margin: 0
    });
    s.addText(d.body, {
      x: x + 0.2, y: 2.05, w: 2.6, h: 2.2,
      fontSize: 14, fontFace: "Calibri", color: i === 1 ? C.white : C.ink, margin: 0
    });
  });
  footer(s, 6);
}

// 7 — Budget
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Budget snapshot (verify before FY commit)", {
    x: 0.5, y: 0.3, w: 9, h: 0.45,
    fontSize: 24, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const budget = [
    ["Marketing / analytics / comms SaaS", "~$50–90 / mo + ads"],
    ["VolunteerLocal (or Track It Forward)", "~$200–800 / event"],
    ["Mapbox (free tier at event scale)", "~$0 typical"],
    ["On-site connectivity (dominant line)", "$10–35k rented weekend"],
    ["Fleet GPS trackers (LoRaWAN)", "~$30–80 / unit one-time"],
    ["SMS (Twilio) full 100k safety blast", "~$1,100 / blast"],
    ["RFID / closed-loop cashless", "$0 now (deferred)"]
  ];
  budget.forEach((b, i) => {
    const y = 0.95 + i * 0.5;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.45,
      fill: { color: i % 2 === 0 ? C.white : "F0EBE0" }
    });
    s.addText(b[0], {
      x: 0.7, y, w: 5.8, h: 0.45,
      fontSize: 13, fontFace: "Calibri", color: C.ink, valign: "middle", margin: 0
    });
    s.addText(b[1], {
      x: 6.5, y, w: 2.8, h: 0.45,
      fontSize: 13, fontFace: "Calibri", color: C.gulf, bold: true, align: "right", valign: "middle", margin: 0
    });
  });
  footer(s, 7);
}

// 8 — Phased roadmap
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Roadmap — foundations first", {
    x: 0.5, y: 0.3, w: 9, h: 0.45,
    fontSize: 26, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const phases = [
    { title: "Phase 0 — Now", items: "Revenue ledger ✓\nConsent capture ✓\nCanonical schema ✓\nAccess intake ✓\nConnectivity quotes", color: C.gulf },
    { title: "Phase 1 — Event ’27", items: "Passport + voting ✓\nFleet checkout ✓\nVolunteer mirror ✓\nBooth map ✓\nTwilio live (blocked)\nMapbox GPS (blocked)", color: C.deep },
    { title: "Phase 2 — 2027+", items: "Site cutover from Wix\nZello PoC + radio\nRFID re-evaluate\nCashless re-evaluate\nIncident CAD if needed", color: C.coral }
  ];
  phases.forEach((p, i) => {
    const x = 0.5 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 1.05, w: 3.0, h: 3.7,
      fill: { color: C.white }, rectRadius: 0.1
    });
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.05, w: 3.0, h: 0.55, fill: { color: p.color } });
    s.addText(p.title, {
      x: x + 0.15, y: 1.15, w: 2.7, h: 0.4,
      fontSize: 14, fontFace: "Calibri", color: C.white, bold: true, margin: 0
    });
    s.addText(p.items, {
      x: x + 0.2, y: 1.85, w: 2.6, h: 2.6,
      fontSize: 13, fontFace: "Calibri", color: C.ink, margin: 0
    });
  });
  footer(s, 8);
}

// 9 — What we need
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Board asks — unblock Phase 1", {
    x: 0.5, y: 0.3, w: 9, h: 0.45,
    fontSize: 26, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  s.addText("No secrets in chat — use password manager + git-ignored .env (see docs/incoming-access-intake.md)", {
    x: 0.5, y: 0.85, w: 9, h: 0.35,
    fontSize: 12, fontFace: "Calibri", color: C.muted, italic: true, margin: 0
  });
  const asks = [
    ["Stripe admin + keys", "Live revenue ledger + owned checkout"],
    ["Eventeny admin", "Ticket/vendor/booth CSV sync"],
    ["QuickBooks Online", "Classes + clearing-account reconciliation"],
    ["Twilio SID + token", "Ticket SMS + safety alerts"],
    ["Mapbox token", "Real GPS sculpture / booth map"],
    ["Domain + Wix host", "Public site overhaul / cutover plan"],
    ["VolunteerLocal decision", "Buy signup engine; we mirror coverage"],
    ["Connectivity quote approval", "Rent Starlink + mesh for event weekend"]
  ];
  asks.forEach((a, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x = 0.5 + col * 4.75;
    const y = 1.35 + row * 0.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 4.5, h: 0.72,
      fill: { color: C.white }, rectRadius: 0.08
    });
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.15, y: y + 0.2, w: 0.32, h: 0.32,
      fill: { color: C.coral }
    });
    s.addText(a[0], {
      x: x + 0.6, y: y + 0.1, w: 3.7, h: 0.28,
      fontSize: 13, fontFace: "Calibri", color: C.deep, bold: true, margin: 0
    });
    s.addText(a[1], {
      x: x + 0.6, y: y + 0.38, w: 3.7, h: 0.25,
      fontSize: 11, fontFace: "Calibri", color: C.muted, margin: 0
    });
  });
  footer(s, 9);
}

// 10 — Risks
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Risks we are managing", {
    x: 0.5, y: 0.35, w: 9, h: 0.45,
    fontSize: 26, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const risks = [
    ["Connectivity", "Beach cell dies under crowd load. Rent managed network year 1; offline-first apps already designed."],
    ["Scope creep", "Do not rebuild Eventeny or VolunteerLocal. Hub + glue only."],
    ["SMS compliance", "A2P 10DLC + separate marketing vs safety campaigns before any blast."],
    ["Credential lag", "Live feeds stay seeded until logins arrive — demos work either way."]
  ];
  risks.forEach((r, i) => {
    const y = 1.05 + i * 0.95;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.85,
      fill: { color: C.white }, rectRadius: 0.08
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 0.14, h: 0.85,
      fill: { color: i === 1 ? C.coral : C.gulf }
    });
    s.addText(r[0], {
      x: 0.9, y: y + 0.12, w: 8.3, h: 0.3,
      fontSize: 14, fontFace: "Calibri", color: C.deep, bold: true, margin: 0
    });
    s.addText(r[1], {
      x: 0.9, y: y + 0.42, w: 8.3, h: 0.35,
      fontSize: 13, fontFace: "Calibri", color: C.ink, margin: 0
    });
  });
  footer(s, 10);
}

// 11 — Decision
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.foam } });
  s.addText("Proposed board decisions", {
    x: 0.5, y: 0.35, w: 9, h: 0.45,
    fontSize: 26, fontFace: "Georgia", color: C.deep, bold: true, margin: 0
  });
  const decisions = [
    "Endorse the hub model: keep Eventeny; do not rebuild vendor/ticketing SaaS.",
    "Authorize Phase 1 build labor already in progress on feature/ultimate-festival-platform.",
    "Approve outreach for connectivity rental quotes (Festival WiFi / equivalent).",
    "Assign owners for each login in the access registry (Stripe, Eventeny, QB, Twilio, domain).",
    "Defer RFID and closed-loop cashless for 2026; revisit after network + 2027 attendance data."
  ];
  decisions.forEach((d, i) => {
    const y = 1.05 + i * 0.7;
    s.addShape(pres.shapes.OVAL, {
      x: 0.55, y: y + 0.08, w: 0.4, h: 0.4,
      fill: { color: C.gulf }
    });
    s.addText(String(i + 1), {
      x: 0.55, y: y + 0.08, w: 0.4, h: 0.4,
      fontSize: 14, fontFace: "Calibri", color: C.white, bold: true, align: "center", valign: "middle", margin: 0
    });
    s.addText(d, {
      x: 1.15, y: y, w: 8.2, h: 0.55,
      fontSize: 14, fontFace: "Calibri", color: C.ink, valign: "middle", margin: 0
    });
  });
  footer(s, 11);
}

// 12 — Close
{
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.deep } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.2, h: 5.625, fill: { color: C.coral } });
  s.addText("Next step", {
    x: 0.7, y: 1.5, w: 8.5, h: 0.4,
    fontSize: 14, fontFace: "Calibri", color: C.sand, bold: true, charSpacing: 2, margin: 0
  });
  s.addText("Grant access. We light up live money, maps, and SMS.", {
    x: 0.7, y: 2.05, w: 8.5, h: 1.0,
    fontSize: 28, fontFace: "Georgia", color: C.white, bold: true, margin: 0
  });
  s.addText("Blueprint: docs/ultimate-festival-platform.md\nAccess intake: docs/incoming-access-intake.md\nBranch: feature/ultimate-festival-platform (not yet pushed)", {
    x: 0.7, y: 3.4, w: 8.5, h: 1.0,
    fontSize: 14, fontFace: "Calibri", color: C.sand, margin: 0
  });
}

await pres.writeFile({ fileName: OUT });
console.log(`Wrote ${OUT}`);
