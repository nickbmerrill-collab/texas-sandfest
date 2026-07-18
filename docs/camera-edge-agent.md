# Camera Edge Agent

## Production Boundary

The edge agent turns a local USB, file, HTTP, or RTSP stream into anonymous operational metrics. Frames are decoded and analyzed on the camera host. Only count, flow, queue, occupancy, wait, confidence, latency, and pipeline-health JSON is sent to SandFest.

The agent has no frame upload, recording, crop export, face recognition, identity, demographic, or cross-camera re-identification path. ByteTrack IDs exist only in process memory to prevent duplicate line crossings and expire with the process. RTSP URLs and camera credentials belong in host environment files, never in the repository, API, or admin UI.

This is an operations aid, not a life-safety system. Incident publication, dispatch messages, and incident resolution remain human-controlled.

## Hardware And Network

Use a wired edge host on the private camera network. The initial target is one small NVIDIA GPU host or an Apple Silicon Mac with one process per camera. In `auto` mode the agent selects CUDA first, Apple MPS second, and CPU only when neither accelerator is available. Start with 720p or 1080p streams and a 3 FPS inference sample rate. Measure all eight feeds under event-like load before selecting hardware; model latency, decoder load, occlusion, resolution, and scene motion matter more than camera count alone.

Required host conditions:

- Python 3.10-3.13. The inference dependencies are not yet supported on the repository host's Python 3.14 runtime.
- Accurate NTP time. The API rejects signatures outside its configured clock-skew window, five minutes by default.
- Outbound HTTPS to the SandFest API and local access to each camera stream.
- Enough disk for the model and Python environment. The agent intentionally stores no event footage.
- A unique 32+ character ingest credential for each camera, with a key ID bound to that camera at the API.

YOLO11n uses the general COCO object classes. It is a practical starting detector, not a calibrated high-density crowd model. Heavy occlusion, unusual camera angles, glare, night lighting, tents, and tightly packed lines can reduce accuracy. Do not publish or operationalize estimates until each view has been field-calibrated against manual counts.

