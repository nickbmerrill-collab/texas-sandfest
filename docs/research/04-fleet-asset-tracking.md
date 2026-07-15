# Fleet & Equipment (Golf Cart / Asset) Tracking

_Research stream 4 of 8. Compiled 2026-07-15 (inline, after async agents stalled). Pricing marked "(as of 2026, verify)."_

Context: SandFest's "fleet" = **event vehicles (golf carts, UTVs/Gators, ATVs, rented trucks), generators, and load-in equipment** — not a highway trucking fleet. Need: check-out/in of carts to teams, driver logs, fuel/charge tracking, damage reporting, GPS location during the 3 days, and a simple mobile/kiosk flow. They already ship an **iOS QR scanner + Node backend**.

## Option A — Full fleet/telematics suites (overkill for a 3-day event)
| Tool | What | Fit |
|---|---|---|
| **Fleetio** | Maintenance, fuel, inspections, parts; API; integrations | Year-round vehicle fleets; heavy for a 3-day rental pool |
| **Samsara / Verizon Connect** | Hardware telematics + GPS + ELD | Enterprise logistics; expensive hardware contracts |
| **Whip Around / Simply Fleet** | Driver inspections (DVIR), maintenance | Inspection-centric; more than needed |

Verdict: these solve *ongoing* fleet maintenance/compliance, not a 3-day checkout log. Skip.

## Option B — Lightweight asset/equipment checkout (closer fit)
| Tool | Check-out/in | Mobile / QR | Pricing (verify) | Notes |
|---|---|---|---|---|
| **Cheqroom** | Purpose-built equipment checkout; self-service bookings, PDF agreements, custody chains, maintenance/damage log | Auto-generates a QR per item; mobile app; offline | Core ~$184/yr, Business ~$275/yr, Enterprise ~$367/yr; **per-item tiers get pricey past ~50 items** | Best turnkey checkout tool; but adds a login + per-item cost + doesn't feed your ops dashboard ([cheqroom.com/pricing](https://www.cheqroom.com/pricing/), [Capterra](https://www.capterra.com/p/140824/CHEQROOM/)) |
| **Sortly** | Inventory + checkout, photo-first | **Native offline mobile app**, QR/barcode | Free 100 items/1 user; paid from $49/mo (per-user gets pricey) | Great mobile UX; simple ([Capterra](https://www.capterra.com/p/169199/Sortly-Pro/)) |
| **Snipe-IT** | Open-source asset mgmt, check-out/in | QR/barcode; self- or cloud-host | **Free if self-hosted**; cloud from ~$400/yr | IT-asset oriented, text-heavy config ([Capterra](https://www.capterra.com/p/150016/Snipe-IT/)) |
| Asset Panda / Reftab / EZOfficeInventory | Configurable asset tracking | QR/barcode, mobile | Quote/tiered | Heavier, more config |

## Option C — GPS location for carts (a hardware layer, separate from checkout)
- **LoRaWAN trackers** (Digital Matter, MOKOSmart) — **recommended**, since the connectivity plan already includes a LoRaWAN gateway: years of battery, no SIM fees, whole-footprint coverage, pings into `assetLocation` records. See [06-onsite-connectivity.md](06-onsite-connectivity.md).
- **AirTag/consumer GPS approach** — ScheduleFleet uses AirTag-powered live mapping w/ ~5-min updates; cheapest for a short window ([golfcartrentalsoftware.com](https://golfcartrentalsoftware.com/)).
- **Cellular GPS trackers** (Trackhawk, SpaceHawk, Connected Vehicles) — simple monthly trackers if cellular holds on the beach.

## Recommendation

**Primary: BUILD a minimal native "Fleet" module** in the Node admin API + iOS QR scanner, plus **cheap LoRaWAN trackers** for live cart location. Rationale mirrors the scavenger-hunt and revenue-dashboard calls: you already have the QR scanner + backend, the need is a *3-day checkout log* (not year-round telematics), and only a native module can feed the **ops dashboard** (which cart is where / who has it) and **QuickBooks** (rental costs → bills). The records already exist in `data/schemas/platform-objects.json`:

```
asset(id, type[golf_cart|utv|generator|truck|equipment], label, identifier, owner[rental|owned],
      rentalVendor, rentalCostCents, quickBooksBillId, powerType, gpsTrackerId, condition, status, homeZoneId)
assetCheckout(id, assetId, checkedOutTo, team, checkOutAt, checkInAt, startCondition, endCondition,
      startChargePct, endChargePct, damageReport, signatureBy, method[ios_scan|kiosk])
assetLocation(id, assetId, at, lat, lng, beachMarker, source[gps_tracker|manual])
```
Flow: ops scans a cart's QR in the iOS app → checks it out to a team with start charge/condition → check-in records end state + damage notes → LoRaWAN trackers post `assetLocation` pings to a live map. Rental costs post to QuickBooks as bills.

**Budget/de-risk alternative: Cheqroom (~$184–367/yr) or Sortly free tier** for the checkout log if engineering bandwidth is thin before April 2026, plus standalone AirTag/LoRaWAN trackers for location. You get checkout + damage logging immediately, at the cost of a separate login and no native ops-dashboard/QuickBooks integration (reconcile by export year one, build native later).

### Sources
[Cheqroom pricing](https://www.cheqroom.com/pricing/) · [Cheqroom (Capterra)](https://www.capterra.com/p/140824/CHEQROOM/) · [Sortly (Capterra)](https://www.capterra.com/p/169199/Sortly-Pro/) · [Snipe-IT (Capterra)](https://www.capterra.com/p/150016/Snipe-IT/) · [Asset tracking comparison 2026](https://taglogger.com/resources/asset-tracking-software-comparison/) · [Golf cart fleet/GPS software](https://golfcartrentalsoftware.com/) · [Golf cart fleet mgmt overview](https://taraelectricvehicles.com/blog/2025/08/29/golf-cart-fleet-management-software-how-it-works-key-benefits-and-top-platforms/)
