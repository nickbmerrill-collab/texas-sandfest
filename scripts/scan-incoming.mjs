import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const incomingRoot = path.join(ROOT, "data", "incoming");
const processedRoot = path.join(ROOT, "data", "processed");

const domains = {
  eventeny: {
    label: "Eventeny",
    expected: "Ticket exports, vendor applications, sponsor applications, orders, maps, messages",
    handler: "Normalize to tickets, vendors, sponsors, commerce, and comms records"
  },
  quickbooks: {
    label: "QuickBooks",
    expected: "Company info, customers, vendors, invoices, payments, bills, reports",
    handler: "Validate against QuickBooks mapping before finance/admin sync"
  },
  finance: {
    label: "Finance",
    expected: "Budgets, sponsor packages, reconciliations, raffle, merch, grant totals",
    handler: "Stage for finance review and source-of-truth decision"
  },
  ops: {
    label: "Operations",
    expected: "Runbooks, maps, permits, staffing plans, emergency plans, load-in docs",
    handler: "Split into zones, policies, tasks, contacts, and incident playbooks"
  },
  docs: {
    label: "Documents",
    expected: "PDFs, docs, board packets, sponsorship packets, public/private references",
    handler: "Extract text, preserve source, route to canonical records"
  },
  comms: {
    label: "Comms",
    expected: "Email exports, social calendars, press releases, SMS templates, announcements",
    handler: "Classify by audience and approval state before publishing"
  }
};

const generatedAt = new Date().toISOString();
const folders = [];
const files = [];

for (const [domain, config] of Object.entries(domains)) {
  const folder = path.join(incomingRoot, domain);
  const folderFiles = await walk(folder);
  const realFiles = folderFiles.filter((file) => path.basename(file) !== ".gitkeep");

  const records = [];
  for (const file of realFiles) {
    const info = await stat(file);
    const ext = path.extname(file).toLowerCase().replace(".", "") || "unknown";
    const record = {
      domain,
      label: config.label,
      name: path.basename(file),
      relativePath: path.relative(ROOT, file),
      extension: ext,
      type: typeFor(ext),
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      recommendedHandler: handlerFor(domain, ext),
      status: "new"
    };
    records.push(record);
    files.push(record);
  }

  folders.push({
    domain,
    label: config.label,
    expected: config.expected,
    handler: config.handler,
    path: path.relative(ROOT, folder),
    count: records.length,
    bytes: records.reduce((total, file) => total + file.bytes, 0),
    status: records.length > 0 ? "needs_review" : "waiting",
    files: records
  });
}

const inventory = {
  generatedAt,
  incomingRoot: path.relative(ROOT, incomingRoot),
  totalFiles: files.length,
  totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  folders,
  files
};

await writeFile(path.join(processedRoot, "incoming-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
await writeFile(path.join(processedRoot, "incoming-inventory.md"), markdownFor(inventory));

console.log(`Incoming scan complete: ${files.length} files across ${folders.length} folders`);

async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      found.push(...await walk(fullPath));
    } else {
      found.push(fullPath);
    }
  }
  return found;
}

function typeFor(ext) {
  if (["csv", "tsv"].includes(ext)) return "table";
  if (["xlsx", "xls"].includes(ext)) return "spreadsheet";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "rtf"].includes(ext)) return "document";
  if (["json"].includes(ext)) return "json";
  if (["jpg", "jpeg", "png", "webp", "avif", "gif"].includes(ext)) return "image";
  if (["txt", "md"].includes(ext)) return "text";
  if (["eml", "mbox"].includes(ext)) return "email";
  return "unknown";
}

function handlerFor(domain, ext) {
  const type = typeFor(ext);
  if (domain === "quickbooks") return "QuickBooks finance mapper";
  if (domain === "eventeny") return "Eventeny import mapper";
  if (type === "spreadsheet" || type === "table") return "Tabular parser and schema matcher";
  if (type === "pdf" || type === "document") return "Document text extractor";
  if (type === "image") return "Media catalog and rights review";
  if (type === "email") return "Comms thread parser";
  return "Manual triage";
}

function markdownFor(inventory) {
  return `# Incoming Inventory

Generated: ${inventory.generatedAt}

Total files: ${inventory.totalFiles}

## Folders

${inventory.folders.map(folder => `### ${folder.label}

- Status: ${folder.status}
- Path: \`${folder.path}\`
- Files: ${folder.count}
- Expected: ${folder.expected}
- Handler: ${folder.handler}
`).join("\n")}

## Files

${inventory.files.length === 0 ? "No incoming files yet.\n" : inventory.files.map(file => `- \`${file.relativePath}\` (${file.type}, ${file.bytes} bytes) -> ${file.recommendedHandler}`).join("\n")}
`;
}
