// Enterprise data access for high-traffic festival modules.
//
// - File mode (default): atomic JSON + per-key mutex (lib/safe-json-store.mjs)
// - Postgres mode (SANDFEST_DATABASE_URL): ledger docs in platform_documents +
//   append tables for passport stamps and votes (multi-instance safe)
//
// API server should call these helpers instead of ad-hoc readFile/writeFile.

import path from "node:path";
import { DEFAULT_EVENT_ID } from "./event-context.mjs";
import { assertRuntimeOwnership, withRuntimeOwnership } from "./runtime-root.mjs";
import { readJsonFile, updateJsonFile, writeJsonFileAtomic } from "./safe-json-store.mjs";

const DOC_KEYS = {
  fleet: "fleet",
  revenue: "revenue-ledger",
  volunteers: "volunteer-mirror",
  staffDirectory: "staff-directory",
  consent: "consent-ledger",
  passportHunt: "sculpture-passport",
  passportCompletions: "passport-completions",
  voting: "peoples-choice",
  booths: "booth-map",
  partnerOps: "partner-operations",
  incomingDocuments: "incoming-documents",
  islandConditions: "island-conditions",
  smsOperations: "sms-operations",
  quickBooksCredentials: "quickbooks-credentials",
  workerStatus: "worker-status"
};

export function platformDocumentFilePath(root, key) {
  const map = {
    fleet: ["data", "processed", "fleet.json"],
    revenue: ["data", "processed", "revenue-ledger.json"],
    volunteers: ["data", "processed", "volunteer-mirror.json"],
    staffDirectory: ["data", "processed", "staff-directory.json"],
    consent: ["data", "processed", "consent-ledger.json"],
    passportHunt: ["data", "processed", "sculpture-passport.json"],
    passportCompletions: ["data", "processed", "passport-completions.json"],
    voting: ["data", "processed", "peoples-choice.json"],
    booths: ["data", "processed", "booth-map.json"],
    partnerOps: ["data", "processed", "partner-operations.json"],
    incomingDocuments: ["data", "processed", "incoming-documents.json"],
    islandConditions: ["data", "processed", "island-conditions.json"],
    smsOperations: ["data", "processed", "sms-operations.json"],
    quickBooksCredentials: ["data", "processed", "quickbooks-credentials.json"],
    workerStatus: ["data", "processed", "worker-status.json"]
  };
  if (!map[key]) throw new Error(`Unknown platform document key: ${key}`);
  return path.join(root, ...map[key]);
}

function usePostgres() {
  return Boolean(process.env.SANDFEST_DATABASE_URL);
}

function documentKeyFor(key) {
  return DOC_KEYS[key] || key;
}

async function lockPlatformDocument(client, documentKey) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`texas-sandfest:platform-document:${documentKey}`]);
}

async function pg() {
  const { getPool, ensureSchema } = await import("./db/pool.mjs");
  await ensureSchema();
  return getPool();
}

export async function readPlatformDoc(root, key, fallback = null) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    const documentKey = documentKeyFor(key);
    const { rows } = await pool.query(
      "SELECT data FROM platform_documents WHERE key = $1",
      [documentKey]
    );
    if (rows.length === 0) {
      // Seed through the transaction path. If a first write wins between this
      // read and the lock, updatePlatformDoc returns that row instead of
      // replacing it with the repository seed.
      const fromFile = await readJsonFile(platformDocumentFilePath(root, key), fallback);
      if (fromFile != null) {
        return updatePlatformDoc(root, key, current => current, { fallback: fromFile });
      }
      return fallback;
    }
    return rows[0].data;
  }
  return readJsonFile(platformDocumentFilePath(root, key), fallback);
}

export async function writePlatformDoc(root, key, data) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    const client = await pool.connect();
    const documentKey = documentKeyFor(key);
    try {
      await client.query("BEGIN");
      await lockPlatformDocument(client, documentKey);
      await client.query(
        `INSERT INTO platform_documents (key, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [documentKey, JSON.stringify(data)]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return data;
  }
  return withRuntimeOwnership(root, async () => {
    await writeJsonFileAtomic(platformDocumentFilePath(root, key), data);
    return data;
  });
}

export async function updatePlatformDoc(root, key, mutator, { fallback = null } = {}) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    const client = await pool.connect();
    const documentKey = documentKeyFor(key);
    try {
      await client.query("BEGIN");
      // FOR UPDATE cannot lock a row that does not exist yet. The transaction
      // advisory lock protects the first insert as well as later updates across
      // every API/worker process using this database.
      await lockPlatformDocument(client, documentKey);
      const { rows } = await client.query(
        "SELECT data FROM platform_documents WHERE key = $1 FOR UPDATE",
        [documentKey]
      );
      let current = rows[0]?.data ?? null;
      if (current == null) {
        current = await readJsonFile(platformDocumentFilePath(root, key), fallback);
      }
      const next = await mutator(current);
      if (next !== undefined) {
        await client.query(
          `INSERT INTO platform_documents (key, data, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [documentKey, JSON.stringify(next)]
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
  return withRuntimeOwnership(root, () => updateJsonFile(platformDocumentFilePath(root, key), mutator, { fallback }));
}

// --- Passport completions (append-heavy; separate table in Postgres) ---

export async function listPassportCompletions(root, { limit = 50_000, huntId = null } = {}) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    const { rows } = huntId
      ? await pool.query(
          `SELECT data FROM hunt_completions WHERE hunt_id = $1 ORDER BY completed_at DESC LIMIT $2`,
          [huntId, limit]
        )
      : await pool.query(
          `SELECT data FROM hunt_completions ORDER BY completed_at DESC LIMIT $1`,
          [limit]
        );
    return rows.map(r => r.data);
  }
  const doc = await readJsonFile(platformDocumentFilePath(root, "passportCompletions"), { completions: [] });
  const completions = Array.isArray(doc.completions) ? doc.completions : [];
  return huntId ? completions.filter(item => item.huntId === huntId) : completions;
}

