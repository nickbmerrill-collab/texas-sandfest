# Vendor Management, Sponsor Management & Site Mapping

_Research stream 2 of 8. Compiled 2026-07-15. Pricing marked "(as of 2026, verify)."_

**Bottom line:** Eventeny already covers far more than "ticketing" — vendor applications, **COI collection**, booth fees, sponsor packages, deliverable task-tracking, *and* interactive booth maps. The real gaps: (1) an **operational outdoor site plan** (emergency lanes, utilities, zones, crowd capacity) that Eventeny's booth diagrams don't do, and (2) **Eventeny has no public API yet**, which constrains feeding its data into your custom web/iOS map.

## Domain 1 — Vendor management & sign-ups
| Platform | COI/permit collection | Payments | Pricing/fees (verify) | API |
|---|---|---|---|---|
| **Eventeny** (incumbent) | **Built-in COI workflow** (post-approval request, additional-insured fields, 2-week deadline, evCover purchase or manual upload, organizer review) | Stripe; installments; booth fees/rentals/add-ons | Vendor mgmt **free on Basic**; tickets 3%; **vendor app fee 5.9%** (vendor-paid) + product sales 5% | **None yet — "on roadmap"** (key limit) |
| **EventHub** | eSign; contracts/permits/COIs | CC/PayPal/ACH; **deposits + installments**, split | $0.99+3%/ticket; **~10% booking fee** on space/sponsorship OR ~$997–4,990/yr tiers | native **live booth maps** |
| **Marketspread** | attachments | app/booth fees | **$15/booth** (<100-day events) | market/farmers-market flavored |
| Konfeo / Eventbrite / FestivalNet | **not** vendor-compliance tools | — | — | Eventbrite has API but for ticketing |

**Read:** Only **Eventeny** and **EventHub** are purpose-built for food/retail/beverage intake + COI + health permits + booth fees. **Eventeny is the strongest fit and you already own it.** EventHub is the closest competitor (native installments + booth maps + eSign) — worth benchmarking at renewal only.

## Domain 2 — Sponsor management / deliverable fulfillment
| Tool | What it is | Fit |
|---|---|---|
| **Eventeny** (incumbent) | Sponsor module: customizable **tiers + benefits/deliverables + built-in task system** (assign/track/complete) + installments | **Strong — already models Whale/Marlin/Tarpon + deliverable tasks** |
| **SponsorCX** | Best-in-class fulfillment tracking (proof-of-performance, artwork approvals, auto tasks) | Right **upgrade** only if you outgrow Eventeny; quote-only |
| **SponsorUnited** | Sponsorship *prospecting/intelligence* database | **Wrong category** — not fulfillment |
| **Tradable Bits** | Fan-data activation | Niche digital-activation only |
| **Airtable** | Relational DB | **Best budget "just enough CRM"** if you want deliverables in your own stack, syncs to QuickBooks via Zapier |

**Read:** Your sponsor pain (tiers, deliverables, invoice status — today manual + QuickBooks) is **already solved in Eventeny's sponsor module**. Do NOT buy SponsorUnited/Tradable Bits (wrong category). SponsorCX only if deliverable volume outgrows Eventeny. Airtable is the low-cost middle ground if you want it in your own stack.

## Domain 3 — Site mapping (the real gap)
Three categories — don't conflate: **operational site planning** (OnePlan) vs **exhibitor floor-plan/booth sales** (ExpoFP, Eventeny) vs **banquet/seating** (Cvent/Prismm, weak for a beach).

