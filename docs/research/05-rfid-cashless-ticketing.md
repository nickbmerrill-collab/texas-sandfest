# Festival Technology Strategy — RFID, Cashless, Ticketing & Revenue

_Research stream 5 of 8. Compiled 2026-07-15. Cost figures marked "verify" are directional._

## Executive summary
**The honest answer on cashless + RFID for SandFest: mostly "not yet, and not the closed-loop version."** The 15–30% spend-uplift figures come from *fully-gated, fully-ticketed* festivals where every attendee is wristbanded behind a fence (Coachella, Tomorrowland, EDC, Bonnaroo). SandFest is a beach festival with many independent food/retail vendors and open/lightly-gated access — the profile where closed-loop RFID cashless adds the *most* cost/risk while delivering the *least* advantage, and where it generates attendee backlash (refund fees, dead balances, network-failure outages).

**What wins at your scale:**
1. **NOW** — QR/barcode e-tickets on phones for access (you already have an iOS QR scanner), and **open-loop contactless** (attendees tap their own card/phone; vendors run their own or org-provided Square/SumUp tap-to-pay). Captures most of the *speed* + *spend* benefit with none of the top-up/refund liability.
2. **NOW** — A **unified revenue dashboard** in the Node admin API pulling Eventeny + Stripe via webhooks, reconciled to QuickBooks. Highest-ROI build, cheap.
3. **LATER / pilot** — RFID *entry-only* wristbands for multi-day/VIP if you move to a fully gated model. Closed-loop cashless only if you later want the spend data *and* can guarantee network + a consumer-friendly refund policy.

## 1. Benchmark — what successful festivals do
| Festival | RFID? | Cashless | Notable |
|---|---|---|---|
| **Coachella** (~125k/day) | Yes | Fully cashless since 2022 | ~**25% per-cap spend lift** |
| **ACL / Austin City Limits** (~75k/day, TX) | Yes | RFID cashless via Amex; activation optional | **Closest big comp to you**; no financial data on band, PIN required; "Tag-a-kid" child safety |
| **Bonnaroo** (~80k) | Yes (Intellitix) | Bands mailed, activated online | "Tap-out" on exit blocks band-sharing; no paper tickets |
| **Lollapalooza** (~100k/day) | Yes | "Lolla Cashless," **built to run offline** (poor Grant Park connectivity) | 50–90% adoption, ~⅓ of transactions |
| **Tomorrowland** (~400k) | Yes | Proprietary "Tuents" wallet (€100M+) | 28 entries/sec, **81% shorter peak waits**; 1,200+ clone attempts flagged |
| **SXSW** (Austin, TX) | Badge RFID + **QR on every badge** | App drink payments | Anonymized dwell-time/pathway data optimizes layout |

**Mid-size comps:** 2000Trees (PlayPass) **+24% spend/head**; Bestival (Tappit) **+22% takings, 80% faster**. ⚠️ **Download 2015:** day-one RFID network failure → reverted to cash & card next year.

**Proven:** RFID as access-control + anti-fraud credential; 15–30% spend uplift *only when fully closed-loop behind a fence*; rich first-party data. **Scales down to a beach festival:** phone QR entry, open-loop tap-to-pay, real-time dashboards.

