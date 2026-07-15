# SandFest Engagement & Scavenger-Hunt Platform Research

_Research stream 7 of 8 for the "ultimate festival platform" build. Compiled 2026-07-15. Pricing marked "(as of 2026, verify)."_

Scope: fun, family-friendly engagement mechanics (scavenger hunt and beyond) that lift dwell time, push foot traffic to sponsors/vendors, and create shareable moments — plus a buy-vs-build recommendation.

**Context that shapes every recommendation:** SandFest draws **100,000+ visitors** over 3 days on an open beach corridor, with food/craft/apparel vendors, a beer garden, kids' "Lesson Mountain" activities, and sponsors including Yeti and Southwest Airlines ([texassandfest.org](https://www.texassandfest.org/), [portaransas.org](https://www.portaransas.org/texas-sandfest/), [kiiitv.com](https://www.kiiitv.com/article/news/local/texas-sandfest-2026-returns-to-port-aransas/503-e0229988-d7bb-484c-be1a-ccf041c38d95)). The team **already ships an iOS app with a working QR scanner plus a Node backend**. That existing scanner + backend is the single most important fact in the buy-vs-build decision.

---

## 1. Engagement mechanics that work at festivals/events

Gamified formats lift attendee engagement **~30–60%** over passive formats, immersive/interactive formats push dwell time up **~12%**, and gamified challenges raise information retention **~40%** ([elationdigital.com](https://elationdigital.com/games-for-conferences/), [boomset.com](https://boomset.com/how-to-use-interactive-games-to-boost-event-roi/)). Coachella's 2024 in-app quests drove **~50,000 completions** and measurable foot traffic to sponsored activations ([ticketfairy.com](https://www.ticketfairy.com/blog/2025/09/17/gamifying-the-festival-experience-interactive-challenges-to-boost-engagement/)).

| Mechanic | What it is | Why it works | Effort | Sponsor / monetization angle |
|---|---|---|---|---|
| **Digital scavenger hunt** | In-app missions to find/scan/photograph things | Drives directed movement; Coachella logged ~50k completions | Med | "Visit 5 sponsor booths"; grand-prize sponsor; branded checkpoints |
| **Passport / stamp trail** | Collect a stamp per sculpture or vendor; complete for a reward | Proven at food/beer fests; each page = one vendor/sponsor | Low–Med | Each stamp = a vendor visit; sponsor the reward |
| **Photo challenge / UGC** | "Selfie with a master sculpture," posted with hashtag/in-app gallery | Free reach via shareable branded content | Low | Branded frame/filter; sponsor prize; opt-in email capture |
| **AR experience / filter** | Face filter or "see the finished sculpture" overlay, QR-triggered | Novel, shareable; WebAR needs no app download | Med–High | Sponsor-branded lens; measurable shares |
| **Gamified map w/ check-ins** | POIs unlock on arrival | Turns navigation into a game | Med | Sponsored pins; "sponsored detour" checkpoints |
| **Leaderboards** | Live ranking of points/stamps | Competitive pull | Low | "Leaderboard presented by [sponsor]" |
| **Prize drawing tied to participation** | Complete N actions → raffle entry | Low-friction incentive | Low | Sponsor donates prize for logo + lead list |
| **Kids' activity trail** | Simplified illustrated hunt (ties to "Lesson Mountain") | Keeps families longer | Med | Family-brand sponsor; kid-prize at a sponsor tent |
| **Voting ("People's Choice")** | Vote for favorite sculpture in-app | Sand-fest staple, today mostly **physical tokens** — ripe to digitize ([hamptonbeach.org](https://hamptonbeach.org/events/sand-sculpture-event/), [siestakeycrystalclassic.com](https://www.siestakeycrystalclassic.com/event-info/about)) | Low–Med | Title sponsor; captures every voter's device/email |
| **Trivia** | Quiz questions unlocked at stops | Adds dwell time + education | Low | Sponsor-branded question sets |

---

## 2. Tooling to power a scavenger hunt

**Critical caveat at 100k attendees:** most platforms price by participant, and even paid single-event tiers top out in the low hundreds — festival scale forces a **custom enterprise quote** and gets expensive fast. That economics gap is the core argument for building native.

| Platform | Key features | Pricing (as of 2026, verify) | Fit |
|---|---|---|---|
| **GooseChase** | Photo/video/GPS/text/QR missions, AI generator, live leaderboard, splash screens, **built-in sponsor incorporation** | Free ≤3 players; single-event "Basic" ~$99 (≤10); tiers at 40/100/175; larger = quote | Strongest turnkey, but **175-participant single-event ceiling**; players use GooseChase's app |
| **Scavify** | QR scan, GPS, photo/video, Q&A, survey; leaderboard; custom branding | Quote-only; ~$1,080 (60) / ~$1,300 (100) / ~$1,560 (120) | Good match; per-player pricing balloons |
| **Eventzee** | Photo/video/quiz/GPS/QR/text; leaderboards; logo branding; "drive traffic to vendors" | Entry $49.99 Party Pack, else quote | On-theme, quote-gated at scale |
| **Actionbound** | Q&A, photo/video/audio, GPS+QR, surveys | One-off pricing by player count (not per-seat); EDU/nonprofit discounts | Best value structure for a one-time large event |
| **Let's Roam (business)** | Done-for-you curated hunts, coordinators, branding; "10 to 10,000+" | Custom quote | Most hand-holding, least control |
| **Loquiz** | Branching logic, conditional unlocks, puzzles | Tiered | Good for complex puzzle logic |
| **TryHuntt** | **Could not verify** — appears defunct; do not rely on | — | Not recommendable |
| **DIY QR (build native)** | Your iOS QR scanner + Node backend; `qrcode` npm for checkpoint codes | Dev time only; hosting already on Render | **Best fit given existing scanner + backend**; unlimited players, zero marginal cost |

**Bolt-ons rather than rebuilds:** Live voting — Slido, CrowdPurr, DirectPoll (QR-to-vote, no app). AR — ⚠️ **Meta Spark AR shut down Jan 14, 2025**; use Snapchat Lens Studio, TikTok Effect House, or WebAR (8th Wall) — WebAR is QR-triggered, no download ([spark.meta.com](https://spark.meta.com/blog/meta-spark-announcement/), [yordstudio.com](https://yordstudio.com/the-best-ar-spark-alternatives-in-2025/)).

---

## 3. SandFest-specific ideas

| # | Idea | How it works | Attendee value | Sponsor value | Effort |
|---|---|---|---|---|---|
| 1 | **Sculpture Passport** | Scan QR at each master sculpture → artist story/audio + digital stamp; collect all → reward | Deeper connection to art; self-guided tour | "Presented by [sponsor]"; logo on every stamp | Med — build native |
| 2 | **People's Choice voting** | In-app/QR ballot; live results; winner Sunday | Replaces physical tokens; one-tap | Title sponsor; every voter = opt-in email | Low–Med — native or Slido |
| 3 | **Kids' Beach Treasure Hunt** | Simplified 5–6 stop trail tied to Lesson Mountain; prize tent finish | Keeps families on-site | Family-brand sponsor; prize handoff = foot traffic | Med — reuse passport engine |
| 4 | **Sponsor Checkpoint Quest** | "Visit 5 sponsors"; scan QR at each → grand-prize raffle | Path to prizes; something to do | Measurable booth traffic + leads (Coachella model) | Low–Med — build native |
| 5 | **Branded Photo Challenge** | Prompts; photos to in-app gallery with SandFest/sponsor frame | Shareable; fun for groups | Every share carries sponsor branding; UGC library | Med — build native |
| 6 | **"See it Finished" AR preview** | Day 1: scan QR at in-progress sculpture → WebAR finished render | Wow-factor; reason to return | Sponsor-branded lens; shareable | High — buy/WebAR |
| 7 | **Sculpture Trivia unlocks** | Each scan reveals a trivia question; correct = bonus points | Dwell time + learning | Sponsor-branded question sets | Low — extends passport |
| 8 | **Vendor Tasting/Shopping Trail** | Stamp per vendor; complete a "row" → discount/raffle | Discovery of missed vendors | Direct vendor sales lift | Low–Med — same engine |

Ideas 1, 2, 4, 5, 7, 8 all run on **one shared engine** (POIs + QR scans + completions + rewards). That reuse is why building native is cheaper than it looks.

---

## 4. Recommendation

### Primary: Build a native "Sculpture Passport / Scavenger Hunt" into the existing app
They already have the two hard pieces — a **QR scanner** and a **Node backend**. Building native wins on:
1. **Economics at 100k scale** — every SaaS prices per participant or needs an enterprise quote past a few hundred players. Native = zero marginal cost per player.
2. **Brand + one-app experience** — attendees stay in the SandFest app alongside tickets, schedule, lineup, map. No second download.
3. **Sponsor + map integration** — checkpoints are the same POIs as the festival map; sponsor pins, sponsored detours, and stamps share one dataset. Sponsors get logo placement, checkpoint ownership, and captured opt-in emails.

**Year-one scope (keep tight):** Sculpture Passport (#1) + People's Choice voting (#2) + Sponsor Checkpoint raffle (#4). Add kids' trail (#3) and photo gallery (#5) if time allows. Defer AR (#6) to a WebAR pilot — the one piece worth buying, not building.

### Budget / de-risk alternative: GooseChase for year one
If engineering bandwidth is thin before April 2026, run GooseChase as a one-year pilot (native sponsor incorporation + branding out of the box). Budget for a custom enterprise quote (public $99 tier caps at 10 participants; largest single-event tier is 175). Trade-offs: recurring cost that scales badly, players in GooseChase's app, no reuse toward the native build. Treat as a one-season learning exercise, then migrate in-house.

**Bottom line:** Build native. The QR scanner + Node backend already shipped turn a $1,300-to-enterprise-quote SaaS dependency into a weekend-scale data model plus a few screens.

### Data model (reflected in `data/schemas/platform-objects.json`)
```
Hunt(id, title, type[passport|scavenger|kids|vendor_trail], starts_at, ends_at, sponsor_id?, reward, active)
Checkpoint/POI(id, hunt_id, kind[sculpture|vendor|sponsor|kids_stop], title, lat, lng, qr_token UNIQUE,
               content{artistStory,audioUrl,triviaQ,imageUrl}, sponsor_id?, points, order_index?)
Completion/Stamp(id, device_id, checkpoint_id, hunt_id, scanned_at, photo_url?, trivia_correct?)  UNIQUE(device_id, checkpoint_id)
Reward(id, hunt_id, type[raffle_entry|discount|badge|prize], threshold, sponsor_id?, fulfillment{code,tentLocation,emailCapture})
Vote(id, device_id, sculpture_id, created_at)  UNIQUE(device_id, hunt_id)
```
`Checkpoint` *is* a map POI (shares lat/lng), so sponsor pins, sponsored detours, passport stamps, and vote targets read from one table. Completion/Vote rows double as a real-time sponsor-ROI analytics feed.

---

### Sources
Texas SandFest: [texassandfest.org](https://www.texassandfest.org/), [portaransas.org](https://www.portaransas.org/texas-sandfest/), [kiiitv.com](https://www.kiiitv.com/article/news/local/texas-sandfest-2026-returns-to-port-aransas/503-e0229988-d7bb-484c-be1a-ccf041c38d95) · Gamification metrics: [ticketfairy.com](https://www.ticketfairy.com/blog/2025/09/17/gamifying-the-festival-experience-interactive-challenges-to-boost-engagement/), [boomset.com](https://boomset.com/how-to-use-interactive-games-to-boost-event-roi/), [elationdigital.com](https://elationdigital.com/games-for-conferences/) · Platform comparison: [blog.goosechase.com](https://blog.goosechase.com/best-scavenger-hunt-apps-your-complete-guide-to-scavenger-hunt-platforms-in-2026/), [playtours.app](https://www.playtours.app/post/the-only-scavenger-hunt-app-pricing-guide-you-need-for-2024---for-all-use-cases) · GooseChase: [features](https://goosechase.com/features), [pricing](https://goosechase.com/pricing), [branding/sponsors](https://support.goosechase.com/en/collections/3254170-branding) · Scavify: [scavify.com](https://www.scavify.com/), [event passport](https://www.scavify.com/blog/event-passport) · Eventzee: [eventzeeapp.com](https://eventzeeapp.com/pricing/) · Actionbound: [en.actionbound.com](https://en.actionbound.com/pricing) · Voting: [slido.com](https://www.slido.com/features-live-polling), [crowdpurr.com](https://www.crowdpurr.com/poll) · AR: [spark.meta.com](https://spark.meta.com/blog/meta-spark-announcement/), [yordstudio.com](https://yordstudio.com/the-best-ar-spark-alternatives-in-2025/) · People's Choice precedent: [hamptonbeach.org](https://hamptonbeach.org/events/sand-sculpture-event/), [siestakeycrystalclassic.com](https://www.siestakeycrystalclassic.com/event-info/about)
