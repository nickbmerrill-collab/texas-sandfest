# Camera Metric Ingestion

## Boundary

Camera hosts keep RTSP credentials, frames, recordings, and inference workloads on the local network. SandFest receives only derived numbers. The web API does not accept images or video and stamps every stored observation with `rawMediaStored: false`.

Do not enable face recognition, identity tracking, demographic inference, or persistent device identifiers. Event operations need anonymous flow, count, occupancy, queue, and wait estimates.

The included local inference process, eight-camera template, calibration procedure, and service setup are documented in [Camera Edge Agent](camera-edge-agent.md). This document remains the server-side authentication and incident contract.

## Configure A Source

Use the admin Island Conditions workspace or:

```http
PATCH /api/admin/island-conditions/cameras/north-gate
Authorization: Bearer <ops-or-super-admin-token>
Content-Type: application/json

{
  "sourceId": "local-north-gate-1",
  "status": "configured",
  "staleAfterMinutes": 5,
  "sourceUrl": ""
}
```

`sourceId` is an identifier, not a credential. Private stream URLs remain on the local camera host. `sourceUrl` is only for a safe public information page, such as a TxDOT camera directory.

## Post Metrics

Configure one or more 32+ character credentials per camera on the API. The key ID is operational metadata; the secret stays only in the API secret store and its assigned local inference host.

```dotenv
CAMERA_INGEST_ENABLED=true
CAMERA_INGEST_KEYS={"north-gate-v1":{"cameraId":"north-gate","secret":"replace-with-32-or-more-characters"},"north-gate-v2":{"cameraId":"north-gate","secret":"second-rotation-secret-32-characters"}}
CAMERA_INGEST_REQUIRED_CAMERA_IDS=ferry-loading,ferry-stacking,harbor-island-entrance,harbor-island-stacking,north-gate,south-gate,food-court,competition-corridor
```

When production ingest is enabled, readiness stays red until every required camera ID has at least one active credential. The eight-source fleet above is the production default; update the explicit list only after the approved camera plan changes.

The request signature is lowercase hex HMAC-SHA256 over:

```text
camera:v1:<key_id>:<unix_timestamp_seconds>:<exact_raw_json_body>
```

Required headers:

```http
X-SandFest-Timestamp: 1784210400
X-SandFest-Camera-Key-Id: north-gate-v1
X-SandFest-Signature: sha256=<hex digest>
```

Example payload:

```json
{
  "eventId": "north-gate-2026-07-16T14:00:00Z",
  "sourceId": "local-north-gate-1",
  "observedAt": "2026-07-16T14:00:00.000Z",
  "peopleCount": 182,
  "vehicleCount": 0,
  "flowPerMinute": 27,
  "occupancyPct": 68,
  "queueLength": 24,
  "estimatedWaitMinutes": 11,
  "confidence": 0.93,
  "modelName": "local-crowd-counter",
  "modelVersion": "2026.07"
}
```

The API rejects unsigned requests, signatures outside the configured clock-skew window, unconfigured or mismatched sources, future/old observations, and out-of-range metrics. Reusing the same `eventId` for a retry returns the original observation instead of duplicating it.

Monitoring must be armed per source before signed heartbeats or observations are accepted. This separates configured-but-not-yet-installed cameras from pipelines expected to be live during operations.

Each armed pipeline also posts a heartbeat to `/api/ingest/cameras/<camera-id>/heartbeat`:

```json
{
  "heartbeatId": "north-gate-2026-07-16T14:00:00Z",
  "sourceId": "local-north-gate-1",
  "observedAt": "2026-07-16T14:00:00.000Z",
  "status": "healthy",
  "agentId": "beach-inference-a",
  "framesPerSecond": 12.4,
  "inferenceLatencyMs": 48,
  "droppedFramePct": 0.7,
  "uptimeSeconds": 7200,
  "agentVersion": "2026.07",
  "modelName": "local-crowd-counter",
  "modelVersion": "2026.07"
}
```

Allowed heartbeat states are `starting`, `healthy`, `degraded`, and `error`. The admin workspace labels an armed source offline when its heartbeat passes the camera's stale threshold. Agent IDs, versions, model details, latency, and errors remain admin-only.

## Incident Escalation

Every accepted observation and heartbeat is evaluated inside the same atomic conditions-document update. The default policy is:

