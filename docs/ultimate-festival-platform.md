# The Ultimate SandFest Platform — Blueprint & Roadmap

_Compiled 2026-07-15 from eight research streams in [docs/research/](research/). This is the decision document: what to build, what to buy, what to integrate, in what order, and roughly what it costs. All costs "(as of 2026, verify)."_

Texas SandFest: 3-day beach sand-sculpture festival, Port Aransas TX, **100,000+ visitors**, lean nonprofit-style org. Existing platform: vanilla-JS public web app, Node admin API (file/Postgres storage, roles, rate limits, Stripe/orders/sponsors/tickets/alerts), native SwiftUI iOS app (QR scanner, tickets, schedule, push), QuickBooks scaffolding, document-ingestion pipeline. External stack: **Eventeny** (ticketing + vendor/sponsor applications), **Stripe** (planned owned checkout), **QuickBooks** (finance), **two-way radio** (on-site comms).

## The operating principle

> **Own the hub. Buy the point solutions. Build only the glue and the differentiators.**

The recurring finding across all eight research streams: your custom Node admin API + web + iOS app should be the **system of record and attendee experience**, while mature vendors handle the commodity workflows (ticketing, vendor apps, volunteer signup, email, PoC comms). You already own ~80% of the vendor/sponsor stack in Eventeny; the wins are (a) **glue** that syncs and reconciles those systems into one dashboard, and (b) **native differentiators** that no vendor sells — the branded attendee app, the sculpture map + passport, and the live ops console. Do **not** rebuild commodity SaaS; do **not** buy what Eventeny already does.

Second principle, from the connectivity + cashless research: **connectivity is the foundation.** Cashless, RFID, GPS, PoC comms, and live ops all depend on a network that works on a saturated beach. Get that right (or rent it) before layering anything network-dependent on top. And everything on-site must be **offline-first**.

## The platform as a hub

```
                         ┌───────────────────────────────────┐
   Eventeny  ──CSV/API──►│                                   │
   Stripe    ──webhooks─►│   NODE ADMIN API  (system of      │──► QuickBooks (Classes + clearing accts)
   Square    ──API──────►│   record + reconciliation hub)    │──► Twilio (SMS: confirmations, reminders, alerts)
   VolunteerLocal ─CSV──►│   revenue ledger · roster · fleet │──► Email/SMS marketing (Brevo) — consented buyers
   OnePlan   ──GeoJSON──►│   sculptors · hunt · alerts       │
   LoRaWAN   ──GPS──────►│                                   │
                         └──────────────┬────────────────────┘
                                        │  one canonical data feed (data/schemas/platform-objects.json)
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                   Public Web      iOS App          Ops Console
                   (visitor site)  (attendee +      (coverage, incidents,
                                    QR scanner)      revenue, fleet, alerts)
```

## Capability decisions

