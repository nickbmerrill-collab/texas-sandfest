import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const VAULT = path.join(ROOT, "Texas SandFest Vault");
const PROCESSED = path.join(ROOT, "data", "processed");
const INCOMING = path.join(ROOT, "data", "incoming");

const pages = uniqueBy(await readJson(path.join(PROCESSED, "pages.json")), page => normalizeSourceUrl(page.url));
const summary = await readJson(path.join(PROCESSED, "crawl-summary.json"));
const knowledgeBase = await readJson(path.join(PROCESSED, "knowledge-base.json"));
const processMap = await readJson(path.join(PROCESSED, "process-map.json"));
const links = await readJson(path.join(PROCESSED, "links.json"));
const images = await readJson(path.join(PROCESSED, "images.json"));
const publicReport = await readText(path.join(PROCESSED, "public-ingestion-report.md"));
const improvementNotes = await readText(path.join(PROCESSED, "process-improvement-notes.md"));

await createVaultFolders();
await writeObsidianConfig();
await writeCoreNotes();
await writeSourceNotes();
await writeCanonicalNotes();
await writeWorkflowNotes();
await writeIngestionNotes();
await writeTemplateNotes();
await copyPlanningDocs();

console.log(`Obsidian vault ready: ${VAULT}`);
console.log(`Pages indexed: ${pages.length}`);
console.log(`Incoming drop folders linked: ${INCOMING}`);

async function createVaultFolders() {
  const folders = [
    ".obsidian",
    "00 - Start Here",
    "01 - Sources/Public Website",
    "01 - Sources/Documents",
    "02 - Canonical/Event",
    "02 - Canonical/Policies",
    "02 - Canonical/Map and Zones",
    "02 - Canonical/Sponsors",
    "02 - Canonical/Finance",
    "02 - Canonical/People and Orgs",
    "03 - Workflows",
    "04 - Ingestion Inbox/Eventeny",
    "04 - Ingestion Inbox/Documents",
    "04 - Ingestion Inbox/Ops",
    "04 - Ingestion Inbox/Finance",
    "04 - Ingestion Inbox/QuickBooks",
    "04 - Ingestion Inbox/Comms",
    "05 - Reports",
    "06 - Templates",
    "07 - Product Planning",
    "99 - Attachments"
  ];

  for (const folder of folders) {
    await mkdir(path.join(VAULT, folder), { recursive: true });
  }
}

async function writeObsidianConfig() {
  await writeJson(path.join(VAULT, ".obsidian", "app.json"), {
    attachmentFolderPath: "99 - Attachments",
    newFileLocation: "current",
    newLinkFormat: "relative",
    alwaysUpdateLinks: true
  });
  await writeJson(path.join(VAULT, ".obsidian", "core-plugins.json"), [
    "file-explorer",
    "global-search",
    "switcher",
    "graph",
    "backlink",
    "canvas",
    "outgoing-link",
    "tag-pane",
    "page-preview",
    "daily-notes",
    "templates",
    "note-composer",
    "command-palette",
    "bookmarks",
    "outline"
  ]);
  await writeJson(path.join(VAULT, ".obsidian", "templates.json"), {
    folder: "06 - Templates"
  });
  await writeJson(path.join(VAULT, ".obsidian", "workspace.json"), {
    main: {
      id: "sandfest-main",
      type: "split",
      children: []
    },
    left: { id: "sandfest-left", type: "split", children: [] },
    right: { id: "sandfest-right", type: "split", children: [] },
    active: "sandfest-main"
  });
}

