#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Mapping
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from camera_agent.edge_agent import (  # noqa: E402
    MetricsClient,
    build_heartbeat,
    load_config,
    selected_camera,
    simulate,
)


def request_json(
    api_base: str,
    path: str,
    *,
    method: str = "GET",
    token: str = "",
    body: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    raw = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    headers = {"Accept": "application/json"}
    if raw is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        f"{api_base.rstrip('/')}{path}", data=raw, headers=headers, method=method
    )
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode())


def require(value: Any, message: str) -> None:
    if not value:
        raise RuntimeError(message)


def main() -> int:
    api_base = os.environ.get("SANDFEST_API_BASE", "http://127.0.0.1:8806").rstrip("/")
    parsed = urlparse(api_base)
    is_local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    allow_remote = os.environ.get("SANDFEST_CAMERA_LIVE_TEST_ALLOW_REMOTE") == "true"
    require(
        is_local or allow_remote,
        "Refusing to mutate a remote API without SANDFEST_CAMERA_LIVE_TEST_ALLOW_REMOTE=true.",
    )

    admin_token = os.environ.get("SANDFEST_ADMIN_API_TOKEN", "")
    ingest_secret = os.environ.get("CAMERA_INGEST_SECRET", "")
    require(admin_token, "SANDFEST_ADMIN_API_TOKEN is required.")
    require(
        len(ingest_secret) >= 32,
        "CAMERA_INGEST_SECRET must contain at least 32 characters.",
    )

    config = load_config(ROOT / "camera_agent" / "config.example.json")
    camera = dict(selected_camera(config, "north-gate"))
    camera["keyId"] = ""
    now = time.time()

    configured = request_json(
        api_base,
        "/api/admin/island-conditions/cameras/north-gate",
        method="PATCH",
        token=admin_token,
        body={
            "sourceId": camera["sourceId"],
            "status": "configured",
            "monitoringEnabled": True,
            "staleAfterMinutes": 5,
        },
    )
    require(
        configured.get("camera", {}).get("monitoringEnabled") is True,
        "North gate did not arm.",
    )

    client = MetricsClient(api_base, key_id="", secret=ingest_secret, retries=1)
    heartbeat = build_heartbeat(
        camera,
        observed_epoch=now,
        status="healthy",
        agent_id="edge-integration-check",
        frames_per_second=3.0,
        inference_latency_ms=42,
        dropped_frame_pct=0.0,
        uptime_seconds=30,
        model_name="yolo11n.pt",
        model_version="yolo11n-coco",
        heartbeat_interval_seconds=30,
    )
    heartbeat_result = client.post("north-gate", "heartbeat", heartbeat)

    fixture = {
        "startEpoch": now,
        "frames": [
            {
                "offsetSeconds": 0,
                "processingMs": 39,
                "detections": [
                    {
                        "trackId": "anonymous-1",
                        "classId": 0,
                        "confidence": 0.91,
                        "box": [0.2, 0.45, 0.3, 0.8],
                    },
                    {
                        "trackId": "anonymous-2",
                        "classId": 0,
                        "confidence": 0.88,
                        "box": [0.35, 0.45, 0.45, 0.8],
                    },
                ],
            },
            {
                "offsetSeconds": 1,
                "processingMs": 42,
                "detections": [
                    {
                        "trackId": "anonymous-1",
                        "classId": 0,
                        "confidence": 0.92,
                        "box": [0.65, 0.45, 0.75, 0.8],
                    },
                    {
                        "trackId": "anonymous-2",
                        "classId": 0,
                        "confidence": 0.89,
                        "box": [0.35, 0.45, 0.45, 0.8],
                    },
                ],
            },
        ],
    }
    observation = simulate(config, camera, fixture)
    observation_result = client.post("north-gate", "observations", observation)

    admin = request_json(api_base, "/api/admin/island-conditions", token=admin_token)
    admin_camera = next(
        item for item in admin.get("cameras", []) if item.get("id") == "north-gate"
    )
    public = request_json(api_base, "/api/public/island-conditions")
    public_camera = next(
        item for item in public.get("cameras", []) if item.get("id") == "north-gate"
    )

    require(
        admin_camera.get("operationalStatus") == "live",
        "Admin camera did not become operationally live.",
    )
    require(
        admin_camera.get("health", {}).get("status") == "healthy",
        "Admin heartbeat is not healthy.",
    )
    require(
        admin_camera.get("observation", {}).get("eventId")
        == observation["eventId"].lower(),
        "Admin observation does not match the canonical edge event ID.",
    )
    require(
        public_camera.get("freshness", {}).get("state") == "live",
        "Public camera did not become fresh.",
    )
    require(
        public_camera.get("observation", {}).get("peopleCount")
        == observation["peopleCount"],
        "Public count does not match the edge payload.",
    )
    require("sourceId" not in public_camera, "Public camera exposed sourceId.")
    require("health" not in public_camera, "Public camera exposed pipeline health.")
    require(
        "modelName" not in public_camera.get("observation", {}),
        "Public observation exposed model metadata.",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "cameraId": "north-gate",
                "heartbeatId": heartbeat["heartbeatId"],
                "heartbeatDuplicate": heartbeat_result.get("duplicate", False),
                "observationId": observation["eventId"],
                "observationDuplicate": observation_result.get("duplicate", False),
                "adminOperationalStatus": admin_camera["operationalStatus"],
                "adminHealth": admin_camera["health"]["status"],
                "publicFreshness": public_camera["freshness"]["state"],
                "publicPeopleCount": public_camera["observation"]["peopleCount"],
                "publicFlowPerMinute": public_camera["observation"]["flowPerMinute"],
                "publicPrivacy": "source, health, and model metadata omitted",
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"camera edge live test failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
