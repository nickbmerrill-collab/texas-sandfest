# Texas SandFest — On-Site Connectivity Decision Report

_Research stream 6 of 8. Compiled 2026-07-15. All 2026 prices indicative — marked "(verify)"._

**Scenario:** 3-day festival on ~1 mile of open beach, Port Aransas. Weak/congested public cellular. Need a **private LAN** covering the footprint for **~100 concurrent staff/ops users** (data + comms) with headroom for cashless POS, RFID scanning, GPS asset tracking, push-to-talk. Attendee WiFi secondary.

> **TL;DR:** For a 3-day event, the pragmatic answer is **Starlink Priority backhaul + a professionally-designed outdoor WiFi mesh (PtP wireless backbone, solar/battery power, VLAN segmentation)** — built in-house (~$23–28k capex, reusable) or **rented from a festival connectivity specialist (~$10–35k for the weekend, all-in)**. Add a **bonded-cellular or 2nd Starlink** for backhaul redundancy. **Private CBRS/LTE is technically superior for wide beach coverage but overkill/SIM-heavy for a one-off** — a scale/recurring option only. **LoRaWAN** is the right cheap tool for golf-cart GPS + sensors.

## Three independent layers (+ power)
(A) internet backhaul/uplink, (B) on-site distribution (WiFi and/or private cellular), (C) low-power IoT.

### 1A. Backhaul / uplink
| Option | Beach-viable? | Cost (verify) |
|---|---|---|
| **Starlink Priority** (HP flat dish; 50GB→2TB Local Priority) | **Yes — default for remote festivals**; real-world 80–120 Mbps sustained over 72h | Dish **$1,999**; plans ~$140/mo (50GB) → $615/mo (1TB) |
| **Starlink Roam** | Works, no traffic prioritization — backup/budget only | Mini $199 / Std $349; $55–175/mo |
| **Bonded cellular** (Peplink SpeedFusion, Cradlepoint) | **Best as redundancy layer**, bonded w/ Starlink | Router ~$900–1,600 + SpeedFusion CarePlan |
| Fixed wireless / PtP microwave | Only if a fiber PoP is within line-of-sight | Quote |
| Temp carrier fiber/COW | Long lead, expensive, rarely justified | Carrier quote |

**Verdict:** Starlink Priority (1TB) primary + bonded-cellular/2nd Starlink backup. Trade Show Internet & Festival WiFi Guys standardize on Starlink for beach venues.

### 1B. On-site WiFi mesh / distribution
APs (outdoor-rated): **Ubiquiti UniFi** (best price/perf, no license — U7 Outdoor $199, U6 Mesh $179); **airFiber/airMAX** for PtP backhaul bridges (AF-5XHD $580); **Cambium cnPilot** (IP67 carrier-grade, sector antennas good for a linear beach); **Aruba Instant On** (no recurring license); **Cisco Meraki** (polished but mandatory recurring license → high TCO for a one-off).

**Coverage for ~1 mile:** the *linear geometry*, not the 100-user count, drives AP quantity — roughly **one AP/sector cluster every ~300–500 ft → ~10–18 APs**, ideally directional/sector antennas aimed down the beach. **Do NOT backhaul APs over WiFi mesh** — use wired Ethernet where possible + airFiber/airMAX PtP hops between elevated head-end nodes.

**Power:** no grid → **solar + battery per node** (Ventev/Tycon/Voltaic) or quiet inverter generators; solar-first avoids diesel noise near sculptures.

### 1C. Private cellular (CBRS / private LTE/5G)
CBRS = shared 3.5 GHz (LTE Band 48), coordinated by a cloud SAS. **Up to ~10× WiFi's outdoor coverage per radio** — one Baicells Nova 430i sector covers ~2 miles / 96 devices. Vendors: Baicells (DIY ~$5–6k/radio, needs RF expertise), Celona (turnkey but ~$57.5k/outdoor AP), Betacom (managed 5GaaS). **Watch-outs:** every client device must be CBRS-band + SIM-provisioned (most staff phones/POS aren't); **Google SAS retiring (no new customers after June 2026)** → use Federated Wireless/Key Bridge; **Helium phased out CBRS (Mar 2025)**. **Verdict: overkill for a single 3-day beach event; revisit only if SandFest recurs annually and standardizes CBRS devices.**