async function writeCoreNotes() {
  await writeNote("00 - Start Here/Start Here.md", `# Texas SandFest Vault

This vault is the working knowledge base for the Texas SandFest AI platform, iOS app, operations console, and future Port A Local Co integration.

## Current Baseline

- [[Public Ingestion Report]]
- [[Crawl Summary]]
- [[Texas SandFest 2026]]
- [[Process Improvement Notes]]
- [[Architecture]]
- [[iOS App Plan]]
- [[Port A Local Co Integration]]

## Incoming Data Pipeline

Drop new files into:

- \`${relative(INCOMING, "eventeny")}\` for Eventeny exports.
- \`${relative(INCOMING, "docs")}\` for PDFs, packets, spreadsheets, contracts, maps, and board docs.
- \`${relative(INCOMING, "ops")}\` for staffing plans, radio plans, site maps, incident logs, weather plans, and city coordination.
- \`${relative(INCOMING, "finance")}\` for sponsor invoices, donations, raffle exports, costs, and vendor fees.
- \`${relative(INCOMING, "comms")}\` for email templates, SMS copy, press drafts, FAQ drafts, and social calendars.

Then run:

\`\`\`bash
npm run vault:build
\`\`\`

## Review Rule

Public scrape data is evidence, not truth. Promote facts into \`02 - Canonical\` only after assigning an owner, source, effective date, and review status.
`);

  await writeNote("05 - Reports/Crawl Summary.md", `# Crawl Summary

Generated: ${summary.fetchedAt}

| Metric | Value |
| --- | ---: |
| Pages scraped | ${summary.pageCount} |
| Successful pages | ${summary.successfulPages} |
| Failed pages | ${summary.failedPages} |
| SandFest Eventeny handoff links | ${summary.sandfestEventenyLinks?.length || 0} |
| Documents found | ${summary.documents.length} |

## Page Categories

${Object.entries(summary.byCategory).map(([category, urls]) => `- ${titleCase(category)}: ${urls.length}`).join("\n")}

## Documents

${summary.documents.map(url => `- ${url}`).join("\n")}

## SandFest Eventeny Links

${(summary.sandfestEventenyLinks || []).map(url => `- ${url}`).join("\n")}
`);

  await writeNote("05 - Reports/Public Ingestion Report.md", addAliases(publicReport, "Public Ingestion Report"));
  await writeNote("05 - Reports/Process Improvement Notes.md", addAliases(improvementNotes, "Process Improvement Notes"));
}

async function writeSourceNotes() {
  const pagesByCategory = groupBy(pages.filter(page => !page.error), page => page.category || "uncategorized");
  const titleCounts = pages.filter(page => !page.error).reduce((counts, page) => {
    const title = baseSourceTitle(page);
    counts[title] = (counts[title] || 0) + 1;
    return counts;
  }, {});
  const indexLines = [];

  for (const [category, categoryPages] of Object.entries(pagesByCategory).sort()) {
    indexLines.push(`## ${titleCase(category)}`);
    for (const page of categoryPages.sort((a, b) => a.url.localeCompare(b.url))) {
      const noteTitle = sourceTitle(page, titleCounts);
      const notePath = `01 - Sources/Public Website/${noteTitle}.md`;
      indexLines.push(`- [[${noteTitle}]]`);
      await writeNote(notePath, sourcePageMarkdown(page));
    }
    indexLines.push("");
  }

  await writeNote("01 - Sources/Public Website/Public Website Index.md", `# Public Website Index

Generated from \`data/processed/pages.json\`.

${indexLines.join("\n")}
`);

  const documentNotes = [
    {
      source: "data/processed/documents/f800df_e5cf5ff6492f4698904263d7fe3fd1ac.txt",
      title: "2026 Sponsorship Packet"
    },
    {
      source: "data/processed/documents/2023_Detailed_Street_Map_Back_98fa7b66-86ba-44c9-9d4f-99aab1c94cb8.txt",
      title: "Port Aransas Street Map PDF"
    }
  ];

  for (const doc of documentNotes) {
    const text = await readText(path.join(ROOT, doc.source)).catch(() => "");
    await writeNote(`01 - Sources/Documents/${doc.title}.md`, `---
type: source_document
status: needs_review
source_path: ${doc.source}
---

# ${doc.title}

## Extracted Text

\`\`\`text
${text.slice(0, 20000)}
\`\`\`
`);
  }
}

