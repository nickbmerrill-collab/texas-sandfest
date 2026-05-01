# App Data Contract

The iOS app now reads from a single `SandFestPayload` instead of screen-local sample arrays.

## Current Source

- Processed bootstrap source: `data/processed/app-bootstrap.json`
- Bundled seed generated from source: `ios/TexasSandFest/Resources/sandfest-seed.json`
- Swift loader: `ios/TexasSandFest/AppDataStore.swift`
- Swift model: `ios/TexasSandFest/Models.swift`

This keeps the app shippable offline while we wait for live access to Eventeny, QuickBooks, vendor files, sponsor records, volunteer rosters, maps, and operating documents.

The web app now mirrors this same principle through `public/sw.js`: the shell, static bootstrap files, ticket catalog snapshot, media manifest, and key processed JSON files can be reopened from browser cache if beach cell service drops.

The shared bootstrap payload also includes `alert`, an inactive-by-default emergency alert record. Web reads the live value from `/api/public/alert`; the native iOS scaffold uses the bundled alert as a fallback and can refresh the public endpoint when connectivity is available.

## Payload Areas

- `guide`: event identity, dates, location, update timestamp
- `alert`: public emergency alert state, severity, message, audience, update timestamp, and optional expiration
- `schedule`: customer schedule and staff operational milestones
- `zones`: beach map areas and crowd/ops status
- `ticketOptions`: Eventeny ticket handoff cards
- `ticketProducts`: Stripe-ready product catalog for GA, VIP, sponsor, and review-gated raffle paths
- `sponsors`: sponsor tier, invoice, fulfillment, and next action state
- `vendors`: vendor status, category, and booth assignment
- `coverage`: volunteer coverage by zone
- `financeSignals`: QuickBooks and finance readiness indicators

## Ingestion Rule

Every future import should normalize into this payload or an explicit extension of it before the app consumes the data. That gives us one reviewable boundary between chaotic source files and the customer/admin product.

Run this after changing the processed bootstrap payload:

```bash
npm run ios:seed
```

Public web ticket products are synced separately:

```bash
npm run public:sync
```

## Next Backend Step

Replace the bundled seed with a signed API response at the same shape:

```text
GET /api/app/bootstrap
Authorization: Bearer <staff-or-public-token>
```

The customer app can receive public-safe subsets. The admin app should receive staff-only fields based on role.