The resolved Ultralytics package and model declare AGPL-3.0. Ultralytics' own licensing guidance says projects that cannot meet the AGPL source requirements need an Enterprise license. Before production, SandFest must document approved AGPL compliance, obtain appropriate commercial terms, or replace the detector with a reviewed compatible implementation and model. This repository does not treat a successful technical test as license approval. See [Ultralytics' licensing guidance](https://docs.ultralytics.com/help/contributing/#open-sourcing-your-yolo-project-under-agpl-30). A permissively licensed implementation is only a candidate: its exact model weights, training data terms, dependencies, and deployment use still require review.

## Install

From a clean checkout on the edge host:

```bash
cd /opt/sandfest
uv venv --python 3.12 camera_agent/.venv
uv pip install --python camera_agent/.venv/bin/python \
  -r camera_agent/requirements.txt
camera_agent/.venv/bin/python -m camera_agent.edge_agent \
  --validate --config camera_agent/config.example.json
```

`requirements.txt` is the resolved universal production lock; direct dependency ranges live in `requirements.in`. Regenerate it deliberately with `uv pip compile --universal --python 3.12 camera_agent/requirements.in -o camera_agent/requirements.txt` and rerun the agent plus platform gates before promoting an update.

The first live launch downloads `yolo11n.pt` from Ultralytics if it is not already present. Prefetch it while the host has installation-network access; do not depend on an event-day download. The agent verifies the file against the approved SHA-256 in the deployed config before inference and fails closed on a mismatch. Model files and virtual environments are git-ignored.

After prefetching, prove the exact cached bytes without loading the inference stack:

```bash
SANDFEST_CAMERA_MODEL_DIR=/var/lib/sandfest-camera npm run camera:model:verify
```

The production systemd unit runs the model-approval gate, checksum preflight, and camera-scoped environment preflight before every process start. A pending license decision, missing stream, short secret, absent model, or checksum mismatch therefore fails before the decoder opens.

Copy `camera_agent/config.example.json` to `/etc/sandfest/camera-agent.json`, owned by root and readable by the service account. Keep the eight production camera IDs and source IDs aligned with the admin configuration. Tune model, rate, capacity, regions, and counting lines in this deployed copy.

The example intentionally sets `model.approval.status` to `pending`. After review, set it to `approved` and record `licenseReference`, `approvedBy`, an ISO-8601 `approvedAt`, and `decisionReference`. The existing `model.name`, `model.version`, and `model.sha256` bind that decision to exact bytes. Copy those same values into the API's `CAMERA_MODEL_*` environment variables. Signed observations and heartbeats include this model identity; production ingestion rejects missing or mismatched names, versions, or checksums before metrics reach Island Conditions. Production `/ready` and every edge service also fail closed if the attestation is absent. This records and enforces the decision but does not replace counsel or the underlying license terms.

## Secrets And Streams

Create one root-readable environment file per camera. For `north-gate`, `/etc/sandfest/camera-north-gate.env` contains:

```dotenv
SANDFEST_API_BASE=https://api.heyelab.com/sandfest
SANDFEST_CAMERA_NORTH_GATE_STREAM=rtsp://camera-user:camera-password@10.20.0.25/live
SANDFEST_CAMERA_NORTH_GATE_SECRET=replace-with-the-camera-bound-32-plus-character-secret
```

Use mode `0600`. Avoid shell history, screenshots, tickets, and shared documents when provisioning stream or HMAC credentials. A numeric stream value such as `0` selects a local capture device.

Production API configuration uses `CAMERA_INGEST_KEYS`, with the same key ID as the deployed camera config. Shared `CAMERA_INGEST_SECRET` authentication is a local-development fallback and is rejected by production readiness. See [Camera Metric Ingestion](camera-metric-ingestion.md) for the exact HMAC and key-rotation contract.

## Calibrate Each View

1. Mount the camera so the queue or travel direction is stable and the useful area is not dominated by sky, surf, or moving flags.
2. Set `roiNormalized` to the area where occupancy is counted. Coordinates are normalized from `0.0` to `1.0`, clockwise or counterclockwise around the image.
3. Set `queueRoiNormalized` to the physical stacking or line area. Only configured queue classes inside this polygon contribute to queue length and wait.
4. Put `countingLineNormalized` across the direction of travel. A tracked object crossing either direction counts once per rolling minute.
5. Set class lists to people (`0`) for crowd/line views or COCO vehicles (`2`, `3`, `5`, `7`) for traffic views.
6. Set `capacity` to the manually validated practical capacity of the region, not the camera's maximum visible objects.
7. Set `minimumServiceRatePerMinute` from timed manual observations. Wait is queue length divided by the greater of measured flow and this floor.
8. Compare agent output with manual counts across sparse, normal, busy, glare, dusk, and rain conditions. Record error ranges and alert thresholds before arming monitoring.

Normalized regions in `config.example.json` are safe placeholders, not field calibration.

## Dry Run

Validate the file without opening streams or reading secrets:

```bash
npm run camera:agent:validate
npm run test:camera-agent
npm run test:camera-model-approval
SANDFEST_CAMERA_MODEL_DIR=/var/lib/sandfest-camera npm run test:camera-agent:runtime
SANDFEST_CAMERA_MODEL_DIR=/var/lib/sandfest-camera npm run test:camera-agent:fleet-runtime
SANDFEST_CAMERA_MODEL_DIR=/var/lib/sandfest-camera npm run camera:fleet:verify
SANDFEST_CAMERA_MODEL_DIR=/var/lib/sandfest-camera npm run camera:model:verify
```

The single-camera runtime test loads the real model, tracker, OpenCV, and PyTorch stack against generated pixels. The fleet runtime test requires the canonical eight enabled camera lanes, keeps eight independent model instances resident, and requires the slowest complete eight-source inference cycle to fit inside the configured sample-rate budget. It atomically writes `.sandfest-runtime/camera-fleet-qualification.json` with software versions, exact config and model checksums, aggregate and per-lane timings, the privacy boundary, and a canonical evidence checksum. `camera:fleet:verify` rejects tampering, reports older than 24 hours, a different config or model, missing or extra lanes, shared model instances, budget overruns, and evidence fields that could disclose stream credentials or host paths.

Run the complete local-compute acceptance on the exact proposed edge host with one command:

```bash
SANDFEST_CAMERA_MODEL_DIR=/var/lib/sandfest-camera \
SANDFEST_CAMERA_CONFIG=/etc/sandfest/camera-agent.json \
SANDFEST_CAMERA_FLEET_REPORT=/var/lib/sandfest-camera/fleet-qualification.json \
npm run ready:camera-edge
```

These tests write no frame or crop and do not need camera access. The saved report proves exact model/config binding, local stack compatibility, fleet membership, independent model residency, and generated-pixel inference headroom. It does not prove RTSP decoder throughput, network behavior, camera placement, calibration, or field accuracy; those still require all eight physical feeds under event-like load. Retain the verified JSON with the commissioning record, but do not treat it as a substitute for fresh signed heartbeats and observations in production `/ready`.

`--validate-runtime` checks environment variables for every enabled camera. Combine it with `--validate-production` to require the exact eight enabled SandFest lanes plus the reviewed model attestation; the systemd service does this automatically:

```bash
camera_agent/.venv/bin/python -m camera_agent.edge_agent \
  --validate-runtime --validate-production \
  --config /etc/sandfest/camera-agent.json
```

Add `--camera north-gate` to validate only the environment file used by one systemd service. The service template performs that scoped check automatically before launch.

A detection fixture can exercise tracking and payload construction without OpenCV or YOLO:

```bash
python3 -m camera_agent.edge_agent \
  --config camera_agent/config.example.json \
  --camera north-gate \
  --simulate /path/to/detection-fixture.json
```

Add `--post` only against an explicitly configured test source. Simulation posts use the same signed API route as live inference and can trigger incidents.

## Start And Arm

Install `camera_agent/systemd/sandfest-camera@.service` as `/etc/systemd/system/sandfest-camera@.service`, then create the service account and writable model directory:

```bash
sudo useradd --system --home /var/lib/sandfest-camera --shell /usr/sbin/nologin sandfest-camera
sudo install -d -o sandfest-camera -g sandfest-camera -m 0750 /var/lib/sandfest-camera
sudo systemctl daemon-reload
sudo systemctl enable --now sandfest-camera@north-gate
sudo journalctl -u sandfest-camera@north-gate -f
```

Install and observe one camera at a time. In the admin Island Conditions workspace, set its exact `sourceId`, mark it configured, choose the stale threshold, and then enable **Arm monitoring**. The API rejects observations and heartbeats while monitoring is unarmed. Arming says operators now expect a live pipeline; it is not merely a saved configuration checkbox.

A healthy startup sends a `starting` heartbeat, then aggregate observations every 5-30 seconds and a heartbeat at least once per minute. The example uses 10-second observations and 30-second heartbeats. Confirm in admin that the heartbeat is fresh, health is healthy, source ID matches, observations advance, and public values become unknown after the stale threshold.

Repeat for all eight IDs only after the previous source is stable:

```text
ferry-loading
ferry-stacking
harbor-island-entrance
harbor-island-stacking
north-gate
south-gate
food-court
competition-corridor
```

## Event Operations

- Staff Incident Command whenever monitoring is armed. Automated escalation can open or update an incident, but cannot acknowledge, publish, dispatch, or resolve on its own.
- Watch decoder failures, dropped-frame percentage, inference latency, heartbeat freshness, clock drift, CPU/GPU temperature, and process restarts.
- Keep observations at 5-30 second aggregates. Increasing frame rate can add compute without improving operational accuracy.
- Treat `unknown` as unavailable data. Never carry an old estimate forward after the stale threshold.
- For a false alert, disarm the source before changing calibration. Preserve the incident and audit trail.
- During camera or network maintenance, disarm that source so an expected outage is not presented as an active monitored failure.

## Recovery And Rotation

The process reconnects to failed opens and failed reads with bounded exponential backoff. Error heartbeats are rate-bounded to the configured heartbeat interval, so a broken stream cannot hot-loop or flood the API. Signed delivery retries retain stable observation IDs and remain idempotent. A restart loses only in-memory tracks; it does not duplicate an already accepted observation window.

For credential rotation, add a second key ID for one camera in the API, deploy the new key ID and secret to that host, restart the service, prove fresh health, and then remove the old key. Revoke only the affected camera after a suspected disclosure.

If model accuracy, stream health, or timing cannot be trusted, disarm monitoring and use reviewed operator conditions. Do not describe a configured or synthetic source as operationally live until a real camera, local inference process, signed API delivery, admin freshness, and public stale behavior have all been observed end to end.