## 2. RFID & access control
NFC (13.56 MHz, reads on phones, chip ~$0.05–0.15) for cashless/ID; UHF (860–960 MHz, 1–5 m reads) for queue-busting portals. Anti-clone via NTAG 424 DNA. Vendors: **Intellitix** (from 2.9%/txn; organizer = merchant of record, can pay vendors day-of), **ID&C/IDentiband** (bands; supplied Bonnaroo's 80k), **Tappit**, **PlayPass**, **Weezevent**, **Glownet**, **Billfold** (hybrid RFID + open contactless). Closed-loop **works offline**; registration/top-up still needs network.

**Cost at 10k attendees (verify):** bands $18–24k + 12 fixed readers $9.6–14.4k + 8 handhelds $4.8–7.2k + on-site support ~$6k = **$38–52k CapEx**; full scale **$100k+**.

**Verdict:** **QR-on-phone is sufficient for SandFest access today** (you shipped the scanner + ACL-style tickets). Reserve RFID for a future entry-only credential on multi-day/VIP if you gate the footprint. A soft beach perimeter undercuts RFID's anti-fraud/re-entry value.

## 3. Cashless payments
| Model | Fees | Connectivity | Refund liability | Best fit |
|---|---|---|---|---|
| **Closed-loop RFID wallet** (top-up) | Platform + hardware; org holds float | Offline (band holds balance) | **High** — must refund unspent | Large gated festivals |
| **Open-loop contactless** (tap own card/phone) | ~1.5–2.9%/txn on vendor | Network per txn (brief offline modes) | **None** — no float/refunds | **Mid-size, multi-vendor, budget-lean** |
| **Physical tokens** | Cents/token | None | Manual/awkward | Beer/tasting metering |

**Closed-loop downside (why it backfires for a lean, community festival):** attendees commonly charged **$3–5 to reclaim their own unspent balance**; ~**11% of loaded credit goes unclaimed**; Belgium's consumer watchdog branded festival cashless a "rip-off"; organizer becomes merchant of record and must settle vendors (treasury/liability burden). Open-loop = each vendor gets their own money next day.

**Recommendation:** **Open-loop contactless, org-encouraged, not closed-loop.** Make tap-to-pay the default at vendors (BYO Square/SumUp at zero cost to you, or org-provided loaner terminals for unified sales data). **Keep cash accepted** (beach, family, unbanked audience) — "cashless-friendly, not cashless-only" avoids backlash. You still get real-time dashboards + faster lines + most of the spend uplift without float/refunds/hardware.

## 4. Ticketing & revenue tracking (Stripe + Eventeny + QuickBooks)
Revenue lands in ≥3 silos (Eventeny, Stripe, vendor Square), each netting fees on different payout schedules. Build a single **`revenue_event` ledger** in the Node admin API — one row per money movement:
```
source(eventeny|stripe|square|manual) · category(ticket|vendor_fee|sponsorship|merch|raffle|cashless_topup)
gross_amount · processor_fee · net_amount · payout_id/date · qb_class · qb_account · external_ref
```
**Ingestion:** Stripe webhooks (`charge.succeeded`, `payout.paid`) real-time; Eventeny via reporting/API export (confirm API — else scheduled CSV); Square via API if standardized. **QuickBooks pattern:** book gross sales → processor fees to a "Merchant Fees" expense → route through a **Stripe/Square clearing account** so bank deposits reconcile; use **QuickBooks Classes** per revenue stream so the P&L splits automatically. **Dashboard KPIs:** gross vs net by category, fee %, tickets sold vs capacity, spend-per-attendee, top vendors, sponsorship fulfillment, payouts-reconciled-to-bank tile.

## 5. Staged recommendation
| Phase | Adopt |
|---|---|
| **NOW (2026)** | QR e-tickets (extend existing iOS scanner + Eventeny QR check-in); **open-loop tap-to-pay** at all vendors; **unified revenue dashboard** (Eventeny + Stripe webhooks → Node API → QuickBooks w/ Classes + clearing accounts); redundant on-site network w/ Starlink. |
| **NEXT (2027, if gated)** | RFID **entry-only** wristbands for multi-day + VIP (pilot on that subset); standardize org-provided POS to deepen spend data. |
| **LATER (only if data-driven)** | Closed-loop cashless *only* if you fully gate, prove network reliability, and commit to a consumer-friendly refund policy (auto-refund, no/low fee, donate-leftover). |

**Primary rec (~balanced):** QR entry + org-provided Square Tap-to-Pay for vendors → unified feed; redundant network (Starlink + bonded 4G/5G, ~$8–25k/weekend verify); dashboard = internal build. **No RFID, no closed-loop cashless.** **Budget alt:** QR entry only; vendors keep own Square/SumUp + cash; reconcile via exports first year.

**Bottom line: SandFest doesn't need RFID or closed-loop cashless to be "the ultimate festival platform." It needs frictionless QR entry, open-loop tap-to-pay, a bulletproof network, and one revenue dashboard that reconciles everything to QuickBooks. Build that first; earn the right to RFID later.**

### Sources
[proudtek RFID](https://proudtek.com/solutions/rfid-event-wristbands/), [ACL FAQ](https://support.aclfestival.com/hc/en-us/articles/40673984992020-Wristband-Activation), [RFID Journal Bonnaroo](https://www.rfidjournal.com/news/rfid-performs-a-bigger-role-at-bonnaroo-festival/75229/), [Billboard Lolla](https://www.billboard.com/music/music-news/lollapalooza-goes-cashless-with-digital-wristbands-6141205/), [Forbes Tomorrowland](https://www.forbes.com/sites/madhvimavadiya/2018/06/24/festival-fintech-tomorrowland-cashless-payments/), [SXSW RFID/QR](https://sxsw.com/rfid-qr-code-lead-retrieval-policies/), [intellitix.com](https://www.intellitix.com/), [glownet.com](https://glownet.com/), [billfold.tech](https://www.billfold.tech/blog/the-best-festival-pos-systems-in-2026), [Ticket Fairy showdown](https://www.ticketfairy.com/blog/cashless-payment-systems-showdown-rfid-vs-app-based-vs-token-solutions-for-festivals), [rfidhy cost/ROI](https://www.rfidhy.com/rfid-cashless-payment-wristbands-us-festivals-setup-cost-roi/), [Square festivals](https://squareup.com/us/en/the-bottom-line/operating-your-business/how-to-take-card-payments-at-festivals), [Music Festival Wizard (downsides)](https://www.musicfestivalwizard.com/why-cashless-festivals-are-the-worst/), [Eventeny](https://www.eventeny.com/why-eventeny/), [Acodei Stripe↔QBO](https://www.acodei.com/blog/stripe-to-quickbooks-integration)