async function writeCanonicalNotes() {
  await writeNote("02 - Canonical/Event/Texas SandFest 2026.md", `---
type: event
status: draft
source: public_scrape
event_id: texas-sandfest-2026
---

# Texas SandFest 2026

## Known Public Facts

- Dates: April 17-19, 2026.
- Location: Port Aransas beach, Port Aransas, TX 78373.
- Public ticketing and selected applications route through Eventeny.
- Public contact: \`info@texassandfest.org\`, \`361-267-2474\`.
- Office: 200 S. Alister Street, Suite E, Port Aransas, TX 78373.

## Source Notes

- [[Official Texas SandFest Home]]
- [[Ticket - Texas Sandfest - 2026 - Eventeny]]
- [[Texas Sandfest - 2026 - Eventeny]]
- [[Public Ingestion Report]]

## Open Canonicalization Tasks

- Confirm exact gate hours by day.
- Confirm final map zones and marker boundaries.
- Confirm Eventeny application/ticket type IDs.
- Confirm operational owner for each public policy.
`);

  await writeNote("02 - Canonical/Policies/Service Animals Only.md", `---
type: policy
status: draft
risk: high
audience:
  - guest
  - staff
  - volunteer
source: faq_public_page
---

# Service Animals Only

Texas SandFest 2026 public FAQ states that the event grounds are Service Animals Only and that emotional support animals or therapy pets are not admitted under the policy.

## AI Handling

- Answer only from the canonical policy record.
- Cite source and last-reviewed date.
- Escalate disputes, accessibility accommodation conflicts, or safety issues to Guest Relations.

## Source Notes

- [[FAQ's - Texas Sandfest]]
- [[Public Ingestion Report]]
`);

  await writeNote("02 - Canonical/Map and Zones/Beach Zones.md", `---
type: map_model
status: draft
source: public_scrape
---

# Beach Zones

## Initial Zones

- North Gate / Marker 12.5: Guest Relations, ticket scan, ADA parking, wristbands.
- Competition Corridor: master, duo, semi-pro, advanced amateur, and amateur sculpture areas.
- South Entrance / Access Road 1A: shuttle drop-off, south entrance, food/vendor access.
- Music Stage.
- Kids Corner.
- Sponsor/VIP areas.
- Medical/shade/support points.

## Source Notes

- [[Maps - Texas Sandfest]]
- [[Accessibility - Texas Sandfest]]
- [[Parking & Shuttles - Texas Sandfest]]
- [[Port Aransas Street Map PDF]]
`);

  await writeNote("02 - Canonical/Sponsors/Sponsor Packages.md", `---
type: sponsor_model
status: draft
source: sponsorship_packet_2026
---

# Sponsor Packages

The extracted sponsorship packet includes package tiers, wristband/pass counts, booth benefits, advertising benefits, social post counts, logo placements, add-ons, and deadlines.

## Known Package Prices From Extracted Packet

- The Kraken: $250,000.
- Megalodon: $125,000.
- Giant Squid: $75,000.
- Whale: $50,000.
- Shark: $25,000.
- Marlin: $15,000.
- Sailfish: $10,000.
- Tarpon: $5,000.
- Trout: $2,500.

## Operational Risk

Sponsor benefits are spread across public page, PDF packet, and Eventeny sponsor application. This should become a structured benefit/deliverable table with owner, due date, inventory count, and fulfillment status.

## Source Notes

- [[Sponsorship - Texas Sandfest]]
- [[2026 Sponsorship Packet]]
`);

  await writeNote("02 - Canonical/Finance/QuickBooks Accounting Model.md", `---
type: finance_model
status: draft
source: quickbooks_mapping
---

# QuickBooks Accounting Model

QuickBooks Online is the accounting source of truth. SandFest owns operating status and fulfillment.

## Accounting Objects

- Customer: sponsor/customer match.
- Vendor: vendor/payee match.
- Invoice: sponsor package billing.
- Payment: sponsor payment state.
- Bill/Purchase: vendor or event expense tracking.
- SalesReceipt: raffle, merchandise, or other direct sale reconciliation.
- JournalEntry/Account/Class: reviewed reporting categories.

## SandFest Mirrors

- Sponsor invoice status.
- Sponsor payment status.
- Vendor financial status.
- Raffle/merch reconciliation status.
- Donation/scholarship reporting totals after finance review.

## Source Attachments

- \`99 - Attachments/quickbooks-mapping.json\`
- [[QuickBooks Integration]]
`);
}

