import { signCameraPayload } from "./camera-ingest.mjs";

export const BOARD_CAMERA_PROFILES = Object.freeze([
  { id: "ferry-loading", phase: 0.2, vehicleCount: [28, 44], flowPerMinute: [8, 14], occupancyPct: [40, 58], queueLength: [6, 11], estimatedWaitMinutes: [6, 10] },
  { id: "ferry-stacking", phase: 0.9, vehicleCount: [18, 34], flowPerMinute: [6, 11], occupancyPct: [35, 54], queueLength: [7, 12], estimatedWaitMinutes: [6, 9] },
  { id: "harbor-island-entrance", phase: 1.6, vehicleCount: [12, 28], flowPerMinute: [10, 18], occupancyPct: [24, 45], queueLength: [2, 6], estimatedWaitMinutes: [2, 4] },
  { id: "harbor-island-stacking", phase: 2.3, vehicleCount: [16, 30], flowPerMinute: [8, 14], occupancyPct: [32, 52], queueLength: [5, 10], estimatedWaitMinutes: [3, 7] },
  { id: "north-gate", phase: 3, peopleCount: [110, 190], flowPerMinute: [24, 34], occupancyPct: [35, 59], queueLength: [6, 11], estimatedWaitMinutes: [4, 8] },
  { id: "south-gate", phase: 3.7, peopleCount: [80, 145], flowPerMinute: [18, 29], occupancyPct: [30, 52], queueLength: [4, 9], estimatedWaitMinutes: [3, 6] },
  { id: "food-court", phase: 4.4, peopleCount: [90, 170], flowPerMinute: [12, 21], occupancyPct: [42, 62], queueLength: [7, 12], estimatedWaitMinutes: [6, 11] },
  { id: "competition-corridor", phase: 5.1, peopleCount: [160, 280], flowPerMinute: [17, 31], occupancyPct: [38, 60], queueLength: [3, 8], estimatedWaitMinutes: [2, 5] }
]);

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function cleanId(value, fallback = "board") {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

function oscillate(range, cycle, phase) {
  const [minimum, maximum] = range;
  const position = (Math.sin(cycle * 0.55 + phase) + 1) / 2;
  return Math.round(minimum + (maximum - minimum) * position);
}

function localApiBase(value) {
  const url = new URL(String(value || "http://127.0.0.1:8806"));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Board camera playback requires an HTTP(S) API base.");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Board camera playback is restricted to a loopback API.");
  }
  return url.toString().replace(/\/$/, "");
}

