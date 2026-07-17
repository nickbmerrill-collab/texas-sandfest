# Credentials drop (LOCAL ONLY — never committed)

Everything in this folder **except this README** is git-ignored. This is a
staging area for logins/keys that arrive before they are moved into their
permanent home (`.env`, a password manager, or a secrets manager).

## Rules

1. **Never commit secrets.** The folder is ignored, but double-check `git status`
   before every commit.
2. **Prefer a password manager** (1Password / Bitwarden) as the system of record
   for human logins. Prefer `.env` (also ignored) for machine credentials the
   apps read (API keys, tokens, DB URLs). This folder is a temporary inbox only.
3. **Record the *existence* of each credential** in the non-secret registry at
   `data/config/access-registry.json` — system name, owner, and *where the secret
   lives* — but never the secret value itself.
4. When a credential is filed into `.env` or the password manager, **delete the
   copy here.**

See `docs/incoming-access-intake.md` for the full intake runbook.
