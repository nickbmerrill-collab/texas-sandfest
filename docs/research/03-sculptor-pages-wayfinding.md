# Sculptor Pages & Location-Aware Sculpture Map

_Research stream 3 of 8. Compiled 2026-07-15. Pricing marked "(as of 2026, verify)."_

SandFest's headline is *the sculptures at fixed physical locations* across divisions (Master Duo/Solo, Semi-Pro, Non-Competing Master, Amateur). The current official sculptor page groups by division and links out to bios/socials but has **no map or pin→artist linking** — exactly the gap to close.

## 1. Patterns worth copying
**Closest analog = sculpture parks / art trails** (they solved outdoor "pin → artwork → artist"):
- **Laumeier Sculpture Park app** — interactive map, **color-coded colorblind-safe markers**, named zones, artwork pages w/ bio + 360° images, **search by title/artist/color**, bookmark, audio + screen-reader a11y ([laumeier](https://www.laumeiersculpturepark.org/laumeier-app)).
- **Grounds For Sculpture map** — **GPS-enabled**; **search/sort by artwork number**, artist, title (the number search parallels SandFest beach markers); category filters; **pathway accessibility tiers** ([gfsmap](https://www.gfsmap.org/map-faqs)).
- **Wild in Art trail app** — **collect each sculpture by entering a code on the physical plaque** (SandFest can reuse beach-marker numbers) ([wildinart](https://wildinart.co.uk/app/)).
- **Mapme art-trail best practices** — rich media per pin, draw a route for a linear trail, **QR at each work deep-links to detail**, interaction analytics ([mapme](https://mapme.com/blog/best-practices-for-art-trail-maps/)).

**Music-festival apps** add the *live/personalization* layer: artist card→detail, **"My Sculptors" favorites**, and **"Now sculpting live"** status (planning→sculpting→complete→judged) as a banner + pulsing pin (iOS Live Activities pattern). **Art fairs** (Art Basel) add bidirectional **directory ⇄ map pin** linking.

**Outdoor map best practices:** POIs rarely have addresses → capture by **lat/long or dropping a pin**; "You Are Here" GPS + hand-off to Google Maps/Waze for driving; categorized pins + filters; real-time updates; **QR entry points + offline vector tiles** for a congested-cell beach.

## 2. Map tooling
| Platform | Web | Native iOS | Custom illustrated map | Pricing (verify) | Fit |
|---|---|---|---|---|---|
| **Mapbox** | GL JS | Maps SDK (offline) | Yes (custom style / georef raster overlay) | Mobile **25k free MAU/mo** then $4/1k↓; Web **50k free loads/mo** | **Strong primary** — one stack, native + web, offline; free tier covers the event |
| **MapLibre** (OSS) | GL JS | **Native iOS SDK** (offline) | Yes (Mapbox Style Spec; bundled tiles) | **Free/OSS** + tile hosting | **Best budget/OSS** — same style spec as Mapbox, no per-MAU fee/lock-in |
| **Proxi.co** (no-code) | embed/QR | none | **Yes — illustrated no-code** | free trial; Pro/Premium (API on Premium) | **Fastest web MVP** to lock pin taxonomy; embed not integrate |
| Google Maps | JS API | iOS SDK | limited | per-SKU (verify iOS) | weak for illustrated aesthetic |
| Concept3D / Mappedin | yes | yes | yes | ~$5–25k/yr / quote | enterprise/indoor — overkill |

Tile hosting for the OSS route: **MapTiler Cloud** (Flex $25/mo, Unlimited $295/mo) or self-host **Protomaps** (single `.pmtiles` on CDN, near-zero cost).

**CMS for ~50–150 sculptor profiles:** keep the existing **JSON bootstrap/iOS seed** as source of truth; add **Airtable** (editor-friendly, API) or **Sanity** (dev-friendly, Git-versioned schemas) if non-devs need to edit.

## 3. Recommendation
**Primary: Mapbox** (Maps SDK for iOS + GL JS web) — one style across native + web, offline tiles for the beach, free tier covers a 100k event. Render the **illustrated beach corridor as a custom style / georeferenced raster overlay** so pins sit at true GPS but look hand-drawn, with real "You Are Here." **Budget/OSS: MapLibre Native + Protomaps/MapTiler** (same Style Spec → minimal switching churn, no per-MAU fee). **Fastest MVP: Proxi** for the web map, then port pins into the native build.

**Capture sculpture location three ways, layered:**
1. **Beach marker number** (primary human key — everyone already uses 12.5, 13; enables search + works with zero GPS).
2. **GPS lat/long** (machine truth — "You Are Here," route-to-pin, correct overlay placement; capture by dropping a pin at each sculpture during setup).
3. **Illustrated-map (x,y)** normalized 0–1 (visual fallback if GPS is poor).

Store a **`markerIndex` (beachMarker → coordinate)** once so entries placed by marker number inherit GPS automatically — keeps the pipeline marker-first while gaining true GPS. Add per-sculptor **`status`** for "Now sculpting live" and a **QR per marker** deep-linking to the entry.

**Data model:** three linked entities — **Sculptor ⇄ Entry ⇄ MapMarker/POI** (bidirectional, Art Basel pattern), colorblind-safe `colorKey`+`legend`, POI `accessibility` tiers, POIs are GeoJSON-friendly (1:1 to Mapbox/MapLibre features). This is reflected/aligned in `data/schemas/platform-objects.json` (`sculptor`, `sculptureEntry`, `mapMarker`) — extend those with `markerIndex`, `illustratedMapXY`, `colorKey`, and `accessibility` when building.

**Build shape:** web + iOS render from the same JSON + same style + same POI GeoJSON; A–Z roster + division filters + search by name/marker/title; map screen w/ category chips + colorblind-safe pins + "You Are Here" + tap pin→entry→sculptor; "My Sculptors" favorites; "Now sculpting live" banner; QR at each marker; offline-seed tiles + JSON.

### Sources
[Laumeier app](https://www.laumeiersculpturepark.org/laumeier-app) · [Grounds For Sculpture map](https://www.gfsmap.org/map-faqs) · [Wild in Art app](https://wildinart.co.uk/app/) · [Mapme art trails](https://mapme.com/blog/best-practices-for-art-trail-maps/) · [Mapme festival maps](https://mapme.com/blog/interactive-festival-maps-guide/) · [Mapbox pricing](https://www.mapbox.com/pricing) · [Mapbox iOS pricing](https://docs.mapbox.com/ios/maps/guides/pricing/) · [MapLibre Native](https://maplibre.org/projects/native/) · [Proxi events](https://www.proxi.co/proxi-event-mapping) · [MapTiler pricing](https://www.maptiler.com/cloud/pricing/) · [Sanity](https://www.sanity.io/headless-cms) · [Airtable as CMS](https://www.whalesync.com/blog/using-airtable-as-a-cms) · [SandFest sculptors](https://www.portaransas.org/texas-sandfest/sculptors/)
