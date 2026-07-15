# Marketing & Advertising Stack + On-Site Communications

_Research stream 8 of 8. Compiled 2026-07-15. Pricing marked "(as of 2026, verify)."_

A festival's marketing has one giant annual spike (announce → early-bird → last-chance → event week → recap), a local+regional audience, and a small team touching tools a few weeks a year. That argues **buy/integrate, not build** on nearly everything — and for tools cheap to leave idle 9 months a year.

# DOMAIN 1 — Marketing & advertising

## Email & SMS
| Platform | Entry (verify) | Model | Nonprofit | Festival fit |
|---|---|---|---|---|
| **Brevo** (ex-Sendinblue) | ~$9/mo (5k emails); Business ~$18 | **Per email sent — unlimited contacts** | 15% (verify) | **Best for a big list emailed infrequently** — you don't pay to *store* 80k contacts; native SMS in same tool |
| **Constant Contact** | ~$12/mo Lite; ~$80 @ 5k | Per contact | **20–30% off** for 501(c)(3) | Strongest event-native features (registration); higher per-contact cost |
| **Mailchimp** | ~$13/mo; ~$75 @ 5k | Per **total contact** (bills unsubscribed) | 15% (lowest) | Familiar/huge ecosystem; cost balloons as list grows |
| **Klaviyo** | ~$20/mo; ~$150 @ 10k | Per active profile | none headline | Overkill unless merch e-commerce segmentation |

**Read:** send-based pricing (Brevo) is structurally cheaper than contact-based (Mailchimp/Klaviyo) for the festival pattern. Promo SMS: **Brevo SMS** (one consent store w/ email) or EZ Texting (replies free); SimpleTexting has a $1,500/integration gotcha. Promo SMS needs A2P 10DLC + separate opt-in from email.

## Social & design
**Metricool** (~$25/mo, one brand/all networks + analytics + ad reporting) is the value sweet spot; **Canva free for nonprofits** (up to 50 users). Buffer free = zero-budget fallback. Skip Hootsuite ($99/user).

## Paid ads (geo is the core lever)
Beach festival = regional day-trippers + destination visitors → **geofence**. **Google Search** by radius/ZIP around venue + feeder cities (Corpus Christi, San Antonio, Austin, Houston) for high-intent ("things to do Port Aransas"). **Meta** for awareness + **retargeting** your own ticket-page traffic + lookalike-of-past-buyers. Keep it simple: 2–3 Google campaigns + 1 Meta retargeting + 1 lookalike. Retarget owned traffic before cold prospecting.

## Analytics
**Fathom** (~$15/mo, cookieless, UTM funnels) + **GA4** only if running Google Ads (import conversions). **UTM discipline is the highest-ROI zero-cost move** — one lowercase convention; mark ticket-purchase completion as a GA4 key event; link GA4↔Google Ads.

## The integration that matters: Eventeny → lists, with consent
Eventeny has **no confirmed native email sync** (exports CSV/Excel, Attendee Tracker, Buyer Summary). Best path: **build a small sync in the Node admin API** — pull buyers (or capture at the Stripe checkout you already own) → push to the email/SMS API **with a consent flag captured at checkout**. **Ticket purchase ≠ marketing consent** — add separate, unchecked opt-ins for email news and (distinct) SMS, store consent timestamp+source.

## Domain 1 recommendation
Subscribe everything except the consent-sync glue (build that in the Node API). Stack: **Brevo** (email+SMS) + **Metricool** + **Canva** (free) + **Google/Meta geofenced ads** + **Fathom**(+GA4 if ads). ≈**$50–90/mo** + ad spend — trivial for a 100k-visitor event. Highest-leverage move: **own consent capture at checkout, sync only opted-in buyers.**

# DOMAIN 2 — On-site communications

Three distinct problems often conflated: (1) staff coordination (today: radio), (2) incident/dispatch & command, (3) public mass alerts. The platform's existing incident concept + alert API + iOS push already stakes out #2 and #3.

## PoC vs radio — the beach reality
A **100k-person crowd saturates cell towers**, and push-to-talk-over-cellular (Zello/Voxer/WAVE PTX) **dies when the network dies** — the worst case is exactly a mass-congestion or storm event. **Do NOT rip out radio.** Keep VHF/UHF as the off-grid, rugged, safety-critical backbone; **add PoC as an augment** for smartphone-carrying staff (vendors, marketing, volunteers) + radio-to-app interop.

