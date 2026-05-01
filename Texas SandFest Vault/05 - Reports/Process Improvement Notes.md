---
aliases:
  - Process Improvement Notes
---

# Public Data Ingestion Notes

Scrape time: 2026-04-30T20:38:45.882Z

## What was ingested

- Official Wix sitemaps and all listed public pages.
- Public product/category sitemap entries.
- Public Eventeny event and ticketing URLs discoverable from search and site links.
- Page titles, headings, visible text preview, contact details, dates, times, prices, links, images, and document URLs.

## Current process shape

- Visitor information is spread across tickets, FAQ, parking/shuttles, ferry, accessibility, maps, kids, live music, daily schedule, and policy pages.
- Partner operations split into sponsor, vendor, volunteer, and get-involved pages, then jump out to Eventeny for application/payment workflows.
- Competition content is split across sculptor category pages, amateur competition, winners, and archive-style copied pages.
- Organization trust content sits separately across mission, history, board, press, sustainability, and contact pages.

## Early process-improvement suggestions

1. Create a canonical content model before adding more AI.
   Store event facts, policy answers, map zones, schedule items, ticket types, sponsor tiers, vendor requirements, volunteer roles, and contacts as structured records with owners and last-reviewed dates.

2. Separate public pages from operational workflows.
   Keep the marketing site simple, but run volunteer, vendor, sponsor, competition, and incident workflows in a shared operations console with status, assignments, attachments, and audit history.

3. Build an AI concierge only on approved sources.
   The assistant should answer from the canonical knowledge base, cite the source record, show confidence, and escalate low-confidence or high-risk questions to staff.

4. Normalize Eventeny handoffs.
   Treat Eventeny as a transaction/application system, not the source of truth. Mirror relevant status into SandFest ops: ticket type, applicant type, sponsor tier, vendor category, payment state, and missing documents.

5. Collapse duplicate pages and copied archive routes.
   The sitemap includes copied or alternate routes such as duplicate live music and copied SandFest pages. These create conflicting answers for visitors and AI retrieval.

6. Add live event operations primitives.
   Model beach zones, gates, ADA support, shade/medical points, volunteers, radio channels, incidents, weather alerts, lost party reports, and sanitation/vendor issues.

7. Give every workflow a lifecycle.
   Sponsors: lead -> pledged -> invoiced -> assets received -> benefits assigned -> on-site delivered -> impact report sent.
   Vendors: applied -> documents requested -> approved -> booth assigned -> load-in scheduled -> inspection passed -> closeout.
   Volunteers: registered -> role matched -> shift confirmed -> checked in -> reassigned/no-show -> thanked.

8. Build post-event analytics from day one.
   Capture question themes, wait times, crowd signals, volunteer gaps, vendor issues, sponsor deliverables, and policy confusion so the 2027 planning cycle starts from evidence.

## Files generated

- `data/processed/crawl-summary.json`
- `data/processed/pages.json`
- `data/processed/links.json`
- `data/processed/images.json`
- `data/processed/knowledge-base.json`
- `data/processed/process-map.json`
- Raw trace files under `data/raw/html` and `data/raw/text`