| Capability | Decision | Pick (primary) | Budget alternative | Rough cost (verify) | Research |
|---|---|---|---|---|---|
| **Ticketing** | Keep + own | Eventeny now; Stripe owned checkout when approved | — | Eventeny 3%; Stripe ~2.9%+30¢ | [05](research/05-rfid-cashless-ticketing.md) |
| **Revenue tracking** | **BUILD** (glue) | Unified revenue ledger in Node API → QuickBooks (Classes + clearing accounts) | Stripe+Eventeny CSV exports year 1 | internal build | [05](research/05-rfid-cashless-ticketing.md) |
| **Cashless payments** | Integrate (light) | **Open-loop tap-to-pay** (vendors' or org Square/SumUp); keep cash | vendors BYO Square | ~1.5–2.9%/txn | [05](research/05-rfid-cashless-ticketing.md) |
| **RFID wristbands** | **Defer** | QR-on-phone entry (already shipped) | — | $0 now | [05](research/05-rfid-cashless-ticketing.md) |
| **On-site connectivity** | Integrate/rent | **Starlink Priority + managed WiFi mesh** (rent yr 1) | 1 Starlink + prosumer mesh | $10–35k/wknd rent · $7.5–28k capex | [06](research/06-onsite-connectivity.md) |
| **Golf-cart GPS** | Integrate (cheap) | **LoRaWAN trackers** (shares the network's LoRa gateway) | AirTag-style | ~$30–80/tracker | [04](research/04-fleet-asset-tracking.md), [06](research/06-onsite-connectivity.md) |
| **Fleet/asset checkout** | **BUILD** (native) | Fleet module in Node API + iOS QR check-in/out | Cheqroom (~$184–367/yr) or Sortly free | internal build | [04](research/04-fleet-asset-tracking.md) |
| **Vendor apps + COI + booth fees** | Keep | **Eventeny** (already owns it) | EventHub | Eventeny 5.9% vendor-paid | [02](research/02-sponsor-vendor-mapping.md) |
| **Sponsor tiers + deliverables** | Keep | **Eventeny sponsor module** | Airtable | included | [02](research/02-sponsor-vendor-mapping.md) |
| **Site/booth mapping (ops)** | Integrate | **OnePlan** (GIS, emergency lanes, crowd capacity, BOQ) | Eventeny mapping + $1k custom map | free–£82/mo seasonal | [02](research/02-sponsor-vendor-mapping.md) |
| **Public booth/sculpture map** | **BUILD** (native) | **Mapbox** (web GL JS + iOS SDK, offline) | **MapLibre** OSS + Protomaps | ~$0 at event scale (free tier) | [03](research/03-sculptor-pages-wayfinding.md) |
| **Sculptor pages** | **BUILD** (native) | Native pages from JSON; Airtable/Sanity CMS for editors | existing JSON pipeline | internal build | [03](research/03-sculptor-pages-wayfinding.md) |
| **Scavenger hunt / passport** | **BUILD** (native) | Sculpture Passport in iOS (reuse QR scanner) + Node backend | GooseChase pilot (enterprise quote) | internal build | [07](research/07-engagement-scavenger-hunt.md) |
| **Volunteer signup + hours** | Buy + mirror | **VolunteerLocal** (festival-built, QR kiosk, earned tickets) → mirror into ops | Track It Forward ($12–36/mo) | ~$200–800/event | [01](research/01-volunteer-scheduling.md) |
| **Staff scheduling** | Buy | **Connecteam** free ≤10 (core team); Nowsta if paid event staff | shared sheet | $0–59/mo | [01](research/01-volunteer-scheduling.md) |
| **Email/SMS marketing** | Buy + glue | **Brevo** (send-based pricing) + consent-sync from checkout | Mailchimp | ~$9–18/mo | [08](research/08-marketing-communications.md) |
| **Social / design** | Buy | **Metricool** ($25) + **Canva** (free nonprofit) | Buffer free | ~$25/mo | [08](research/08-marketing-communications.md) |
| **Paid ads** | Buy (in-house) | Geofenced Google Search + Meta retargeting | Meta retargeting only | ad spend | [08](research/08-marketing-communications.md) |
| **Analytics** | Buy | **Fathom** (+GA4 if running ads) | Plausible | ~$15/mo | [08](research/08-marketing-communications.md) |
| **Staff comms** | Keep + augment | **Keep radio** backbone + **Zello Work** PoC | radio + Zello free | ~$8/user/mo | [08](research/08-marketing-communications.md) |
| **Incident/dispatch** | Keep now | Own platform for routine ops; 24/7 Software later if liability grows | — | quote later | [08](research/08-marketing-communications.md) |
| **Public alerts (SMS)** | **BUILD** (glue) + Buy | Extend alert API + **Twilio SMS** (short code for 100k), push already shipped | Twilio long code | <$100 setup; ~$0.011/segment (~$1,100/full blast) | [08](research/08-marketing-communications.md) |

## Phased roadmap

Ordered so foundations land before things that depend on them. Connectivity and the revenue/consent hub gate almost everything.

### Phase 0 — Foundation (now → fall 2026)
1. **Unified revenue ledger** in the Node admin API (Stripe webhooks + Eventeny/Square import → QuickBooks Classes + clearing accounts) + an ops-console revenue dashboard. *Highest ROI, decision-independent, three research streams converged on it — starting this now.*
2. **Consent capture at checkout** (separate email + SMS opt-ins) → the one glue build that feeds both marketing and safety-SMS.
3. **Canonical data model** for all new modules — done (`data/schemas/platform-objects.json`).
4. **Incoming docs/logins intake** — done (`docs/incoming-access-intake.md`, access registry).
5. Lock the **connectivity plan** (rent-vs-buy decision; get quotes from Festival WiFi Guys / Trade Show Internet).

### Phase 1 — Attendee experience + core ops (fall 2026 → April 2027)
6. **Sculptor pages + Mapbox sculpture/POI map** (web + iOS), marker-number + GPS layered.
7. **Sculpture Passport / scavenger hunt** (native, reuse iOS QR scanner) + People's Choice voting.
8. **Fleet module** (golf-cart/equipment checkout via iOS QR) + LoRaWAN GPS pins.
9. **Volunteer mirror** — VolunteerLocal → ops-console coverage view + hours into impact reporting.
10. **Public booth/vendor map** from Eventeny CSV; **OnePlan** operational site plan as base layer.
11. **Twilio SMS** live: ticket confirmations + event reminders + public alerts (A2P 10DLC + short code).
12. **Marketing stack** stood up (Brevo + Metricool + Canva + Fathom + geofenced ads).

### Phase 2 — Scale & polish (2027+)
13. **Website overhaul** cutover (see below) — separate public visitor site from ops console.
14. **Zello Work** PoC comms alongside radio.
15. Evaluate **RFID entry-only** for multi-day/VIP *if* the footprint becomes fully gated.
16. Evaluate **closed-loop cashless** *only* with proven network + consumer-friendly refund policy.
17. Evaluate **24/7 Software** for incident/dispatch if liability/volume grows.

## Website cleanup & overhaul (called out separately)

The current public site is a single 2,200-line page whose nav mixes **visitor** content (Live Beach, Tickets, Media, Sponsors, Port A) with **internal** demos (Ops, Admin, Finance, iOS, Build) — it reads as a platform pitch, not a visitor site. The coastal design system (sand/sun/coral/gulf) is solid and worth keeping. Overhaul = **split audiences**: a clean public visitor site (Home, Tickets, Schedule, Sculptors + Map, Food/Vendors, Plan Your Visit/FAQ, Sponsors) and a separate authenticated ops console (the admin/ops/finance surfaces). Sequenced in Phase 2 so it lands on top of the real modules (map, sculptors, tickets) rather than being rebuilt twice. Note: the live site appears **Wix-hosted** (media URLs are wixstatic) — the registrar/host logins in the access registry are needed to plan the cutover.

## Budget summary (recurring software, verify)

- **Marketing/analytics/comms SaaS:** ~$50–90/mo + ad spend + Zello ~$8/user/mo.
- **Volunteer:** ~$200–800/event (VolunteerLocal) or ~$12–36/mo (Track It Forward).
- **Mapping:** Mapbox ~$0 at event scale (free tier); OnePlan free–£82/mo seasonal.
- **Connectivity:** the big one — **$10–35k/weekend rented**, or $7.5–28k capex if buying (amortizes if annual).
- **Fleet GPS:** ~$30–80/tracker one-time.
- **SMS:** <$100 setup + ~$0.011/segment (a full 100k safety blast ≈ ~$1,100).
- **RFID/cashless:** **$0 now** (deferred); $38–52k+ only if adopted later.

The dominant line item is on-site connectivity; everything else is small monthly SaaS or internal build labor.

## What we need from you (blocks specific work)

Tracked in [`data/config/access-registry.json`](../data/config/access-registry.json). Highest-leverage logins to unblock Phase 0/1: **Stripe** + **Eventeny** (revenue ledger), **QuickBooks** (reconciliation), **domain/DNS + website host** (site overhaul), **Twilio** signup (SMS), **Mapbox** token (map). Documents most useful next: sponsor packet, vendor list + booth assignments, site map/permits, and last year's budget/finance export. Handle everything per [`docs/incoming-access-intake.md`](incoming-access-intake.md).

## Shipped this cycle (2026-07-15)

Four features built and verified (DOM + `npm run build`):
1. **Unified revenue ledger** — `lib/revenue.mjs` summarizer + seed + role-guarded `GET /api/admin/revenue` + a web dashboard panel in the admin console (KPIs, category/source breakdowns, fee rate, bank reconciliation). Wires to live Stripe/Eventeny/Square feeds when logins arrive.
2. **Sculptors section** (`public/data/sculptors.json`) — A–Z roster, division filters, artist detail, and a self-contained illustrated **corridor map** with positioned/live pins (no map token needed; Mapbox/GPS is the later native layer).
3. **Sculpture Passport** scavenger hunt — collect a stamp per sculpture, progress ring, prize-drawing finisher (web + localStorage now; native iOS QR-scan → backend is the follow-on).
4. **Public/ops split** — a **Visitor / Operations** header toggle that keeps the visitor site clean and moves ops/admin/finance/build surfaces behind Operations mode (mirrors the iOS Customer/Admin switch; persisted).

**Also shipped this cycle:**
5. **Fleet/asset checkout** — `lib/fleet.mjs` (normalize + check-out/in transitions) + seed `data/processed/fleet.json` + role-guarded admin API (`GET /api/admin/fleet`, resolve-qr, checkout, checkin, locations) with `fleet:read`/`fleet:write` + web ops panel + native iOS Admin → Fleet tab (QR via existing `QRScannerView`, offline-first local store). QR payload: `tsf:asset:<id>`.
6. **Volunteer coverage mirror** — `lib/volunteers.mjs` + seed `data/processed/volunteer-mirror.json` + `GET /api/admin/volunteers` / `.../coverage` (`volunteers:read`) + web ops panel (zone fill, understaffed shifts, hours). Buy VolunteerLocal; mirror only.
7. **Consent + Twilio SMS scaffold** — `lib/consent.mjs` + `lib/sms.mjs` + checkout opt-in UI (email / SMS promo / SMS safety, unchecked by default) + ledger `data/processed/consent-ledger.json` + `GET /api/admin/consent` + alert publish optional SMS fan-out (gated by `SMS_ENABLED`; Twilio env slots already in `.env.example`).

**Next up (blocked on logins where noted):** live Stripe/Eventeny/QuickBooks → revenue ledger; VolunteerLocal CSV → volunteer mirror; Twilio credentials → enable SMS; Mapbox token → GPS map layer; passport QR → backend completion.