### 1D. Managed rental providers (often the pragmatic answer)
| Provider | Fit | Highlights |
|---|---|---|
| **Festival WiFi Guys** | Strong | Solar "Link Swarm" mesh + Starlink; ready-made BOH/Guest/Vendor/RFID/POS segments |
| **Trade Show Internet** | Strong | Turn-key design/deploy/on-site engineer; has built beach/pier networks |
| **Made By WiFi** | Good | High-density mesh, VLAN isolation; publishes cost ranges |
| **Backstage Networks** | Good (large) | Delivered 20k-attendee 3-day fest w/ 500 POS devices |

Cost ranges (verify): large events (500+ guests) **$10k–$50k+**; basic kits $395–595/day.

### 1E. LoRaWAN (right tool for GPS + sensors)
Golf-cart GPS + asset sensors = low data, infrequent → **LoRaWAN**, not WiFi/cellular. One gateway covers 2–10 km (open beach = ideal LOS); trackers run years on battery, no SIM fee. Vendors: Milesight AT101, Digital Matter, MOKOSmart. Trackers ~$30–80; one gateway covers the footprint.

## 2. Recommended design
**Requirement sizing:** staff data ~30–80 Mbps aggregate peak; PTT negligible (prioritize w/ QoS); POS/RFID tiny + offline-first; GPS on LoRaWAN. **A single Starlink Priority covers the internet demand with headroom** — the real problem is *coverage* (distribution layer: AP placement + backhaul + power), not bandwidth.

**Primary design — "Starlink + segmented outdoor WiFi mesh":** Starlink Priority → firewall/router w/ VLANs & QoS → PtP wireless backbone linking 3–5 elevated head-end nodes → directional/omni outdoor APs → solar/battery → separate LoRaWAN gateway for GPS. Bonded-cellular as backup WAN. **DIY capex ~$23–28k (reusable); or rent managed ~$10–35k/weekend.** For a first deployment on an unforgiving beach, **rent managed** (FWG or TSI); if annual, buy UniFi/Cambium + Starlink and bring a contractor for design year one.

**Budget option — "One Starlink + prosumer mesh" (~$7.5–10k capex):** covers hot zones (staff LAN + gate/vendor), not the full mile; more babysitting; no redundant backhaul.

**Beach logistics:** IP66/67 gear, marine mounts, masts/scaffolding (sand won't hold stakes), keep electronics above tide/surge line, confirm city beach-access/permitting.

## 3. Resilience
- **Dual backhaul:** Starlink Priority + Peplink cellular failover (SpeedFusion hot-failover).
- **Offline-first POS/RFID is mandatory** — closed-loop authorizes locally, syncs when connectivity returns (Coachella/Lolla/Tomorrowland all offline-tolerant). A day-one network failure scrapped RFID at Download 2015.
- **PTT fallback:** Zello runs over WiFi *or* public cellular; keep a few two-way radios as ultimate backstop.
- **Security:** VLAN-segment BOH/POS/RFID/guest/cameras; WPA2/3-Enterprise for staff; client isolation + firewall on guest; never put POS/RFID on guest SSID; lock node enclosures (theft risk).

### Sources
[starlink.com/business](https://starlink.com/business), [satelliteinternet.com](https://www.satelliteinternet.com/providers/starlink/), [peplink.com/speedfusion](https://www.peplink.com/technology/speedfusion-bonding-technology/), [store.ui.com/wifi-outdoor](https://store.ui.com/us/en/category/wifi-outdoor), [store.ui.com/airfiber](https://store.ui.com/us/en/category/wireless-airfiber-ptp), [cambiumnetworks.com](https://www.cambiumnetworks.com/products/wifi/cnpilot-e505-wifi-access-point/), [celona.io/cbrs-vs-wifi](https://www.celona.io/cbrs/cbrs-vs-wifi), [waveform.com/nova-430i](https://www.waveform.com/products/nova-430i-integrated-antenna), [festivalwifiguys.com/services](https://festivalwifiguys.com/services), [tradeshowinternet.com/festivals](https://tradeshowinternet.com/event-types/festivals), [madebywifi.com/costs](https://www.madebywifi.com/blog/event-wifi-costs-what-you-need-to-know-before-you-plan/), [bsn.live/festivals](https://www.bsn.live/solutions/by-event-type/festivals/), [digitalmatter LoRaWAN](https://www.digitalmatter.com/our-devices/lorawan-gps-trackers/), [ventevinfra.com solar](https://ventevinfra.com/products/power-systems/solar-power-systems-power-systems/solar-for-wifi/), [zello.com](https://zello.com/), [intellitix ITX POS](https://www.intellitix.com/itxpos)
