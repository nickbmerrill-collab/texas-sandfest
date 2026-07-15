// Sculpture Passport / scavenger hunt — Phase 1 native build from
// docs/research/07-engagement-scavenger-hunt.md and platform-objects.json
// (hunt, huntCheckpoint, huntCompletion).
//
// Pure module: normalize records, resolve QR payloads, apply stamps, summarize
// progress. Completions are keyed by attendeeRef (device id / ticket id) so the
// same person can resume across web localStorage and iOS UserDefaults.

export const HUNT_METHODS = ["qr_scan", "tap", "manual", "import"];

export function normalizeHunt(raw = {}) {
  return {
    id: raw.id ?? "sculpture-passport-2026",
    eventId: raw.eventId ?? "texas-sandfest-2026",
    name: String(raw.name ?? "Sculpture Passport").trim().slice(0, 120),
    type: raw.type ?? "passport",
    description: String(raw.description ?? "").trim().slice(0, 600),
    startsAt: raw.startsAt ?? null,
    endsAt: raw.endsAt ?? null,
    rewardDescription: String(raw.rewardDescription ?? "").trim().slice(0, 400),
    sponsorAccountId: raw.sponsorAccountId ?? null,
    active: raw.active !== false
  };
}

export function normalizeCheckpoint(raw = {}) {
  const points = Number(raw.points);
  return {
    id: raw.id ?? null,
    huntId: raw.huntId ?? "sculpture-passport-2026",
    label: String(raw.label ?? "").trim().slice(0, 120),
    kind: raw.kind ?? "sculpture",
    linkedRecord: raw.linkedRecord ?? null,
    mapMarkerId: raw.mapMarkerId ?? null,
    code: String(raw.code ?? raw.id ?? "").trim().slice(0, 64),
    unlockContent: raw.unlockContent == null ? "" : String(raw.unlockContent).trim().slice(0, 600),
    sponsorAccountId: raw.sponsorAccountId ?? null,
    points: Number.isFinite(points) ? Math.max(0, Math.round(points)) : 10,
    order: Number(raw.order) || 0,
    beachMarker: raw.beachMarker == null ? null : String(raw.beachMarker),
    sculptorName: raw.sculptorName == null ? null : String(raw.sculptorName),
    entryId: raw.entryId ?? raw.linkedRecord?.id ?? null,
    division: raw.division ?? null
  };
}

export function normalizeCompletion(raw = {}) {
  const method = HUNT_METHODS.includes(raw.method) ? raw.method : "qr_scan";
  const points = Number(raw.pointsAwarded);
  return {
    id: raw.id ?? null,
    huntId: raw.huntId ?? "sculpture-passport-2026",
    checkpointId: raw.checkpointId ?? null,
    attendeeRef: String(raw.attendeeRef ?? "").trim().slice(0, 120),
    at: raw.at ?? null,
    method,
    pointsAwarded: Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0
  };
}

/**
 * Resolve a QR / typed payload to a checkpoint id.
 * Accepts:
 *   tsf:cp:<checkpointId>
 *   tsf:entry:<entryId>
 *   tsf:sculpt:<entryId|code>
 *   bare checkpoint code (TSF-CP-…)
 *   bare checkpoint id (cp_…)
 *   bare entry id (ent_…)
 */
export function parsePassportPayload(raw, checkpoints = []) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const list = checkpoints.map(normalizeCheckpoint);

  const prefixed = value.match(/^tsf:(cp|entry|sculpt|passport):(.+)$/i);
  if (prefixed) {
    const token = prefixed[2].trim();
    return findCheckpoint(list, token);
  }

  return findCheckpoint(list, value);
}

function findCheckpoint(list, token) {
  const t = String(token).trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  return (
    list.find(c => c.id && c.id.toLowerCase() === lower) ||
    list.find(c => c.code && c.code.toLowerCase() === lower) ||
    list.find(c => c.entryId && c.entryId.toLowerCase() === lower) ||
    list.find(c => c.mapMarkerId && c.mapMarkerId.toLowerCase() === lower) ||
    null
  );
}

export function publicCheckpoint(cp) {
  const c = normalizeCheckpoint(cp);
  return {
    id: c.id,
    huntId: c.huntId,
    label: c.label,
    kind: c.kind,
    code: c.code,
    qrPayload: c.id ? `tsf:cp:${c.id}` : null,
    beachMarker: c.beachMarker,
    sculptorName: c.sculptorName,
    entryId: c.entryId,
    division: c.division,
    points: c.points,
    order: c.order,
    unlockContent: c.unlockContent,
    mapMarkerId: c.mapMarkerId
  };
}

export function progressForAttendee(checkpoints = [], completions = [], attendeeRef, huntId = "sculpture-passport-2026") {
  const cps = checkpoints.map(normalizeCheckpoint).filter(c => c.huntId === huntId);
  const ref = String(attendeeRef ?? "").trim();
  const mine = completions
    .map(normalizeCompletion)
    .filter(c => c.huntId === huntId && c.attendeeRef === ref && c.checkpointId);

  const stampedIds = new Set(mine.map(c => c.checkpointId));
  const total = cps.length;
  const collected = cps.filter(c => stampedIds.has(c.id)).length;
  const points = mine.reduce((sum, c) => sum + (c.pointsAwarded || 0), 0);
  const complete = total > 0 && collected >= total;

  return {
    attendeeRef: ref || null,
    huntId,
    total,
    collected,
    points,
    complete,
    fillPct: total ? Math.round((collected / total) * 1000) / 10 : 0,
    stampedCheckpointIds: [...stampedIds],
    completions: mine.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  };
}

