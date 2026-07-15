// Enterprise data access for high-traffic festival modules.
//
// - File mode (default): atomic JSON + per-key mutex (lib/safe-json-store.mjs)
// - Postgres mode (SANDFEST_DATABASE_URL): ledger docs in platform_documents +
//   append tables for passport stamps and votes (multi-instance safe)
//
// API server should call these helpers instead of ad-hoc readFile/writeFile.

import path from "node:path";
import { readJsonFile, updateJsonFile, writeJsonFileAtomic } from "./safe-json-store.mjs";

const DOC_KEYS = {
  fleet: "fleet",
  revenue: "revenue-ledger",
  volunteers: "volunteer-mirror",
  consent: "consent-ledger",
  passportHunt: "sculpture-passport",
  passportCompletions: "passport-completions",
  voting: "peoples-choice",
  booths: "booth-map"
};

function filePathFor(root, key) {
  const map = {
    fleet: ["data", "processed", "fleet.json"],
    revenue: ["data", "processed", "revenue-ledger.json"],
    volunteers: ["data", "processed", "volunteer-mirror.json"],
    consent: ["data", "processed", "consent-ledger.json"],
    passportHunt: ["data", "processed", "sculpture-passport.json"],
    passportCompletions: ["data", "processed", "passport-completions.json"],
    voting: ["data", "processed", "peoples-choice.json"],
    booths: ["data", "processed", "booth-map.json"]
  };
  return path.join(root, ...map[key]);
}

function usePostgres() {
  return Boolean(process.env.SANDFEST_DATABASE_URL);
}

async function pg() {
  const { getPool, ensureSchema } = await import("./db/pool.mjs");
  await ensureSchema();
  return getPool();
}

export async function readPlatformDoc(root, key, fallback = null) {
  if (usePostgres()) {
    const pool = await pg();
    const { rows } = await pool.query(
      "SELECT data FROM platform_documents WHERE key = $1",
      [DOC_KEYS[key] || key]
    );
    if (rows.length === 0) {
      // Seed from file on first read so deploys bootstrap from repo seeds.
      const fromFile = await readJsonFile(filePathFor(root, key), fallback);
      if (fromFile != null) {
        await writePlatformDoc(root, key, fromFile);
        return fromFile;
      }
      return fallback;
    }
    return rows[0].data;
  }
  return readJsonFile(filePathFor(root, key), fallback);
}

export async function writePlatformDoc(root, key, data) {
  if (usePostgres()) {
    const pool = await pg();
    await pool.query(
      `INSERT INTO platform_documents (key, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [DOC_KEYS[key] || key, JSON.stringify(data)]
    );
    return data;
  }
  await writeJsonFileAtomic(filePathFor(root, key), data);
  return data;
}

export async function updatePlatformDoc(root, key, mutator, { fallback = null } = {}) {
  if (usePostgres()) {
    const pool = await pg();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT data FROM platform_documents WHERE key = $1 FOR UPDATE",
        [DOC_KEYS[key] || key]
      );
      let current = rows[0]?.data ?? null;
      if (current == null) {
        current = await readJsonFile(filePathFor(root, key), fallback);
      }
      const next = await mutator(current);
      if (next !== undefined) {
        await client.query(
          `INSERT INTO platform_documents (key, data, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [DOC_KEYS[key] || key, JSON.stringify(next)]
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
  return updateJsonFile(filePathFor(root, key), mutator, { fallback });
}

// --- Passport completions (append-heavy; separate table in Postgres) ---

export async function listPassportCompletions(root, { limit = 50_000 } = {}) {
  if (usePostgres()) {
    const pool = await pg();
    const { rows } = await pool.query(
      `SELECT data FROM hunt_completions ORDER BY completed_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map(r => r.data);
  }
  const doc = await readJsonFile(filePathFor(root, "passportCompletions"), { completions: [] });
  return Array.isArray(doc.completions) ? doc.completions : [];
}

export async function appendPassportCompletion(root, completion) {
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
    return listPassportCompletions(root);
  }
  const next = await updateJsonFile(
    filePathFor(root, "passportCompletions"),
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
}

// --- People's Choice votes (one row per attendee; upsert) ---

export async function listVotes(root, { limit = 100_000 } = {}) {
  if (usePostgres()) {
    const pool = await pg();
    const { rows } = await pool.query(
      `SELECT data FROM peoples_choice_votes ORDER BY voted_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map(r => r.data);
  }
  const doc = await readJsonFile(filePathFor(root, "voting"), { votes: [] });
  return Array.isArray(doc.votes) ? doc.votes : [];
}

export async function upsertVote(root, vote, ballotMeta = {}) {
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
        vote.eventId ?? "texas-sandfest-2026",
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
    return listVotes(root);
  }
  const next = await updateJsonFile(
    filePathFor(root, "voting"),
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
}

export async function readVotingBallot(root) {
  const doc = await readPlatformDoc(root, "voting", {
    votingOpen: true,
    entries: [],
    votes: [],
    title: "People's Choice",
    description: "",
    eventId: "texas-sandfest-2026"
  });
  const votes = usePostgres() ? await listVotes(root) : (doc.votes || []);
  return { ...doc, votes };
}
