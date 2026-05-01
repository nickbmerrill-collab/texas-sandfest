# Texas SandFest Public Ingestion Report

Generated from the official Texas SandFest Wix site, its public sitemap, public Eventeny event/ticket pages, and public PDFs discovered through the crawl.

## Ingested Surface

- 60 public page records with raw HTML and text snapshots.
- 2 public PDFs downloaded and text-extracted:
  - Port Aransas detailed street map.
  - 2026 Texas SandFest sponsorship packet.
- 13 relevant SandFest/Eventeny handoff URLs.
- Public pages grouped into visitor, program, competition, partner, organization, tickets, and commerce buckets.

## High-Value Facts Found

- Event: Texas SandFest 2026, April 17-19, 2026, Port Aransas beach.
- Ticketing and some applications are routed through Eventeny.
- Sponsor public claim: over 100,000 visitors during the 3-day event.
- Sponsor public claim: over $464,000 raised in 2025; sponsor packet says $464,169 donated, with $274,419 to Port Aransas ISD scholarships.
- Sponsor packet says Texas SandFest has raised and given back over $2.4 million from 2012-2025.
- Public contact: `info@texassandfest.org`, `361-267-2474`, 200 S. Alister Street, Suite E, Port Aransas, TX 78373.
- Volunteer page exposes operational topics: guidelines, missed shifts/substitutes, setup volunteers, wristbands, food vouchers, snacks/drinks, equipment, parking, setup/event/teardown support.
- Accessibility page exposes important service objects: accessible parking at beach marker 12.5, accessible toilets, beach wheelchairs, reservation windows, pickup requirements, weight/time constraints.
- Parking page exposes shuttle operations, pickup/dropoff points, Gracie's Way lot, operating hours, and beach marker references.
- FAQ exposes 2026 Service Animals Only policy and ADA guidance.
- Schedule page includes Friday/Saturday/Sunday plus pre-festival activities Monday-Thursday.

## Immediate Process Risks

- Public content is page-based and duplicated across global navigation, copied routes, and archive routes. AI retrieval will need canonical records, not raw page chunks.
- Eventeny appears to be handling ticketing/applications, but SandFest still needs its own source of truth for status, assignments, documents, deliverables, and post-event reporting.
- Sponsor details are split between a short public page, Eventeny sponsor application, and a PDF packet. This creates avoidable drift for deadlines, package benefits, and available inventory.
- The Wix store sitemap contains placeholder product pages titled "I'm a product." Those should be removed or hidden from any production crawler/search index.
- Several operational policies are written as page prose instead of structured objects: pet/service animal policy, media credentials, parking/shuttle, accessibility, volunteer rules, and sponsor deadlines.
- The sitemap includes typo/copy routes such as `sustainablity`, `copy-of-live-music`, `copy-of-at-sandfest`, `copy-of-press-release`, and `livemusic` in addition to `live-music`.

## Recommended Operating Model

1. Build a canonical SandFest data model:
   Event, day, venue zone, gate, schedule item, ticket type, policy, sponsor tier, sponsor deliverable, vendor application, volunteer role, shift, incident, document, FAQ answer.

2. Use Eventeny as a transaction source, not the operating brain:
   Sync or import Eventeny IDs/statuses, then manage SandFest-specific assignments, gaps, documents, approvals, and deliverables inside the platform.

3. Turn every partner workflow into a lifecycle:
   Sponsor: prospect -> committed -> invoiced -> paid -> assets received -> benefits assigned -> on-site fulfilled -> impact report.
   Vendor: applied -> documents requested -> approved -> booth assigned -> load-in scheduled -> inspection passed -> issue closeout.
   Volunteer: registered -> role matched -> shift confirmed -> checked in -> reassigned/no-show -> thanked.

4. Make the AI concierge source-cited:
   Every answer should cite a canonical source record, show last-reviewed date, and escalate low-confidence questions to the right staff owner.

5. Create ops primitives before adding more UI:
   Beach zones, markers, entrances, ADA support, Guest Relations, Lost & Found, medical/shade points, shuttle stops, radio channels, incident categories, weather alerts, and staffing levels.

6. Build a cleanup queue:
   Remove placeholder store products, merge duplicate pages, fix typo routes, separate current-year content from archives, and assign owners to each policy/schedule page.

## Data Drop Targets For Incoming Internal Data

- `data/incoming/eventeny/` for exports from ticketing, vendors, sponsors, volunteers, and applications.
- `data/incoming/docs/` for PDFs, spreadsheets, packets, board docs, runbooks, maps, contracts, and sponsor assets.
- `data/incoming/ops/` for radio plans, site maps, incident logs, staffing plans, weather plans, parking/shuttle plans, and city coordination.
- `data/incoming/finance/` for sponsor invoices, donation distributions, raffle data, permit costs, and vendor fees.
- `data/incoming/comms/` for email templates, SMS copy, social calendar, press/media templates, and FAQ drafts.

## Generated Files

- `data/processed/crawl-summary.json`
- `data/processed/pages.json`
- `data/processed/links.json`
- `data/processed/images.json`
- `data/processed/knowledge-base.json`
- `data/processed/process-map.json`
- `data/processed/process-improvement-notes.md`
- `data/processed/documents/*.txt`
- `data/raw/html/*.html`
- `data/raw/text/*.txt`
- `data/raw/documents/*.pdf`