/**
 * Apply a stamp. Idempotent for the same attendee+checkpoint.
 * Returns { ok, error?, completion, alreadyStamped, progress }.
 */
export function applyStamp(state, input = {}, { idFactory, now } = {}) {
  const hunt = normalizeHunt(state.hunt || {});
  const checkpoints = (state.checkpoints || []).map(normalizeCheckpoint);
  const completions = (state.completions || []).map(normalizeCompletion);

  if (!hunt.active) {
    return { ok: false, error: "Sculpture Passport is not active yet." };
  }

  const attendeeRef = String(input.attendeeRef ?? "").trim();
  if (!attendeeRef || attendeeRef.length < 4) {
    return { ok: false, error: "attendeeRef is required (device or ticket id, min 4 chars)." };
  }

  let checkpoint = null;
  if (input.checkpointId) {
    checkpoint = checkpoints.find(c => c.id === input.checkpointId) || null;
  } else if (input.payload || input.code || input.qr) {
    checkpoint = parsePassportPayload(input.payload ?? input.code ?? input.qr, checkpoints);
  } else if (input.entryId) {
    checkpoint = checkpoints.find(c => c.entryId === input.entryId) || null;
  }

  if (!checkpoint) {
    return { ok: false, error: "Unrecognized passport code or checkpoint." };
  }

  const existing = completions.find(
    c => c.attendeeRef === attendeeRef && c.checkpointId === checkpoint.id && c.huntId === hunt.id
  );
  if (existing) {
    return {
      ok: true,
      alreadyStamped: true,
      completion: existing,
      checkpoint: publicCheckpoint(checkpoint),
      progress: progressForAttendee(checkpoints, completions, attendeeRef, hunt.id),
      completions
    };
  }

  const timestamp = now || new Date().toISOString();
  const method = HUNT_METHODS.includes(input.method) ? input.method : "qr_scan";
  const completion = normalizeCompletion({
    id: input.id || (idFactory ? idFactory() : `hc_${Date.now()}`),
    huntId: hunt.id,
    checkpointId: checkpoint.id,
    attendeeRef,
    at: timestamp,
    method,
    pointsAwarded: checkpoint.points
  });

  const nextCompletions = completions.concat(completion);
  return {
    ok: true,
    alreadyStamped: false,
    completion,
    checkpoint: publicCheckpoint(checkpoint),
    progress: progressForAttendee(checkpoints, nextCompletions, attendeeRef, hunt.id),
    completions: nextCompletions
  };
}

export function summarizePassport(checkpoints = [], completions = [], hunt = {}, opts = {}) {
  const cps = checkpoints.map(normalizeCheckpoint);
  const comps = completions.map(normalizeCompletion);
  const h = normalizeHunt(hunt);

  const byCheckpoint = {};
  for (const cp of cps) {
    byCheckpoint[cp.id] = { checkpointId: cp.id, label: cp.label, stamps: 0, points: cp.points };
  }
  const attendees = new Set();
  let totalPoints = 0;
  for (const c of comps) {
    attendees.add(c.attendeeRef);
    totalPoints += c.pointsAwarded || 0;
    if (byCheckpoint[c.checkpointId]) byCheckpoint[c.checkpointId].stamps += 1;
  }

  const finishers = countFinishers(cps, comps, h.id);

  return {
    huntId: h.id,
    generatedAt: opts.generatedAt || null,
    totals: {
      checkpoints: cps.length,
      stamps: comps.length,
      uniqueAttendees: attendees.size,
      finishers,
      totalPointsAwarded: totalPoints
    },
    byCheckpoint: Object.values(byCheckpoint).sort((a, b) => b.stamps - a.stamps)
  };
}

function countFinishers(checkpoints, completions, huntId) {
  const total = checkpoints.filter(c => c.huntId === huntId).length;
  if (!total) return 0;
  const byAttendee = new Map();
  for (const c of completions) {
    if (c.huntId !== huntId) continue;
    if (!byAttendee.has(c.attendeeRef)) byAttendee.set(c.attendeeRef, new Set());
    byAttendee.get(c.attendeeRef).add(c.checkpointId);
  }
  let finishers = 0;
  for (const set of byAttendee.values()) {
    if (set.size >= total) finishers += 1;
  }
  return finishers;
}

/** Build checkpoints from sculptors.json entries (+ sculptor names). */
export function checkpointsFromSculptors(sculptorsDoc = {}) {
  const sculptors = Array.isArray(sculptorsDoc.sculptors) ? sculptorsDoc.sculptors : [];
  const entries = Array.isArray(sculptorsDoc.entries) ? sculptorsDoc.entries : [];
  const bySculptor = new Map(sculptors.map(s => [s.id, s]));

  return entries.map((entry, index) => {
    const sculptor = bySculptor.get(entry.sculptorId);
    const id = `cp_${entry.id}`;
    return normalizeCheckpoint({
      id,
      huntId: "sculpture-passport-2026",
      label: entry.title,
      kind: "sculpture",
      linkedRecord: { type: "sculptureEntry", id: entry.id },
      mapMarkerId: entry.poiId ?? null,
      code: `TSF-CP-${String(index + 1).padStart(4, "0")}`,
      unlockContent: entry.statement
        ? `${sculptor?.name || "Artist"}: ${entry.statement}`
        : (sculptor?.bio || ""),
      points: 10,
      order: index + 1,
      beachMarker: entry.beachMarker,
      sculptorName: sculptor?.name || null,
      entryId: entry.id,
      division: entry.division
    });
  });
}