export async function appendPassportCompletion(root, completion) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    await pool.query(
      `INSERT INTO hunt_completions (id, hunt_id, checkpoint_id, attendee_ref, method, points, data, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (hunt_id, checkpoint_id, attendee_ref) DO NOTHING`,
      [
        completion.id,
        completion.huntId,
        completion.checkpointId,
        completion.attendeeRef,
        completion.method ?? "qr_scan",
        completion.pointsAwarded ?? 0,
        JSON.stringify(completion),
        completion.at ?? new Date().toISOString()
      ]
    );
    return listPassportCompletions(root, { huntId: completion.huntId });
  }
  return withRuntimeOwnership(root, async () => {
    const next = await updateJsonFile(
      platformDocumentFilePath(root, "passportCompletions"),
      doc => {
        const base = doc && typeof doc === "object" ? doc : { completions: [] };
        const completions = Array.isArray(base.completions) ? base.completions.slice() : [];
        const exists = completions.some(
          c => c.attendeeRef === completion.attendeeRef && c.checkpointId === completion.checkpointId && c.huntId === completion.huntId
        );
        if (!exists) completions.push(completion);
        return {
          ...base,
          lastUpdated: new Date().toISOString(),
          completions
        };
      },
      { fallback: { completions: [] } }
    );
    return next.completions;
  });
}

// --- People's Choice votes (one row per attendee; upsert) ---

export async function listVotes(root, { limit = 100_000, eventId = null } = {}) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    const { rows } = eventId
      ? await pool.query(
          `SELECT data FROM peoples_choice_votes WHERE event_id = $1 ORDER BY voted_at DESC LIMIT $2`,
          [eventId, limit]
        )
      : await pool.query(
          `SELECT data FROM peoples_choice_votes ORDER BY voted_at DESC LIMIT $1`,
          [limit]
        );
    return rows.map(r => r.data);
  }
  const doc = await readJsonFile(platformDocumentFilePath(root, "voting"), { votes: [] });
  const votes = Array.isArray(doc.votes) ? doc.votes : [];
  return eventId ? votes.filter(item => item.eventId === eventId) : votes;
}

export async function upsertVote(root, vote, ballotMeta = {}) {
  await assertRuntimeOwnership(root);
  if (usePostgres()) {
    const pool = await pg();
    await pool.query(
      `INSERT INTO peoples_choice_votes (id, event_id, entry_id, attendee_ref, channel, data, voted_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (event_id, attendee_ref) DO UPDATE SET
         entry_id = EXCLUDED.entry_id,
         channel = EXCLUDED.channel,
         data = EXCLUDED.data,
         voted_at = EXCLUDED.voted_at`,
      [
        vote.id,
        vote.eventId ?? DEFAULT_EVENT_ID,
        vote.entryId,
        vote.attendeeRef,
        vote.channel ?? "web",
        JSON.stringify(vote),
        vote.at ?? new Date().toISOString()
      ]
    );
    // Keep ballot document metadata (entries, open flag) in platform_documents
    if (ballotMeta && Object.keys(ballotMeta).length) {
      await writePlatformDoc(root, "voting", {
        ...ballotMeta,
        lastUpdated: new Date().toISOString(),
        // votes live in table; keep empty array in doc for file-compat readers
        votes: []
      });
    }
    return listVotes(root, { eventId: vote.eventId ?? DEFAULT_EVENT_ID });
  }
  return withRuntimeOwnership(root, async () => {
    const next = await updateJsonFile(
      platformDocumentFilePath(root, "voting"),
      doc => {
        const base = doc && typeof doc === "object" ? doc : { votes: [], entries: [] };
        const votes = Array.isArray(base.votes) ? base.votes.slice() : [];
        const idx = votes.findIndex(v => v.attendeeRef === vote.attendeeRef);
        if (idx === -1) votes.push(vote);
        else votes[idx] = vote;
        return {
          ...base,
          ...ballotMeta,
          lastUpdated: new Date().toISOString(),
          votes
        };
      },
      { fallback: { votes: [], entries: [] } }
    );
    return next.votes;
  });
}

export async function readVotingBallot(root) {
  const doc = await readPlatformDoc(root, "voting", {
    publicationStatus: "unpublished",
    votingOpen: false,
    entries: [],
    votes: [],
    title: "People's Choice",
    description: "",
    eventId: DEFAULT_EVENT_ID
  });
  const eventId = doc.eventId ?? DEFAULT_EVENT_ID;
  const votes = usePostgres() ? await listVotes(root, { eventId }) : (doc.votes || []);
  return { ...doc, votes };
}