async function writeWorkflowNotes() {
  const workflows = {
    "Sponsor Lifecycle": [
      "prospect",
      "committed",
      "invoiced",
      "paid",
      "assets received",
      "benefits assigned",
      "on-site fulfilled",
      "impact report sent"
    ],
    "Vendor Lifecycle": [
      "applied",
      "documents requested",
      "approved",
      "booth assigned",
      "load-in scheduled",
      "inspection passed",
      "issue closeout"
    ],
    "Volunteer Lifecycle": [
      "registered",
      "role matched",
      "shift confirmed",
      "checked in",
      "reassigned or no-show",
      "thanked"
    ],
    "AI Concierge Review Workflow": [
      "source ingested",
      "fact extracted",
      "owner assigned",
      "canonical answer drafted",
      "approved for AI",
      "published",
      "question gaps reviewed"
    ],
    "Incident Workflow": [
      "reported",
      "triaged",
      "assigned",
      "in progress",
      "resolved",
      "post-event analysis"
    ]
  };

  for (const [name, steps] of Object.entries(workflows)) {
    await writeNote(`03 - Workflows/${name}.md`, `---
type: workflow
status: draft
---

# ${name}

## Lifecycle

${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Data Needed

- Source system.
- Owner.
- Status.
- Due date.
- Related files.
- Notes.
- Audit history.

## AI / Automation Opportunities

- Detect missing fields.
- Generate staff follow-up drafts.
- Summarize status by owner.
- Flag stale or conflicting records.
`);
  }
}

async function writeIngestionNotes() {
  const lanes = [
    ["Eventeny", "ticket exports, vendor applications, sponsor applications, volunteer applications", "data/incoming/eventeny"],
    ["Documents", "PDFs, spreadsheets, packets, contracts, maps, board docs, runbooks", "data/incoming/docs"],
    ["Ops", "staffing, radio plan, site map, incident log, weather plan, city coordination", "data/incoming/ops"],
    ["Finance", "sponsor invoices, donation distributions, raffle data, permit costs, vendor fees", "data/incoming/finance"],
    ["QuickBooks", "OAuth callback captures, company info snapshots, invoice/payment exports, chart of accounts reports", "data/incoming/quickbooks"],
    ["Comms", "email templates, SMS copy, press copy, FAQ drafts, social calendar", "data/incoming/comms"]
  ];

  await writeNote("04 - Ingestion Inbox/Ingestion Control.md", `# Ingestion Control

Use this area to track incoming internal files before promoting anything into canonical records.

| Lane | Drop Folder | Expected Files |
| --- | --- | --- |
${lanes.map(([lane, desc, folder]) => `| [[${lane} Intake]] | \`${folder}\` | ${desc} |`).join("\n")}

## Intake Checklist

