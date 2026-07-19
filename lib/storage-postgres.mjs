import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EVENT_ID } from "./event-context.mjs";
import { closePool, ensureSchema, getPool } from "./db/pool.mjs";

// Postgres-backed storage. Mirrors the file-storage interface but lands
// records in tables instead of JSON files. Activated by setting
// SANDFEST_DATABASE_URL — otherwise lib/storage.mjs falls back to file mode.

const CONFIG_SEED_PATHS = {
  "admin-config":     ["data", "config", "admin-config.json"],
  "emergency-alert":  ["data", "config", "emergency-alert.json"],
  "ticket-products":  ["data", "processed", "ticket-products.json"],
  "app-bootstrap":    ["data", "processed", "app-bootstrap.json"]
};

function envelope(id, table, record) {
  return {
    file: `${id}.json`,
    path: `db://${table}/${id}`,
    record
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function seedConfigDocsFromFiles(pool, root, overrides) {
  for (const [key, segments] of Object.entries(CONFIG_SEED_PATHS)) {
    const { rows } = await pool.query("SELECT 1 FROM config_documents WHERE key = $1", [key]);
    if (rows.length > 0) continue;
    const seedPath = overrides[key] || path.join(root, ...segments);
    const data = await readJsonIfExists(seedPath);
    if (data === null) continue;
    await pool.query(
      "INSERT INTO config_documents (key, data, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO NOTHING",
      [key, JSON.stringify(data)]
    );
  }
}

export function createPostgresStorage({ root, configPaths }) {
  const overrides = configPaths || {};

  return {
    kind: "postgres",

    async init() {
      await ensureSchema();
      const pool = await getPool();
      await seedConfigDocsFromFiles(pool, root, overrides);
    },

    async close() {
      await closePool();
    },

    config: {
      async read(key) {
        const pool = await getPool();
        const { rows } = await pool.query("SELECT data FROM config_documents WHERE key = $1", [key]);
        if (rows.length === 0) {
          throw new Error(`Config document not found: ${key}`);
        }
        return rows[0].data;
      },
      async write(key, data) {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO config_documents (key, data, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [key, JSON.stringify(data)]
        );
      },
      async update(key, mutator) {
        const pool = await getPool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`texas-sandfest:config-document:${key}`]);
          const { rows } = await client.query("SELECT data FROM config_documents WHERE key = $1 FOR UPDATE", [key]);
          if (rows.length === 0) throw new Error(`Config document not found: ${key}`);
          const next = await mutator(rows[0].data);
          if (next !== undefined) {
            await client.query(
              "UPDATE config_documents SET data = $2::jsonb, updated_at = now() WHERE key = $1",
              [key, JSON.stringify(next)]
            );
          }
          await client.query("COMMIT");
          return next;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    },

    orders: {
      async write(order) {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO orders (id, event_id, status, stripe_checkout_session_id, payment_intent_id, idempotency_key_hash, idempotency_fingerprint, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
             payment_intent_id = EXCLUDED.payment_intent_id,
             idempotency_key_hash = EXCLUDED.idempotency_key_hash,
             idempotency_fingerprint = EXCLUDED.idempotency_fingerprint,
             data = EXCLUDED.data,
             updated_at = EXCLUDED.updated_at`,
          [
            order.id,
            order.eventId ?? DEFAULT_EVENT_ID,
            order.status ?? "unknown",
            order.stripeCheckoutSessionId ?? null,
            order.paymentIntentId ?? null,
            order.idempotencyKeyHash ?? null,
            order.idempotencyFingerprint ?? null,
            JSON.stringify(order),
            order.createdAt ?? new Date().toISOString(),
            order.updatedAt ?? new Date().toISOString()
          ]
        );
        return envelope(order.id, "orders", order);
      },
      async findById(id) {
        if (!id) return null;
        const pool = await getPool();
        const { rows } = await pool.query("SELECT id, data FROM orders WHERE id = $1", [id]);
        return rows.length ? envelope(rows[0].id, "orders", rows[0].data) : null;
      },
      async findByIdempotencyKeyHash(idempotencyKeyHash) {
        if (!idempotencyKeyHash) return null;
        const pool = await getPool();
        const { rows } = await pool.query("SELECT id, data FROM orders WHERE idempotency_key_hash = $1", [idempotencyKeyHash]);
        return rows.length ? envelope(rows[0].id, "orders", rows[0].data) : null;
      },
      async findByCheckoutSession(sessionId) {
        if (!sessionId) return null;
        const pool = await getPool();
        const { rows } = await pool.query("SELECT id, data FROM orders WHERE stripe_checkout_session_id = $1", [sessionId]);
        return rows.length ? envelope(rows[0].id, "orders", rows[0].data) : null;
      },
      async findByPaymentIntent(paymentIntentId) {
        if (!paymentIntentId) return null;
        const pool = await getPool();
        const { rows } = await pool.query("SELECT id, data FROM orders WHERE payment_intent_id = $1", [paymentIntentId]);
        return rows.length ? envelope(rows[0].id, "orders", rows[0].data) : null;
      },
      async list(limit) {
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM orders ORDER BY created_at DESC LIMIT $1",
          [limit]
        );
        return rows.map(row => envelope(row.id, "orders", row.data));
      },
      async listByEvent(eventId, limit) {
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM orders WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2",
          [eventId, limit]
        );
        return rows.map(row => envelope(row.id, "orders", row.data));
      }
    },

    paymentEvents: {
      async findById(id) {
        if (!id) return null;
        const pool = await getPool();
        const { rows } = await pool.query("SELECT id, data FROM payment_events WHERE id = $1", [id]);
        if (rows.length === 0) return null;
        return envelope(rows[0].id, "payment_events", rows[0].data);
      },
      async write(record) {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO payment_events (id, provider, type, verified, checkout_session_id, payment_intent_id, fulfillment_status, data, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id,
            record.provider ?? "stripe",
            record.type ?? "unknown",
            Boolean(record.verified),
            record.checkoutSessionId ?? null,
            record.paymentIntentId ?? null,
            record.fulfillmentStatus ?? null,
            JSON.stringify(record),
            record.receivedAt ?? new Date().toISOString()
          ]
        );
        return envelope(record.id, "payment_events", record);
      },
      async list(limit) {
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM payment_events ORDER BY received_at DESC LIMIT $1",
          [limit]
        );
        return rows.map(row => envelope(row.id, "payment_events", row.data));
      }
    },

    fulfillment: {
      async write(record) {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO fulfillment_records (id, order_id, checkout_session_id, payment_intent_id, product_id, status, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             data = EXCLUDED.data,
             updated_at = EXCLUDED.updated_at`,
          [
            record.id,
            record.orderId ?? null,
            record.checkoutSessionId ?? null,
            record.paymentIntentId ?? null,
            record.productId ?? null,
            record.status ?? "queued",
            JSON.stringify(record),
            record.createdAt ?? new Date().toISOString(),
            record.updatedAt ?? new Date().toISOString()
          ]
        );
        return envelope(record.id, "fulfillment_records", record);
      },
      async findByCheckoutSession(sessionId) {
        if (!sessionId) return [];
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM fulfillment_records WHERE checkout_session_id = $1 ORDER BY created_at DESC",
          [sessionId]
        );
        return rows.map(row => envelope(row.id, "fulfillment_records", row.data));
      },
      async findById(id) {
        if (!id) return null;
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM fulfillment_records WHERE id = $1",
          [id]
        );
        if (rows.length === 0) return null;
        return envelope(rows[0].id, "fulfillment_records", rows[0].data);
      },
      async update(record) {
        return this.write(record);
      },
      async list(limit) {
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM fulfillment_records ORDER BY created_at DESC LIMIT $1",
          [limit]
        );
        return rows.map(row => envelope(row.id, "fulfillment_records", row.data));
      }
    },

    audit: {
      async write(record) {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO admin_audit_events (id, action, target_type, target_id, data, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id,
            record.action ?? "audit",
            record.target?.type ?? null,
            record.target?.id ?? null,
            JSON.stringify(record),
            record.createdAt ?? new Date().toISOString()
          ]
        );
        return envelope(record.id, "admin_audit_events", record);
      },
      async list(limit) {
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM admin_audit_events ORDER BY created_at DESC LIMIT $1",
          [limit]
        );
        return rows.map(row => envelope(row.id, "admin_audit_events", row.data));
      }
    },

    snapshots: {
      async write(record) {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO config_snapshots (id, target_type, target_id, data, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id,
            record.target?.type ?? "unknown",
            record.target?.id ?? null,
            JSON.stringify(record),
            record.createdAt ?? new Date().toISOString()
          ]
        );
        return envelope(record.id, "config_snapshots", record);
      },
      async list(limit) {
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM config_snapshots ORDER BY created_at DESC LIMIT $1",
          [limit]
        );
        return rows.map(row => envelope(row.id, "config_snapshots", row.data));
      },
      async findByRef(ref) {
        if (!ref) return null;
        // Accept either "<id>" or "<id>.json" so the URL convention from
        // file mode keeps working when the admin UI rehydrates older state.
        const id = ref.endsWith(".json") ? ref.slice(0, -5) : ref;
        const pool = await getPool();
        const { rows } = await pool.query(
          "SELECT id, data FROM config_snapshots WHERE id = $1",
          [id]
        );
        if (rows.length === 0) return null;
        return envelope(rows[0].id, "config_snapshots", rows[0].data);
      }
    }
  };
}