| Tool | Beach-ops fit | Feeds public map? | API/export | Pricing (verify) |
|---|---|---|---|---|
| **OnePlan** | **Best fit** — live GIS satellite canvas, cm accuracy, infra/barriers/toilets, **crowd-capacity calc**, **auto Bill of Quantities**, emergency-lane/traffic planning | as a base layer (ops tool, not attendee-facing) | **REST API**, CSV/PNG/GPX/DXF/CAD | free 1st event; Solo ~£16/mo; Pro ~£82/mo; Premium custom |
| **ExpoFP** | decent (booths) | **Yes — embeddable interactive**, online booth reservation | **public API**, PDF/Excel | free; $990–2,100/yr by booths |
| **Eventeny mapping** | booth-diagram level | **Yes — public embeddable directory**, vendor self-select booth | **no API**; $1,000 custom-map service; on Pro tier | included in Pro (~$360/yr) |
| Cvent/Social Tables, Prismm, Map Your Show, Expocad, Concept3D | indoor/trade-show DNA or enterprise-priced | varies | varies | mostly quote/enterprise |

**Read:** Eventeny mapping = booth diagram + public directory ("where is vendor X"), but **cannot** do emergency lanes, utility runs, crowd-capacity math, or a bill of quantities for a 100k beach site. That operational job is **OnePlan's** sweet spot — the one specialized tool worth adding.

## Recommendation (lean team already on Eventeny)
**You already own ~80%. Don't re-buy what Eventeny does; add the one thing it can't (operational beach mapping); bridge the API gap yourself.**

- **Keep on Eventeny:** ticketing; vendor apps + COI + health permits + booth fees; sponsor tiers/installments/deliverable tasks (keep pushing paid-invoice status to QuickBooks).
- **Absorb into your platform (BUILD):** the **public booth/vendor map in web + iOS**. Since Eventeny has no API yet, bridge it: **export booth assignments as CSV → Node admin DB → render with Leaflet/MapLibre (web) + MapKit/MapLibre (iOS)** in your branded app. Replace CSV with a live pull when Eventeny's API ships.
- **Add one specialized tool (INTEGRATE): OnePlan** for the operational beach site plan (zones, utilities, emergency lanes, crowd capacity, BOQ + permitting/safety docs a 100k beach event needs). Export DXF/GeoJSON → base layer under your booth pins. Start free/first-event tier, Pro (~£82/mo) only in planning season. **Budget alt:** Eventeny Pro mapping + one-time $1,000 custom map + PDF/CAD markup for lanes (lose crowd-capacity math + BOQ + GIS accuracy).
- **Do NOT buy:** SponsorUnited, Tradable Bits (wrong category); SponsorCX (until you outgrow Eventeny); Cvent/Prismm/Map Your Show/Expocad (indoor DNA); Concept3D (redundant with your app).

**Data flow:**
```
Eventeny (vendor apps, booth assignments, categories)  --CSV today / API later-->
  Node admin API  -->  booth table (id, name, category, x/y|lat/lng, status)
     ├─> Web: Leaflet/MapLibre interactive map (filter/search/click-info)
     └─> iOS: MapKit/MapLibre overlay (same feed, offline-cached)
OnePlan (site base layer: zones, lanes, utilities)  --DXF/GeoJSON-->  base under booth pins
```
**Net cost delta (verify): ~$0–150/mo** in planning season (OnePlan) + a modest CSV→map bridge — vs $2,000–5,000+/yr + migration to swap Eventeny or bolt on tools you don't need yet.

### Sources
[Eventeny pricing](https://www.eventeny.com/product/pricing/) · [Eventeny vendor mgmt](https://www.eventeny.com/vendor-management/) · [Eventeny COI](https://help.eventeny.com/hc/en-us/articles/43536050613275) · [Eventeny sponsor mgmt](https://www.eventeny.com/product/sponsor-management/) · [Eventeny mapping](https://www.eventeny.com/mapping/) · [EventHub pricing](https://eventhub.net/pricing) · [Marketspread pricing](https://marketspread.com/pricing/) · [SponsorCX](https://www.sponsorcx.com/property-product/) · [Airtable/Notion/HubSpot](https://www.notelinker.com/blog/notion-vs-airtable) · [OnePlan outdoor](https://www.oneplan.io/map-and-plan-a-outdoor-event/) · [OnePlan API](https://my.oneplan.ai/ApiHelp) · [ExpoFP pricing](https://expofp.com/pricing) · [Concept3D API](https://help.concept3d.com/hc/en-us/articles/360016590393)