- One `critical` condition or `error` heartbeat opens an incident immediately.
- Two consecutive `high` conditions or `degraded` heartbeats within ten minutes open an incident.
- Three consecutive recovered samples move an active incident to `monitoring`.
- A renewed elevated signal reopens a monitoring incident as `responding`.
- Automation never resolves or dismisses an incident.

Only one active incident is maintained per camera and signal type. Replayed observation or heartbeat IDs do not add signals or create duplicate incidents. Traffic and queue cameras route to the traffic team, line cameras route to guest services, and crowd or pipeline-health incidents route to operations.

Critical crowd/queue conditions and wait estimates of 30 minutes or more are marked for public-notice review. They are not published automatically. An authorized operator must explicitly enable `publicImpact`; the public API then emits only the incident title, summary, severity, and update time. Owners, timelines, signal history, source internals, and health diagnostics remain admin-only.

Operator routes require `conditions:write`:

```http
POST /api/admin/island-conditions/incidents
PATCH /api/admin/island-conditions/incidents/<incident-id>
```

Responder dispatch uses the same permission and supports teams, named staff, and roster-backed volunteers:

```http
POST  /api/admin/island-conditions/incidents/<incident-id>/dispatches
PATCH /api/admin/island-conditions/incidents/<incident-id>/dispatches/<dispatch-id>
POST  /api/admin/island-conditions/incidents/<incident-id>/dispatches/<dispatch-id>/review
POST  /api/admin/island-conditions/incidents/<incident-id>/dispatches/<dispatch-id>/send
```

Assignments progress through `assigned`, `acknowledged`, `en_route`, `on_scene`, and `completed`, or may be canceled. Creation is idempotent for the same active assignment. An optional operational email starts as a versioned draft; staff must explicitly approve it before the API will queue it, and the queue remains unavailable until transactional email is configured. The worker revalidates volunteer recipients immediately before delivery, records the provider message ID or terminal failure, and treats a close/send race as an idempotent cancellation. Recipient addresses remain stored server-side and are replaced with `recipientAvailable` in admin API responses.

Closing an incident requires a non-empty resolution note. It also cancels every active dispatch and unsent dispatch notification. The admin Island Incident Command workspace exposes assignment, acknowledgment, response, monitoring, resolution, dispatch, message review, and public-notice controls, with every manual change written to the audit ledger.

The included client posts JSON from a file or stdin:

```bash
CAMERA_ID=north-gate \
CAMERA_SOURCE_ID=local-north-gate-1 \
CAMERA_INGEST_KEY_ID=north-gate-v1 \
CAMERA_INGEST_SECRET='<secret-for-this-key-id>' \
SANDFEST_API_BASE=https://api.heyelab.com/sandfest \
npm run camera:push -- observation.json
```

For the isolated board runtime only, `npm run board:cameras` drives all eight lanes through these same source-activation, heartbeat, signature, idempotency, freshness, and incident-evaluation boundaries. It is loopback-only, requires the API to report `runtime.mode=board_demo`, uses synthetic metrics, and does not prove that a physical camera or edge model has been commissioned.

Post a heartbeat with the same client:

```bash
CAMERA_ID=north-gate \
CAMERA_SOURCE_ID=local-north-gate-1 \
CAMERA_INGEST_KEY_ID=north-gate-v1 \
CAMERA_INGEST_SECRET='<secret-for-this-key-id>' \
npm run camera:push -- --heartbeat heartbeat.json
```

## Operations

- Sync camera hosts with NTP; default signature skew is five minutes.
- Use one stable source ID per camera pipeline.
- Generate event IDs deterministically from source plus observation window so retries remain idempotent.
- Send one aggregate every 5-30 seconds; the default rate limit supports eight feeds at that cadence.
- Send a heartbeat at least once per minute and before the first metric after agent startup.
- Alert when a configured source becomes stale, but publish its level as `unknown` rather than carrying the last value forward.
- Staff the Incident Command queue whenever monitoring is armed; automated escalation does not replace operator acknowledgment, dispatch, or closeout.
- Fresh `ferry-loading` and `ferry-stacking` observations automatically produce a `camera_estimate` ferry wait; a fresher reviewed operator update takes precedence.
- Rotate one camera at a time: add a second key ID for that camera, deploy it to the local host, confirm the admin workspace reports rotation overlap, switch the host, and then remove the old key.
- Revoke only the affected camera credential after a suspected disclosure. A key bound to one camera cannot authenticate another camera route.
- `CAMERA_INGEST_SECRET` without a key ID remains available only for local development. Production requires `CAMERA_INGEST_KEYS` and rejects shared-only configuration.