async function responseJson(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${data.error || "unexpected response"}`);
  return data;
}

async function adminRequest(apiBase, adminToken, pathname, options = {}) {
  const response = await (options.fetchImpl ?? fetch)(`${apiBase}${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return responseJson(response, options.label || pathname);
}

async function signedCameraRequest(apiBase, secret, cameraId, endpoint, payload, options = {}) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor((options.nowMs ?? Date.now()) / 1000));
  const signature = signCameraPayload(rawBody, timestamp, secret);
  const response = await (options.fetchImpl ?? fetch)(`${apiBase}/api/ingest/cameras/${encodeURIComponent(cameraId)}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sandfest-timestamp": timestamp,
      "x-sandfest-signature": `sha256=${signature}`
    },
    body: rawBody
  });
  return responseJson(response, `${cameraId} ${endpoint}`);
}

export function boardCameraSourceId(cameraId) {
  return `board-sim-${cleanId(cameraId, "camera")}`;
}

export function boardCameraObservation(profile, options = {}) {
  const cycle = boundedInteger(options.cycle, 0, Number.MAX_SAFE_INTEGER, 0);
  const runId = cleanId(options.runId, "board");
  const observedAt = new Date(options.observedAt || Date.now()).toISOString();
  const payload = {
    eventId: `board-${runId}-${profile.id}-${cycle}`,
    sourceId: boardCameraSourceId(profile.id),
    observedAt,
    flowPerMinute: oscillate(profile.flowPerMinute, cycle, profile.phase),
    occupancyPct: oscillate(profile.occupancyPct, cycle, profile.phase + 0.4),
    queueLength: oscillate(profile.queueLength, cycle, profile.phase + 0.8),
    estimatedWaitMinutes: oscillate(profile.estimatedWaitMinutes, cycle, profile.phase + 1.2),
    confidence: 0.92,
    modelName: "board-synthetic-metric-playback",
    modelVersion: "2027-demo-v1",
    processingMs: 52 + (cycle + Math.round(profile.phase * 10)) % 29,
    notes: "Synthetic board-demo metric; no camera media was read or stored."
  };
  if (profile.peopleCount) payload.peopleCount = oscillate(profile.peopleCount, cycle, profile.phase + 0.2);
  if (profile.vehicleCount) payload.vehicleCount = oscillate(profile.vehicleCount, cycle, profile.phase + 0.2);
  return payload;
}

export function boardCameraHeartbeat(profile, options = {}) {
  const cycle = boundedInteger(options.cycle, 0, Number.MAX_SAFE_INTEGER, 0);
  const runId = cleanId(options.runId, "board");
  const observedAt = new Date(options.observedAt || Date.now()).toISOString();
  return {
    heartbeatId: `board-${runId}-${profile.id}-health-${cycle}`,
    sourceId: boardCameraSourceId(profile.id),
    observedAt,
    status: "healthy",
    agentId: "board-camera-playback",
    framesPerSecond: 11 + ((cycle + Math.round(profile.phase * 10)) % 20) / 10,
    inferenceLatencyMs: 44 + (cycle + Math.round(profile.phase * 10)) % 31,
    droppedFramePct: ((cycle + Math.round(profile.phase * 10)) % 8) / 10,
    uptimeSeconds: Math.max(1, cycle * boundedInteger(options.intervalSeconds, 1, 60, 5)),
    agentVersion: "board-demo-2027-v1",
    modelName: "board-synthetic-metric-playback",
    modelVersion: "2027-demo-v1"
  };
}

export async function verifyBoardCameraPlaybackTarget(options = {}) {
  const apiBase = localApiBase(options.apiBase);
  const response = await (options.fetchImpl ?? fetch)(`${apiBase}/api/public/bootstrap`, { cache: "no-store" });
  const bootstrap = await responseJson(response, "Board runtime verification");
  if (bootstrap.runtime?.mode !== "board_demo") {
    throw new Error("Board camera playback refuses to run unless the API reports runtime.mode=board_demo.");
  }
  return { apiBase, runtime: bootstrap.runtime };
}

export async function runBoardCameraPlaybackTick(options = {}) {
  const apiBase = localApiBase(options.apiBase);
  const adminToken = String(options.adminToken || "");
  const ingestSecret = String(options.ingestSecret || "");
  if (!adminToken) throw new Error("An admin token is required for board camera playback.");
  if (ingestSecret.length < 32) throw new Error("A 32+ character camera ingest secret is required for board camera playback.");
  if (options.verifyTarget !== false) await verifyBoardCameraPlaybackTarget({ apiBase, fetchImpl: options.fetchImpl });

  const cycle = boundedInteger(options.cycle, 0, Number.MAX_SAFE_INTEGER, 0);
  const runId = cleanId(options.runId, "board");
  const observedAt = new Date(options.observedAt || Date.now()).toISOString();
  const admin = await adminRequest(apiBase, adminToken, "/api/admin/island-conditions", { fetchImpl: options.fetchImpl });
  const availableIds = new Set((admin.cameras || []).map(camera => camera.id));
  const missing = BOARD_CAMERA_PROFILES.filter(profile => !availableIds.has(profile.id)).map(profile => profile.id);
  if (missing.length) throw new Error(`Board runtime is missing camera sources: ${missing.join(", ")}.`);

  if (options.configure !== false) {
    for (const profile of BOARD_CAMERA_PROFILES) {
      await adminRequest(apiBase, adminToken, `/api/admin/island-conditions/cameras/${encodeURIComponent(profile.id)}`, {
        method: "PATCH",
        body: {
          sourceId: boardCameraSourceId(profile.id),
          status: "configured",
          staleAfterMinutes: 2,
          monitoringEnabled: true
        },
        fetchImpl: options.fetchImpl,
        label: `${profile.id} source activation`
      });
    }
  }

  let heartbeats = 0;
  if (options.heartbeat !== false) {
    for (const profile of BOARD_CAMERA_PROFILES) {
      await signedCameraRequest(apiBase, ingestSecret, profile.id, "heartbeat", boardCameraHeartbeat(profile, {
        cycle,
        runId,
        observedAt,
        intervalSeconds: options.intervalSeconds
      }), { fetchImpl: options.fetchImpl, nowMs: new Date(observedAt).getTime() });
      heartbeats += 1;
    }
  }

  const observations = [];
  for (const profile of BOARD_CAMERA_PROFILES) {
    const payload = boardCameraObservation(profile, { cycle, runId, observedAt });
    const result = await signedCameraRequest(apiBase, ingestSecret, profile.id, "observations", payload, {
      fetchImpl: options.fetchImpl,
      nowMs: new Date(observedAt).getTime()
    });
    observations.push({ cameraId: profile.id, duplicate: result.duplicate === true, level: result.observation?.level || null });
  }

  return { ok: true, apiBase, runId, cycle, observedAt, cameras: observations.length, heartbeats, observations };
}
