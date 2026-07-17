import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// File-backed storage: preserves the original on-disk layout under
// data/config/ and data/processed/ so the dev workflow keeps working
// without a database. This module owns every read/write that used to
// be inlined in scripts/admin-api-server.mjs.

const CONFIG_KEY_PATHS = {
  "admin-config":     ["data", "config", "admin-config.json"],
  "emergency-alert":  ["data", "config", "emergency-alert.json"],
  "ticket-products":  ["data", "processed", "ticket-products.json"],
  "app-bootstrap":    ["data", "processed", "app-bootstrap.json"]
};

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function listJsonRecords(directory, root, limit) {
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory))
    .filter(file => file.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
  const records = [];
  for (const file of files) {
    const filePath = path.join(directory, file);
    try {
      records.push({
        file,
        path: path.relative(root, filePath),
        record: await readJson(filePath)
      });
    } catch {
      records.push({
        file,
        path: path.relative(root, filePath),
        record: { error: "Unable to parse record." }
      });
    }
  }
  return records;
}

async function findRecordByField(directory, field, value, root) {
  if (!value) return null;
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter(file => file.endsWith(".json"));
  for (const file of files) {
    const filePath = path.join(directory, file);
    try {
      const record = await readJson(filePath);
      if (record?.[field] === value) {
        return {
          file,
          path: path.relative(root, filePath),
          record
        };
      }
    } catch {
      // skip malformed local records
    }
  }
  return null;
}

function safeFilePart(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-");
}

function timestampedFileName(prefix, id) {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${prefix}-${id}.json`;
}

function stableFileName(prefix, id) {
  return `${prefix}-${safeFilePart(id)}.json`;
}

function envelope(file, filePath, record, root) {
  return { file, path: path.relative(root, filePath), record };
}

export function createFileStorage({ root, configPaths, auditDir, orderDir, paymentEventDir, fulfillmentDir }) {
  const overrides = configPaths || {};
  const resolveConfigPath = key => {
    if (overrides[key]) return overrides[key];
    const segments = CONFIG_KEY_PATHS[key];
    if (!segments) throw new Error(`Unknown config document key: ${key}`);
    return path.join(root, ...segments);
  };

  const ORDER_DIR       = orderDir ? path.resolve(orderDir) : path.join(root, "data", "processed", "orders", "pending");
  const PAYMENT_DIR     = paymentEventDir ? path.resolve(paymentEventDir) : path.join(root, "data", "processed", "orders", "payment-events");
  const FULFILLMENT_DIR = fulfillmentDir ? path.resolve(fulfillmentDir) : path.join(root, "data", "processed", "orders", "fulfillment");
  const AUDIT_DIR       = auditDir ? path.resolve(auditDir) : path.join(root, "data", "processed", "admin-audit");
  const SNAPSHOT_DIR    = path.join(root, "data", "processed", "config-snapshots");

  return {
    kind: "file",

    async init() {},
    async close() {},

    config: {
      async read(key) {
        return readJson(resolveConfigPath(key));
      },
      async write(key, data) {
        await writeJson(resolveConfigPath(key), data);
      }
    },

    orders: {
      async write(order, { prefix = "checkout" } = {}) {
        const existing = await findRecordByField(ORDER_DIR, "id", order.id, root);
        const filePath = existing
          ? path.resolve(root, existing.path)
          : path.join(ORDER_DIR, stableFileName(prefix, order.id));
        await writeJson(filePath, order);
        return envelope(path.basename(filePath), filePath, order, root);
      },
      async findById(id) {
        return findRecordByField(ORDER_DIR, "id", id, root);
      },
      async findByIdempotencyKeyHash(idempotencyKeyHash) {
        return findRecordByField(ORDER_DIR, "idempotencyKeyHash", idempotencyKeyHash, root);
      },
      async findByCheckoutSession(sessionId) {
        return findRecordByField(ORDER_DIR, "stripeCheckoutSessionId", sessionId, root);
      },
      async findByPaymentIntent(paymentIntentId) {
        return findRecordByField(ORDER_DIR, "paymentIntentId", paymentIntentId, root);
      },
      async list(limit) {
        return listJsonRecords(ORDER_DIR, root, limit);
      }
    },

    paymentEvents: {
      async findById(id) {
        return findRecordByField(PAYMENT_DIR, "id", id, root);
      },
      async write(record) {
        const filePath = path.join(PAYMENT_DIR, stableFileName("stripe-event", record.id));
        await writeJson(filePath, record);
        return envelope(path.basename(filePath), filePath, record, root);
      },
      async list(limit) {
        return listJsonRecords(PAYMENT_DIR, root, limit);
      }
    },

    fulfillment: {
      async write(record) {
        const filePath = path.join(FULFILLMENT_DIR, stableFileName("fulfillment", record.id));
        await writeJson(filePath, record);
        return envelope(path.basename(filePath), filePath, record, root);
      },
      async findByCheckoutSession(sessionId) {
        if (!sessionId) return [];
        await mkdir(FULFILLMENT_DIR, { recursive: true });
        const files = (await readdir(FULFILLMENT_DIR)).filter(file => file.endsWith(".json"));
        const matches = [];
        for (const file of files) {
          const filePath = path.join(FULFILLMENT_DIR, file);
          try {
            const record = await readJson(filePath);
            if (record?.checkoutSessionId === sessionId) {
              matches.push(envelope(file, filePath, record, root));
            }
          } catch {
            // ignore malformed records
          }
        }
        return matches;
      },
      async findById(id) {
        return findRecordByField(FULFILLMENT_DIR, "id", id, root);
      },
      async update(record) {
        const filePath = path.join(FULFILLMENT_DIR, stableFileName("fulfillment", record.id));
        await writeJson(filePath, record);
        return envelope(path.basename(filePath), filePath, record, root);
      },
      async list(limit) {
        return listJsonRecords(FULFILLMENT_DIR, root, limit);
      }
    },

    audit: {
      async write(record) {
        const action = String(record.action || "audit").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
        const filePath = path.join(AUDIT_DIR, timestampedFileName(action, record.id));
        await writeJson(filePath, record);
        return envelope(path.basename(filePath), filePath, record, root);
      },
      async list(limit) {
        return listJsonRecords(AUDIT_DIR, root, limit);
      }
    },

    snapshots: {
      async write(record) {
        const prefix = `${record.target?.type ?? "snapshot"}-snapshot`;
        const filePath = path.join(SNAPSHOT_DIR, timestampedFileName(prefix, record.id));
        await writeJson(filePath, record);
        return envelope(path.basename(filePath), filePath, record, root);
      },
      async list(limit) {
        return listJsonRecords(SNAPSHOT_DIR, root, limit);
      },
      async findByRef(ref) {
        if (!ref || ref.includes("/") || ref.includes("..")) return null;
        const filePath = path.join(SNAPSHOT_DIR, ref);
        try {
          const record = await readJson(filePath);
          return envelope(ref, filePath, record, root);
        } catch {
          return null;
        }
      }
    }
  };
}