- Identify source owner.
- Identify date range and event year.
- Mark sensitivity: public, internal, financial, contract, personal, operational.
- Extract entities.
- Link source note.
- Promote stable facts into \`02 - Canonical\`.
- Keep raw source unchanged.
`);

  for (const [lane, desc, folder] of lanes) {
    await writeNote(`04 - Ingestion Inbox/${lane}/${lane} Intake.md`, `---
type: ingestion_lane
status: ready
drop_folder: ${folder}
---

# ${lane} Intake

## Drop Folder

\`${path.join(ROOT, folder)}\`

## Expected Data

${desc}

## Processing Notes

- Add files to the drop folder.
- Create or update source notes in this vault.
- Extract entities and unresolved questions.
- Promote only reviewed facts into canonical notes.
`);
  }

  const incomingFiles = (await listFiles(INCOMING)).filter(file => !file.endsWith(".gitkeep"));
  await writeNote("04 - Ingestion Inbox/Incoming File Registry.md", `# Incoming File Registry

Generated from \`${INCOMING}\`.

${incomingFiles.length ? incomingFiles.map(file => `- [[${incomingFileNoteTitle(file)}]]`).join("\n") : "_No incoming files yet._"}

## Drop Lanes

${lanes.map(([lane, desc, folder]) => `- ${lane}: \`${folder}\` - ${desc}`).join("\n")}
`);

  for (const file of incomingFiles) {
    const title = incomingFileNoteTitle(file);
    const lane = path.relative(INCOMING, file).split(path.sep)[0] || "Unsorted";
    const preview = await previewFile(file);
    await writeNote(`04 - Ingestion Inbox/${title}.md`, `---
type: incoming_file
status: needs_review
lane: ${lane}
source_path: ${file}
---

# ${title}

## Source Path

\`${file}\`

## Intake Checklist

- [ ] Identify source owner.
- [ ] Identify event year/date range.
- [ ] Mark sensitivity.
- [ ] Extract entities.
- [ ] Link or create canonical records.
- [ ] Capture open questions.

## Preview

\`\`\`text
${preview}
\`\`\`
`);
  }
}

async function writeTemplateNotes() {
  const templates = {
    "Source Note Template": `---
type: source
status: needs_review
source_owner:
source_path:
received_date:
sensitivity: internal
---

# {{title}}

## Summary

## Extracted Facts

## Entities

## Conflicts / Questions

## Promotion Targets

`,
    "Canonical Record Template": `---
type: canonical_record
status: draft
owner:
source:
effective_from:
effective_until:
last_reviewed:
risk: normal
---

# {{title}}

## Approved Answer / Record

## Source Evidence

## AI Handling

## Open Questions

`,
    "Workflow Template": `---
type: workflow
status: draft
owner:
---

# {{title}}

## Lifecycle

## Inputs

## Outputs

## Automations

## Failure Modes

`
  };

  for (const [title, body] of Object.entries(templates)) {
    await writeNote(`06 - Templates/${title}.md`, body);
  }
}

async function copyPlanningDocs() {
  const docs = [
    ["docs/architecture.md", "Architecture.md"],
    ["docs/ios-app-plan.md", "iOS App Plan.md"],
    ["docs/app-data-contract.md", "App Data Contract.md"],
    ["docs/frontend-media.md", "Frontend Media.md"],
    ["docs/incoming-ingestion.md", "Incoming Ingestion.md"],
    ["docs/stitch-handoff.md", "Stitch Handoff.md"],
    ["docs/port-a-local-co-integration.md", "Port A Local Co Integration.md"],
    ["docs/quickbooks-integration.md", "QuickBooks Integration.md"],
    ["docs/stripe-ticketing.md", "Stripe Ticketing.md"],
    ["docs/heyelab-backend-deployment.md", "Heyelab Backend Deployment.md"],
    ["docs/scale-and-reliability.md", "Scale and Reliability.md"]
  ];

  for (const [source, destination] of docs) {
    await cp(path.join(ROOT, source), path.join(VAULT, "07 - Product Planning", destination));
  }

  await writeJson(path.join(VAULT, "99 - Attachments", "links-index.json"), links);
  await writeJson(path.join(VAULT, "99 - Attachments", "images-index.json"), images);
  await cp(path.join(ROOT, "data", "processed", "media-assets.json"), path.join(VAULT, "99 - Attachments", "media-assets.json"));
  await cp(path.join(ROOT, "data", "processed", "incoming-inventory.json"), path.join(VAULT, "99 - Attachments", "incoming-inventory.json"));
  await cp(path.join(ROOT, "data", "processed", "ticket-products.json"), path.join(VAULT, "99 - Attachments", "ticket-products.json"));
  await cp(path.join(ROOT, "data", "config", "emergency-alert.json"), path.join(VAULT, "99 - Attachments", "emergency-alert.json"));
  await writeJson(path.join(VAULT, "99 - Attachments", "knowledge-base.json"), knowledgeBase);
  await writeJson(path.join(VAULT, "99 - Attachments", "process-map.json"), processMap);
  await cp(path.join(ROOT, "data", "schemas", "quickbooks-mapping.json"), path.join(VAULT, "99 - Attachments", "quickbooks-mapping.json"));
}

