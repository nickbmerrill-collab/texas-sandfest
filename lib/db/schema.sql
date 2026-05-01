-- Texas SandFest admin API schema.
-- Runs idempotently on every server boot via lib/db/pool.mjs#ensureSchema.
-- Mirrors the local JSON layout under data/processed and data/config.

CREATE TABLE IF NOT EXISTS config_documents (
  key        TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                          TEXT PRIMARY KEY,
  event_id                    TEXT NOT NULL,
  status                      TEXT NOT NULL,
  stripe_checkout_session_id  TEXT,
  data                        JSONB NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_session_idx     ON orders (stripe_checkout_session_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id                   TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  type                 TEXT NOT NULL,
  verified             BOOLEAN NOT NULL,
  checkout_session_id  TEXT,
  payment_intent_id    TEXT,
  fulfillment_status   TEXT,
  data                 JSONB NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_received_idx ON payment_events (received_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_session_idx  ON payment_events (checkout_session_id);

CREATE TABLE IF NOT EXISTS fulfillment_records (
  id                   TEXT PRIMARY KEY,
  order_id             TEXT,
  checkout_session_id  TEXT,
  payment_intent_id    TEXT,
  product_id           TEXT,
  status               TEXT NOT NULL,
  data                 JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fulfillment_session_idx ON fulfillment_records (checkout_session_id);
CREATE INDEX IF NOT EXISTS fulfillment_created_idx ON fulfillment_records (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON admin_audit_events (created_at DESC);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snapshots_target_idx ON config_snapshots (target_type, created_at DESC);
