const BOARD_WEB_MARKER = "globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function boardDemoLoopbackUrl(value, label = "Board demo URL") {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be an absolute loopback URL.`);
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error(`${label} must use HTTP on an exact loopback host without embedded credentials.`);
  }
  return url;
}

function check(id, label, ok, detail, action = null) {
  return { id, label, ok: ok === true, detail, action: ok ? null : action };
}

export function evaluateBoardDemoReadiness(state = {}) {
  const webReady = state.web?.ok === true && Number(state.web?.status) === 200;
  const autoSessionReady = webReady && String(state.web?.html || "").includes(BOARD_WEB_MARKER);
  const boardApiReady = state.health?.ok === true
    && state.health?.service === "sandfest-admin-api"
    && state.bootstrap?.runtime?.mode === "board_demo";
  const automationReady = state.ready?.ok === true
    && state.ready?.checks?.workerStatus?.healthy === true
    && state.ready?.checks?.queueStatus?.operational === true
    && Number(state.ready?.checks?.queueStatus?.unhandledFailed || 0) === 0;
  const sandboxesReady = state.emailSandbox?.ok === true
    && state.emailSandbox?.service === "sandfest-board-email-sandbox"
    && state.emailSandbox?.mode === "board_demo"
    && state.smsSandbox?.ok === true
    && state.smsSandbox?.service === "sandfest-board-sms-sandbox"
    && state.smsSandbox?.mode === "board_demo";
  const applicationSummary = state.partners?.summary?.applications || {};
  const staffDirectory = state.partners?.staffDirectory || {};
  const operationsReady = Number(applicationSummary.total || 0) >= 4
    && Number(applicationSummary.vendors || 0) >= 2
    && Number(applicationSummary.sponsors || 0) >= 2
    && staffDirectory.ready === true
    && Number(staffDirectory.routedTeams || 0) === Number(staffDirectory.totalTeams || 0)
    && Number(staffDirectory.totalTeams || 0) >= 7
    && state.partners?.email?.ready === true;
  const weather = state.conditions?.weather || {};
  const ferry = state.conditions?.ferry || {};
  const islandFeedsReady = weather.status === "live"
    && weather.freshness?.state === "live"
    && ferry.status === "live"
    && ferry.freshness?.state === "live";
  const cameraSummary = state.conditions?.summary || {};
  const cameraFleetReady = Array.isArray(state.conditions?.cameras)
    && state.conditions.cameras.length === 8
    && Number(cameraSummary.configuredCameras || 0) === 8
    && Number(cameraSummary.armedCameras || 0) === 8
    && Number(cameraSummary.liveCameras || 0) === 8
    && Number(cameraSummary.healthyPipelines || 0) === 8
    && Number(cameraSummary.offlinePipelines || 0) === 0;

  const checks = [
    check("web", "Board web", webReady, webReady ? "Loopback site is responding." : "The board site is not responding on its configured loopback URL.", "Run npm run board:web -- --port 5175."),
    check("auto_session", "Automatic operations session", autoSessionReady, autoSessionReady ? "The board-only local session is injected." : "Port 5175 is serving an ordinary dev session, so Operations requires manual credentials.", "Restart the web process with npm run board:web -- --port 5175."),
    check("api", "Isolated board API", boardApiReady, boardApiReady ? "The API identifies the synthetic board runtime." : "The API is unavailable or is not using the isolated board_demo runtime.", "Run npm run board:runtime, then npm run board:api."),
    check("automation", "Worker and queue", automationReady, automationReady ? "The worker heartbeat is current and the queue has no unhandled failures." : "The worker is stale, the queue is unavailable, or an unhandled failure remains.", "Run npm run board:worker:watch and resolve any failed queue item."),
    check("sandboxes", "Local email and SMS", sandboxesReady, sandboxesReady ? "Both loopback-only provider sandboxes are ready." : "One or both local provider sandboxes are unavailable or in the wrong mode.", "Run npm run board:mailbox and npm run board:sms."),
    check("operations", "Seeded operations", operationsReady, operationsReady ? `${applicationSummary.total} applications and all ${staffDirectory.totalTeams} team routes are ready.` : "The board runtime is missing partner records, staff routes, or local email readiness.", "Rebuild with npm run board:runtime and restart the API."),
    check("island_feeds", "Weather and ferry", islandFeedsReady, islandFeedsReady ? "NWS weather and both-direction TxDOT ferry data are current." : "A live Island Conditions source is stale or unavailable.", "Run npm run test:live-feeds and retry after the upstream source recovers."),
    check("camera_fleet", "Eight-camera playback", cameraFleetReady, cameraFleetReady ? "All eight synthetic pipelines are armed, healthy, and live." : `${Number(cameraSummary.liveCameras || 0)}/8 camera pipelines are live and ${Number(cameraSummary.offlinePipelines || 0)} are offline.`, "Run npm run board:cameras and keep it running during the presentation.")
  ];

  return {
    ok: checks.every(item => item.ok),
    passed: checks.filter(item => item.ok).length,
    total: checks.length,
    checks
  };
}
