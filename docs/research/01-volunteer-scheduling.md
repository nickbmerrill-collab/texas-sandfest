# Volunteer Management, Hour Logging & Shift Scheduling

_Research stream 1 of 8. Compiled 2026-07-15 (inline, after async agents stalled). Pricing marked "(as of 2026, verify)."_

Context: SandFest (100k+ visitors, 3 days) likely runs **hundreds to low-thousands of volunteers** across gates, kids' corner, vendor row, and ops. Needs: recruitment/self-signup, shift scheduling, on-site check-in/out, **hour logging** (for grants/impact reports + earned-ticket incentives), and a feed of coverage into the ops dashboard.

## Domain 1: Volunteer management + hour logging

| Platform | Festival fit | Hour logging / check-in | Pricing (verify) | Notes |
|---|---|---|---|---|
| **VolunteerLocal** | **Strongest event/festival fit** — built for festivals/races w/ hundreds–thousands of volunteers | Visual calendar scheduling, **mobile + kiosk QR check-in**, shift swap, attendance tracking | Per-event: **Discover ~$200 / Grow ~$800 / Enterprise ~$3,000**; ongoing $600–2,400/yr | **Earned-ticket workflow built in** (free tickets for hours; can collect a CC deposit refunded on shift completion) — directly matches festival volunteer incentives ([volunteerlocal.com/festivals](https://www.volunteerlocal.com/who-we-serve/events/festivals/), [Capterra pricing](https://www.capterra.com/p/122906/VolunteerLocal/pricing/)) |
| **Track It Forward** | Good (budget hour-tracking) | **Check-in kiosk app + free mobile app + web**; volunteers self-log, coordinators approve/export | **Free <25 volunteers**; Basic $12/mo, Standard $24/mo, Advanced $36/mo (annual −20%) | Best cheap **hour-logging + grant/board reporting**, incl. year-round recurring hours ([trackitforward.com/pricing](https://www.trackitforward.com/pricing), [kiosk](https://www.trackitforward.com/feature/check-kiosk)) |
| **Rosterfy** | Strong (enterprise, arts/festivals vertical) | Onsite/remote check-in/out, time + shift-attendance tracking, custom dashboards | **Custom quote** (enterprise, scales with admins/support) | Recognition engine (e-badges, ticket discounts, vouchers); "Pip" AI shift builder arriving 2026 ([rosterfy.com/arts-festivals-culture](https://www.rosterfy.com/arts-festivals-culture), [pricing](https://www.rosterfy.com/pricing/)) |
| **CERVIS** | Good (event logistics) | Self-scheduling; sign in/out from smartphone **or on-site kiosk**, instant hour capture | Quote/tiered | Event-focused impact-data capture ([cervistech.info festivals](https://www.cervistech.info/festivals-events-volunteer-management-software)) |
| **VolunteerHub** | Good (large community events) | Robust reporting + hour tracking, mobile-responsive check-in | Quote | Strong reporting/metrics ([volunteerhub.com](https://volunteerhub.com/blog/10-volunteer-management-solutions-for-nonprofits)) |

Also-rans worth a look: Better Impact, Get Connected/Galaxy Digital, Golden, SignUpGenius (light), InitLive/Bloomerang Volunteer.

## Domain 2: Staff / volunteer shift scheduling

| Platform | Fit | Features | Pricing (verify) |
|---|---|---|---|
| **Nowsta** | **Event-staffing native** (catering, stadiums, events) | Scheduling + open-shift publishing + **mobile clock-in w/ geofencing** + attendance + payroll export; AI scheduling (−80% time) | **From ~$3/user/mo** (quote) ([nowsta.com](https://www.nowsta.com/), [Capterra](https://www.capterra.com/p/172778/Nowsta/pricing/)) |
| **Connecteam** | **Best budget all-in-one** for a small core team | Scheduling + time clock + geofence + team comms + checklists | **Free ≤10 users**; Basic $35/mo, Advanced $59/mo, Expert $119/mo (flat for first 30 users) ([connecteam.com/pricing](https://connecteam.com/pricing/)) |
| **When I Work / Deputy / Sling / Homebase** | Standard shift scheduling | Scheduling, swaps, mobile clock-in, messaging | ~$2.50–5/user/mo tiers |

## Recommendation

**Primary: Buy VolunteerLocal for the volunteer lifecycle + Connecteam (free/cheap) for paid core-staff scheduling — and mirror both into the platform rather than rebuild.**

- **VolunteerLocal** handles recruitment → scheduling → QR kiosk check-in → hours → earned-ticket incentives at a known per-event cost (~$800 Grow tier is the likely fit). Rebuilding this seasonal, once-a-year engine natively is poor ROI for a lean team.
- **Connecteam's free tier** covers the small year-round core staff/committee (scheduling + comms + time clock) at $0 up to 10 users.
- **Build native = the *mirror + ops* layer, not the signup engine.** Follow your architecture doc's "mirror Eventeny, enrich locally" pattern: ingest VolunteerLocal rosters/shifts/hours into the canonical `volunteer` / `volunteerShift` / `volunteerHourLog` / `coverage` records (already in `data/schemas/platform-objects.json`) so the **ops console shows live coverage-vs-needed by zone** and hours roll into grant/impact reports and the revenue/impact dashboard. VolunteerLocal export/CSV (confirm API) → nightly sync.

**Budget alternative: Track It Forward only.** If year-one volunteer numbers are modest or budget is tight, Track It Forward ($12–36/mo) covers self-service hour logging + kiosk check-in + grant reporting cheaply; do scheduling in a shared sheet or Connecteam free. You lose the polished festival recruitment/earned-ticket flow but keep auditable hours for almost nothing.

**Do NOT build the volunteer signup/scheduling engine from scratch** — buy it, mirror the data, and spend native effort on the ops-coverage view and impact reporting that are unique to you.

### Sources
[VolunteerLocal festivals](https://www.volunteerlocal.com/who-we-serve/events/festivals/) · [VolunteerLocal pricing (Capterra)](https://www.capterra.com/p/122906/VolunteerLocal/pricing/) · [Track It Forward pricing](https://www.trackitforward.com/pricing) · [Track It Forward kiosk](https://www.trackitforward.com/feature/check-kiosk) · [Rosterfy arts/festivals](https://www.rosterfy.com/arts-festivals-culture) · [Rosterfy pricing](https://www.rosterfy.com/pricing/) · [CERVIS festivals](https://www.cervistech.info/festivals-events-volunteer-management-software) · [Nowsta](https://www.nowsta.com/) · [Nowsta pricing](https://www.capterra.com/p/172778/Nowsta/pricing/) · [Connecteam pricing](https://connecteam.com/pricing/) · [RallyUp 2026 roundup](https://rallyup.com/blog/volunteer-management-software/)
