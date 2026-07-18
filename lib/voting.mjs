import { DEFAULT_EVENT_ID } from "./event-context.mjs";

// People's Choice sculpture voting — Phase 1 native build from
// docs/research/07-engagement-scavenger-hunt.md (peoplesChoiceVote schema).
//
// Pure module: one vote per attendeeRef (can change), tally by entry, public
// leaderboard. Offline-first clients keep a local pick and sync when online.

export const VOTE_CHANNELS = ["app", "web", "qr", "kiosk", "import"];

export function publicVotingPublication(input = {}, { eventId = DEFAULT_EVENT_ID, allowSample = false } = {}) {
  const publicationStatus = String(input.publicationStatus || "unpublished").trim().toLowerCase();
  const source = String(input.source || "").trim().toLowerCase();
  const eventMatches = input.eventId === eventId;
  const entries = Array.isArray(input.entries)
    ? input.entries.map(normalizeBallotEntry).filter(entry => entry.id && entry.title && entry.eligible)
    : [];
  const votes = Array.isArray(input.votes) ? input.votes.map(normalizeVote) : [];
  const sample = allowSample && publicationStatus === "sample" && source === "fictional_board_demo";
  const authoritativeSource = Boolean(source) && !/(awaiting|demo|fictional|placeholder|sample|seed|fixture|test)/i.test(source);
  const published = publicationStatus === "published" && authoritativeSource;
  const visible = eventMatches && entries.length > 0 && (sample || published);

  return {
    visible,
    mode: visible ? (sample ? "demo" : "published") : "unpublished",
    votingOpen: visible && input.votingOpen === true,
    entries: visible ? entries : [],
    votes: visible ? votes : [],
    issues: [
      !eventMatches && "event context mismatch",
      publicationStatus !== "published" && !sample && "ballot is not published",
      publicationStatus === "published" && !authoritativeSource && "ballot source is not authoritative",
      entries.length === 0 && "ballot has no eligible entries"
    ].filter(Boolean)
  };
}

// Ticket-linked identity: Eventeny/Stripe ticket QR or order id.
// Examples: tsf:t:WB-29F4-7B0A · order_abc123 · evt_ticket_…
export function normalizeTicketRef(raw) {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim().slice(0, 120);
  if (!value) return null;
  if (/^tsf:t:[a-z0-9._-]+$/i.test(value)) return value;
  if (/^order_[a-z0-9-]+$/i.test(value)) return value;
  if (/^[a-z0-9][a-z0-9._-]{5,80}$/i.test(value)) return value;
  return null;
}

export function normalizeVote(raw = {}) {
  const channel = VOTE_CHANNELS.includes(raw.channel) ? raw.channel : "web";
  return {
    id: raw.id ?? null,
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    entryId: raw.entryId ?? null,
    attendeeRef: String(raw.attendeeRef ?? "").trim().slice(0, 120),
    ticketRef: normalizeTicketRef(raw.ticketRef ?? raw.ticketId ?? raw.ticket),
    at: raw.at ?? null,
    channel
  };
}

export function normalizeBallotEntry(raw = {}) {
  return {
    id: raw.id ?? null,
    title: String(raw.title ?? "").trim().slice(0, 120),
    sculptorName: raw.sculptorName == null ? null : String(raw.sculptorName).trim().slice(0, 120),
    division: raw.division ?? null,
    beachMarker: raw.beachMarker == null ? null : String(raw.beachMarker),
    eligible: raw.eligible !== false
  };
}

/**
 * Apply or change a vote. One active vote per attendeeRef.
 * Returns { ok, error?, vote, changed, votes }.
 */
