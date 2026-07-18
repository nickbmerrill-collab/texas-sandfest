# Incoming Ingestion

Private source files have two controlled intake paths:

1. Staff upload through the operations **Documents** workspace. This is the production path for board packets, provider exports, finance files, runbooks, and communications.
2. Bulk local drops land in `data/incoming/` and pass through the repository scanner before promotion.

Neither path publishes content automatically.

## Staff Document Workspace

`GET /api/admin/documents` requires `documents:read`. Upload, review, owner assignment, and archive changes require `documents:write`.

Supported files are PDF, UTF-8 text, CSV, JSON, EML, PNG, JPEG, WebP, DOCX, XLSX, and PPTX. The API verifies signatures or structured text, enforces a 20 MB default limit, hashes every file with SHA-256, and collapses exact replays into the original annual record. Text, CSV, JSON, and EML receive a bounded staff-only preview. PDF, DOCX, XLSX, and PPTX uploads queue asynchronous text extraction; images remain stored for manual review.

Extraction is versioned and retry-safe. The worker verifies the queued event, version, byte count, and SHA-256 before parsing. Extracted text, bounded chunks, structural metadata, warnings, and counts stay in the private annual intake record; the staff API returns only the bounded preview and aggregate counts. OCR, macros, attachments, and embedded executable content are disabled. Empty results enter `needs_review`, terminal failures remain visible, and authorized staff can queue a new extraction version without re-uploading the source.

The metadata lifecycle is:

`received` -> `in_review` -> `approved` or `changes_requested` -> `archived`

Archived files remain available to authorized staff on the private mount. Downloads recompute file size and checksum before returning bytes. Upload, review, extraction source reads, extraction retries, integrity failures, and download actions are audited without copying document text into the audit trail.

Production requires:

```bash
SANDFEST_INCOMING_DOCUMENT_DIR=/private/persistent/incoming-documents
SANDFEST_INCOMING_DOCUMENT_MAX_BYTES=20971520
SANDFEST_DOCUMENT_EXTRACTION_SECRET=<32-or-more-random-characters>
```

Render maps the intake directory to the API's private persistent disk. The worker has no shared disk: it receives the same extraction secret and an HTTPS `SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL`, then downloads only the exact queued event/checksum/version through a private `no-store` API route. Local development may instead point API and worker at the same private directory. File bytes never enter the static visitor/admin artifacts and storage keys never leave the API.

## Drop Folders

- `data/incoming/eventeny`: tickets, applications, vendors, sponsors, messages, orders
- `data/incoming/quickbooks`: company info, customers, invoices, payments, vendors, bills, reports
- `data/incoming/finance`: budgets, reconciliations, sponsor finance, raffle, merch, grant totals
- `data/incoming/ops`: runbooks, maps, permits, staffing, emergency plans, load-in docs
- `data/incoming/docs`: PDFs, docs, board packets, policy references
- `data/incoming/comms`: emails, social calendars, press releases, SMS templates

## Command

```bash
npm run incoming:scan
```

## Outputs

- `data/processed/incoming-inventory.json`
- `data/processed/incoming-inventory.md`
- `public/data/incoming-inventory.json` after `npm run public:sync`

## Bulk Drop Rule

Do not wire new exports directly into the customer app. Scan first, review source ownership, classify records, then promote into canonical app data.
