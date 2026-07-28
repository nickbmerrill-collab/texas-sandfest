import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ensureSchema, getPool } from "./db/pool.mjs";
import { planEventRollover, ROLLOVER_DOCUMENT_KEYS } from "./event-rollover.mjs";
import { platformDocumentStorageKey } from "./platform-data.mjs";
import { assertRuntimeOwnership } from "./runtime-root.mjs";

const ROLLOVER_LOCK_KEY = "texas-sandfest:event-rollover";

function requireMaintenanceMode() {
  if (process.env.SANDFEST_ROLLOVER_MAINTENANCE !== "true") {
    throw new Error("Postgres rollover requires SANDFEST_ROLLOVER_MAINTENANCE=true and stopped API/worker services.");
  }
  if (!process.env.SANDFEST_DATABASE_URL) {
    throw new Error("Postgres rollover requires SANDFEST_DATABASE_URL.");
  }
}

async function readRolloverDocuments(client, fromEventId) {
  const storageKeys = ROLLOVER_DOCUMENT_KEYS.map(platformDocumentStorageKey);
  const { rows } = await client.query(
    "SELECT key, data FROM platform_documents WHERE key = ANY($1::text[])",
    [storageKeys]
  );
  const rowsByKey = new Map(rows.map(row => [row.key, row.data]));
  const documents = Object.fromEntries(
    ROLLOVER_DOCUMENT_KEYS.map(key => [key, rowsByKey.get(platformDocumentStorageKey(key)) ?? null])
  );
  const missing = ROLLOVER_DOCUMENT_KEYS.filter(key => (
    key !== "passportCompletions" && documents[key] == null
  ));
  if (missing.length) throw new Error(`Rollover source is missing: ${missing.join(", ")}.`);
  // Postgres stores completion truth in hunt_completions, so older databases
  // may not have the file-compatibility metadata document.
  documents.passportCompletions ??= { completions: [] };

  const huntId = documents.passportHunt?.hunt?.id;
  const passportRows = huntId
    ? await client.query(
        "SELECT data FROM hunt_completions WHERE hunt_id = $1 ORDER BY completed_at DESC",
        [huntId]
      )
    : { rows: [] };
  const voteRows = await client.query(
    "SELECT data FROM peoples_choice_votes WHERE event_id = $1 ORDER BY voted_at DESC",
    [fromEventId]
  );

  return {
    ...documents,
    passportCompletions: {
      ...documents.passportCompletions,
      completions: passportRows.rows.map(row => row.data)
    },
    voting: {
      ...documents.voting,
      votes: voteRows.rows.map(row => row.data)
    }
  };
}

export async function applyPostgresEventRollover({
  root,
  fromEventId,
  toEventId,
  actorId = "event-rollover-cli",
  now = new Date().toISOString()
} = {}) {
  requireMaintenanceMode();
  await assertRuntimeOwnership(root);
  await ensureSchema();

  const pool = await getPool();
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ROLLOVER_LOCK_KEY]);
    await client.query(`
      LOCK TABLE
        config_documents,
        config_snapshots,
        platform_documents,
        hunt_completions,
        peoples_choice_votes
      IN SHARE ROW EXCLUSIVE MODE
    `);

    const bootstrapResult = await client.query(
      "SELECT data FROM config_documents WHERE key = $1",
      ["app-bootstrap"]
    );
    if (bootstrapResult.rows.length !== 1) {
      throw new Error("Config document not found: app-bootstrap");
    }

    const archiveDocuments = await readRolloverDocuments(client, fromEventId);
    const plan = planEventRollover({
      fromEventId,
      toEventId,
      guide: bootstrapResult.rows[0].data?.guide,
      documents: archiveDocuments,
      now
    });
    if (!plan.ok) throw new Error(plan.error);

    const archive = {
      id: `rollover_${randomUUID()}`,
      eventId: plan.fromEventId,
      target: { type: "eventRollover", id: `${plan.fromEventId}-to-${plan.toEventId}` },
      reason: `Archive before event rollover from ${plan.fromEventId} to ${plan.toEventId}`,
      actor: { id: actorId, type: "maintenance-cli" },
      data: { archiveDigest: plan.archiveDigest, documents: archiveDocuments },
      createdAt: plan.now
    };
    await client.query(
      `INSERT INTO config_snapshots (id, target_type, target_id, data, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        archive.id,
        archive.target.type,
        archive.target.id,
        JSON.stringify(archive),
        archive.createdAt
      ]
    );

    for (const key of ROLLOVER_DOCUMENT_KEYS) {
      await client.query(
        `INSERT INTO platform_documents (key, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [platformDocumentStorageKey(key), JSON.stringify(plan.documents[key])]
      );
    }

    const persistedRows = await client.query(
      "SELECT key, data FROM platform_documents WHERE key = ANY($1::text[])",
      [ROLLOVER_DOCUMENT_KEYS.map(platformDocumentStorageKey)]
    );
    const persistedByKey = new Map(persistedRows.rows.map(row => [row.key, row.data]));
    const mismatches = ROLLOVER_DOCUMENT_KEYS.filter(key => (
      !isDeepStrictEqual(persistedByKey.get(platformDocumentStorageKey(key)), plan.documents[key])
    ));
    if (mismatches.length) {
      throw new Error(`Read-back verification failed for: ${mismatches.join(", ")}.`);
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return {
      ok: true,
      mode: "applied",
      storage: "postgres",
      atomic: true,
      isolation: "serializable",
      fromEventId: plan.fromEventId,
      toEventId: plan.toEventId,
      archiveId: archive.id,
      archiveDigest: plan.archiveDigest,
      verifiedDocuments: ROLLOVER_DOCUMENT_KEYS.length,
      summary: plan.summary
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original rollover failure.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