function sourcePageMarkdown(page) {
  return `---
type: public_web_page
status: scraped
category: ${page.category}
url: ${page.url}
fetched_at: ${page.fetchedAt}
word_count: ${page.wordCount}
---

# ${sourceTitle(page)}

## Source

${page.url}

## Headings

${(page.headings || []).map(heading => `- ${heading}`).join("\n") || "- None extracted"}

## Extracted Dates

${(page.dates || []).map(date => `- ${date}`).join("\n") || "- None extracted"}

## Extracted Prices

${(page.prices || []).map(price => `- ${price}`).join("\n") || "- None extracted"}

## Outbound Links

${(page.outboundLinks || []).slice(0, 40).map(link => `- [${link.text || link.href}](${link.href})`).join("\n") || "- None extracted"}

## Text Preview

${page.textPreview || ""}
`;
}

function baseSourceTitle(page) {
  if (page.url === "https://www.texassandfest.org/" || page.url === "https://www.texassandfest.org") {
    return "Official Texas SandFest Home";
  }
  const title = (page.title || page.url.replace(/^https?:\/\//, "")).replace(/\s+/g, " ").trim();
  return title.replace(/\s*\|\s*Texas Sandfest\s*$/i, " - Texas Sandfest");
}

function sourceTitle(page, titleCounts) {
  const base = baseSourceTitle(page);
  if (!titleCounts || titleCounts[base] <= 1) return sanitizeFileName(base);
  const url = new URL(page.url);
  const slug = (url.pathname.replace(/^\/|\/$/g, "") || "home").replace(/\//g, " - ");
  return sanitizeFileName(`${base} - ${slug}`);
}

function addAliases(markdown, title) {
  if (markdown.startsWith("---")) return markdown;
  return `---\naliases:\n  - ${title}\n---\n\n${markdown}`;
}

function sanitizeFileName(value) {
  return String(value || "Untitled")
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function titleCase(value) {
  return String(value).replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function groupBy(values, keyFn) {
  return values.reduce((groups, value) => {
    const key = keyFn(value);
    groups[key] ||= [];
    groups[key].push(value);
    return groups;
  }, {});
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeSourceUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function relative(base, child) {
  return path.join(base, child);
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

async function readText(file) {
  return readFile(file, "utf8");
}

async function writeNote(relativePath, content) {
  const file = path.join(VAULT, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content.trimEnd() + "\n", "utf8");
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function listFiles(folder) {
  const entries = await import("node:fs/promises").then(fs => fs.readdir(folder, { withFileTypes: true }).catch(() => []));
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function incomingFileNoteTitle(file) {
  const relativePath = path.relative(INCOMING, file);
  return sanitizeFileName(`Incoming - ${relativePath.replace(/\.[^.]+$/, "").replace(/[\\/]/g, " - ")}`);
}

async function previewFile(file) {
  if (!/\.(txt|md|csv|tsv|json|xml|html)$/i.test(file)) {
    return "Binary or document file. Use extraction tooling before promotion.";
  }
  try {
    return (await readText(file)).slice(0, 8000);
  } catch {
    return "Preview unavailable.";
  }
}
