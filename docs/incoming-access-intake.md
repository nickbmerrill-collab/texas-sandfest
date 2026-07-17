# Incoming Documents & Logins — Intake Runbook

We are about to receive **documents** (event plans, permits, sponsor decks,
finance exports, vendor lists, maps) and **logins/keys** (Eventeny, QuickBooks,
Stripe, domain/DNS, email, social, etc.). This runbook says exactly where each
thing goes so nothing leaks and nothing gets lost.

## TL;DR

| You received… | Put it here | Tracked in git? |
| --- | --- | --- |
| A document / export | `data/incoming/<domain>/` | Yes (unless sensitive PII/finance) |
| A password / login | Password manager (1Password/Bitwarden) | **No** |
| A machine API key/token | `.env` (copy from `.env.example`) | **No** (`.env` is git-ignored) |
| A key that arrives mid-chat | `data/incoming/credentials/` then move it | **No** (folder is ignored) |
| The *fact that* a credential exists | `data/config/access-registry.json` | Yes (no secret values) |

## Document intake

Drop incoming files into the matching domain folder, then run the scanner:

```
data/incoming/eventeny/     # ticketing, vendor & sponsor application exports
data/incoming/docs/         # event plans, permits, maps, sponsor decks, contracts
data/incoming/ops/          # run-of-show, staffing, site plans, safety
data/incoming/finance/      # budgets, invoices, Stripe/QBO exports  (watch for PII)
data/incoming/comms/        # marketing, radio plans, press, email lists
data/incoming/quickbooks/   # QBO exports/tokens (JSON/token files are git-ignored)
```

Then:

```bash
npm run incoming:scan     # inventories new files -> data/processed/incoming-inventory.*
npm run extract:documents # OCR/extract text from PDFs & docs
npm run vault:build       # refresh the Obsidian vault with new sources
```

**Sensitive documents** (anything with attendee PII, bank/routing numbers, SSNs,
signed contracts with private terms): keep them under `data/incoming/finance/` or
`data/incoming/credentials/` and confirm they are git-ignored before committing.
When in doubt, do not commit — ask.

## Credential / login intake

**Never paste a password, API key, or token into a file that git tracks, into a
commit message, or into source code.**

1. **Human logins** (someone hands you a username/password): store in the shared
   password manager vault. Record only its existence in
   `data/config/access-registry.json`.
2. **Machine credentials** (API keys, OAuth secrets, DB URLs the apps read):
   ```bash
   cp .env.example .env      # if you don't have one yet
   # edit .env and paste the value next to the matching KEY
   ```
   `.env` is git-ignored. The variable names already scaffolded live in
   `.env.example` (Stripe, QuickBooks, auth, rate limits). New integrations
   (Twilio, Mapbox, etc.) get a new KEY there first.
3. **If a credential arrives in the middle of a working session** and you can't
   file it immediately, drop it in `data/incoming/credentials/` (git-ignored),
   then move it to its permanent home and delete the copy.
4. **Update the registry** (`data/config/access-registry.json`): flip the
   system's `status` from `needed` → `received` → `active`, and set
   `secretLocation` to where the real value now lives. No secret values in the
   registry.

## What we're expecting (checklist)

Tracked in `data/config/access-registry.json`. Current `needed` items:

- **Eventeny** admin + API access (ticketing, vendor/sponsor applications)
- **Stripe** keys (owned checkout)
- **QuickBooks Online** OAuth app + realm (finance)
- **Domain / DNS** for texassandfest.org (email auth, subdomains, site cutover)
- **Website host / CMS** admin (current site — appears Wix-hosted)
- **Email marketing** provider login + list export
- **SMS** (Twilio proposed) for confirmations/reminders/alerts
- **Social** accounts + Meta business assets
- **Web analytics** (GA4/Plausible)
- **Map platform** token (sculptor/POI map)
- **Google Workspace** (shared email + drive for documents)

## Rotation & offboarding

- Rotate any credential that was ever sent over an insecure channel (SMS, plain
  email) once it's in the password manager.
- When a vendor relationship ends, mark the registry entry `n/a` and revoke the
  credential.