export function applyVote(state, input = {}, { idFactory, now, requireTicket = false } = {}) {
  const entries = (state.entries || []).map(normalizeBallotEntry);
  const votes = (state.votes || []).map(normalizeVote);
  const attendeeRef = String(input.attendeeRef ?? "").trim();
  const entryId = String(input.entryId ?? "").trim();
  const ticketRef = normalizeTicketRef(input.ticketRef ?? input.ticketId ?? input.ticket);

  if (!attendeeRef || attendeeRef.length < 4) {
    return { ok: false, error: "attendeeRef is required (min 4 chars)." };
  }
  if (!entryId) {
    return { ok: false, error: "entryId is required." };
  }
  if (requireTicket && !ticketRef) {
    return {
      ok: false,
      error: "A valid ticketRef is required (tsf:t:… wristband QR or order_… id)."
    };
  }
  if (input.ticketRef && !ticketRef) {
    return { ok: false, error: "ticketRef format is invalid." };
  }

  const entry = entries.find(e => e.id === entryId && e.eligible);
  if (!entry) {
    return { ok: false, error: `Entry not found or not eligible: ${entryId}` };
  }

  if (state.votingOpen === false) {
    return { ok: false, error: "People's Choice voting is closed." };
  }

  // One vote per ticket when ticket-linked (prevents multi-device stuffing with same ticket).
  if (ticketRef) {
    const ticketOwner = votes.find(v => v.ticketRef === ticketRef && v.attendeeRef !== attendeeRef);
    if (ticketOwner) {
      return { ok: false, error: "This ticket has already been used to vote on another device." };
    }
  }

  const timestamp = now || new Date().toISOString();
  const channel = VOTE_CHANNELS.includes(input.channel) ? input.channel : "web";
  const existingIndex = votes.findIndex(v => v.attendeeRef === attendeeRef);

  if (existingIndex !== -1) {
    const existing = votes[existingIndex];
    if (existing.entryId === entryId && existing.ticketRef === ticketRef) {
      return {
        ok: true,
        changed: false,
        vote: existing,
        votes
      };
    }
    const updated = normalizeVote({
      ...existing,
      entryId,
      ticketRef: ticketRef ?? existing.ticketRef,
      at: timestamp,
      channel
    });
    const next = votes.slice();
    next[existingIndex] = updated;
    return { ok: true, changed: true, vote: updated, votes: next };
  }

  const vote = normalizeVote({
    id: input.id || (idFactory ? idFactory() : `vote_${Date.now()}`),
    eventId: state.eventId || DEFAULT_EVENT_ID,
    entryId,
    attendeeRef,
    ticketRef,
    at: timestamp,
    channel
  });

  return {
    ok: true,
    changed: true,
    vote,
    votes: votes.concat(vote)
  };
}

export function tallyVotes(entries = [], votes = []) {
  const ballot = entries.map(normalizeBallotEntry).filter(e => e.eligible);
  const normalized = votes.map(normalizeVote);
  const counts = new Map(ballot.map(e => [e.id, 0]));

  for (const v of normalized) {
    if (counts.has(v.entryId)) counts.set(v.entryId, counts.get(v.entryId) + 1);
  }

  const totalVotes = [...counts.values()].reduce((a, b) => a + b, 0);
  const leaderboard = ballot
    .map(e => {
      const count = counts.get(e.id) || 0;
      return {
        ...e,
        votes: count,
        sharePct: totalVotes ? Math.round((count / totalVotes) * 1000) / 10 : 0
      };
    })
    .sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));

  return {
    totalVotes,
    uniqueVoters: new Set(normalized.map(v => v.attendeeRef)).size,
    leaderboard,
    leader: leaderboard[0] || null
  };
}

export function voteForAttendee(votes = [], attendeeRef) {
  const ref = String(attendeeRef ?? "").trim();
  if (!ref) return null;
  return votes.map(normalizeVote).find(v => v.attendeeRef === ref) || null;
}

export function summarizeVoting(entries = [], votes = [], opts = {}) {
  const tally = tallyVotes(entries, votes);
  return {
    eventId: opts.eventId || DEFAULT_EVENT_ID,
    votingOpen: opts.votingOpen !== false,
    generatedAt: opts.generatedAt || null,
    totals: {
      eligibleEntries: entries.map(normalizeBallotEntry).filter(e => e.eligible).length,
      totalVotes: tally.totalVotes,
      uniqueVoters: tally.uniqueVoters
    },
    leader: tally.leader
      ? { entryId: tally.leader.id, title: tally.leader.title, votes: tally.leader.votes, sharePct: tally.leader.sharePct }
      : null,
    leaderboard: tally.leaderboard
  };
}

/** Build ballot entries from sculptors.json entries. */
export function ballotFromSculptors(sculptorsDoc = {}) {
  const sculptors = Array.isArray(sculptorsDoc.sculptors) ? sculptorsDoc.sculptors : [];
  const entries = Array.isArray(sculptorsDoc.entries) ? sculptorsDoc.entries : [];
  const byId = new Map(sculptors.map(s => [s.id, s]));
  return entries.map(entry => normalizeBallotEntry({
    id: entry.id,
    title: entry.title,
    sculptorName: byId.get(entry.sculptorId)?.name || null,
    division: entry.division,
    beachMarker: entry.beachMarker,
    eligible: true
  }));
}