**PoC pricing (verify):** **Zello Work Core $8/user/mo** (−25% nonprofit annual; API + location tracking even on Core); Plus $15 adds **panic buttons** (useful for lone volunteers). Voxer (async voice threads). Motorola WAVE PTX ($25–50/user) only if bridging an existing Motorola radio fleet. **Pick: Zello Work Core.**

## Incident/dispatch
**24/7 Software** is the event/venue-native product (command center, dispatch queue, role-based assignment, audit-grade incident logging) — custom quote. Everbridge/Rave/Regroup lean mass-notification. **Verdict:** keep routine dispatch in your own platform now; **buy 24/7 Software if liability/volume grows** — don't build a full CAD system (deep, safety-critical).

## Public mass alerts — extend the alert API
Push alone only reaches app-installers with notifications on. Best practice is **multi-channel: app push + SMS**. Add **Twilio SMS** as a second channel off the Node alert API. Production-grade needs: opt-in capture at checkout + on-site keyword opt-in; **A2P 10DLC brand + separate emergency & marketing campaigns**; **a short code** for 100k-scale throughput (a long code is far too slow for an emergency blast — provision weeks ahead); STOP/HELP handling.

**Twilio costs (verify):** ~$0.0079/segment + A2P surcharge ~$0.003–0.005 (≈$0.011 registered); brand reg $4–44 one-time; campaign vetting $15; monthly $1.50–10. **Napkin math: one 160-char blast to 100k opted-in ≈ ~$1,100/blast** (short-code fees extra). Setup is <$100; cost is per-send — reserve mass SMS for genuine safety/logistics.

## Domain 2 recommendation
Layered: **Keep radio backbone + buy Zello PoC + your app push + Twilio SMS (short code) wired into the alert API.** Budget: radio + Zello free tier + push + Twilio long code (slower blasts, defer short code). Buy 24/7 Software later if liability grows.

## Cross-cutting
1. **One consent system, two uses** — same checkout opt-in feeds marketing *and* safety-SMS, but as **separate independently-checked opt-ins + separate A2P campaigns**, so a marketing STOP never suppresses a safety alert.
2. **Twilio = shared SMS backbone** for safety; keep the safety pipeline separate and simple.
3. **The Node admin API is the hub** — it owns Stripe/Eventeny data + the alert API, so it's the single place that writes opted-in buyers to lists and fans safety alerts to push + Twilio. That glue is the only meaningful *build* in either domain.

### Sources
Email/SMS: [etropo pricing](https://www.etropo.com/marketing-tool-prices/email-marketing), [Groupmail MC vs Brevo](https://blog.groupmail.io/mailchimp-vs-brevo-nonprofits/), [Omnisend Klaviyo](https://www.omnisend.com/blog/klaviyo-pricing/), [Twilio A2P consent](https://www.twilio.com/en-us/blog/insights/compliance/opt-in-opt-out-text-messages) · Social: [Metricool vs Buffer](https://metricool.com/metricool-vs-buffer/), [Canva nonprofits](https://www.canva.com/nonprofits/) · Ads: [Bigeye Meta geo 2026](https://www.bigeyeagency.com/insights/geographic-targeting-for-meta-ads-guide-2026/), [Improvado geotargeting](https://improvado.io/blog/geotargeting-advertising) · Analytics: [thebomb GA4 alternatives](https://thebomb.ca/blog/website-analytics-ga4-alternatives-2026/) · Eventeny: [ticket list help](https://help.eventeny.com/en/articles/14743877-view-and-manage-your-ticket-list) · Comms: [CavCom radios vs PoC](https://cavcominc.com/articles/144/two-way-radios-vs-push-to-talk-over-cellular-poc-whats-the-difference), [Zello pricing](https://zello.com/pricing/), [24/7 Software](https://www.247software.com/platform/incident-management-system), [Twilio A2P pricing](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-), [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), [Ticket Fairy emergency mass notification](https://www.ticketfairy.com/blog/emergency-mass-notification-tech-keeping-attendees-informed-safe-when-seconds-count-2026-guide)
