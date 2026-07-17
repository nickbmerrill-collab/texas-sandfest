#!/usr/bin/env python3
"""Convert one local camera stream into anonymous SandFest operations metrics."""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
import math
import os
from pathlib import Path
import platform
import re
import signal
import statistics
import sys
import time
from typing import Any, Iterable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


AGENT_VERSION = "2026.07.1"
DEFAULT_MODEL_NAME = "yolo11n.pt"
PERSON_CLASS_ID = 0
VEHICLE_CLASS_IDS = {2, 3, 5, 7}
TRACKED_CLASS_IDS = {PERSON_CLASS_ID, *VEHICLE_CLASS_IDS}
SUPPORTED_CAMERA_KINDS = {"traffic", "queue", "crowd", "line"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
ENV_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")
PLACEHOLDER_PATTERN = re.compile(
    r"^(?:pending|unknown|unreviewed|none|n/a|replace(?:-with)?|todo)", re.I
)
DEFAULT_ROI = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
LOG = logging.getLogger("sandfest-camera-agent")


class AgentConfigurationError(ValueError):
    """Raised when local camera configuration is unsafe or incomplete."""


class DeliveryError(RuntimeError):
    """Raised when a signed metric cannot be delivered."""


class PermanentDeliveryError(DeliveryError):
    """Raised when a request is rejected and retrying cannot help."""


@dataclass(frozen=True)
class Detection:
    track_id: str
    class_id: int
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def centroid(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    @classmethod
    def from_dict(
        cls, value: Mapping[str, Any], fallback_id: str = "untracked"
    ) -> "Detection":
        box = value.get("box") or [
            value.get("x1"),
            value.get("y1"),
            value.get("x2"),
            value.get("y2"),
        ]
        if not isinstance(box, Sequence) or len(box) != 4:
            raise AgentConfigurationError(
                "Each simulated detection requires a four-value normalized box."
            )
        coords = [max(0.0, min(1.0, float(item))) for item in box]
        return cls(
            track_id=str(value.get("trackId") or fallback_id),
            class_id=int(value.get("classId", PERSON_CLASS_ID)),
            confidence=max(0.0, min(1.0, float(value.get("confidence", 1.0)))),
            x1=min(coords[0], coords[2]),
            y1=min(coords[1], coords[3]),
            x2=max(coords[0], coords[2]),
            y2=max(coords[1], coords[3]),
        )


@dataclass(frozen=True)
class FrameMetrics:
    people_count: int
    vehicle_count: int
    queue_length: int
    occupancy_pct: float
    estimated_wait_minutes: float
    confidence: float
    processing_ms: int


def utc_iso(epoch_seconds: float | None = None) -> str:
    value = datetime.fromtimestamp(
        epoch_seconds if epoch_seconds is not None else time.time(), tz=timezone.utc
    )
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def point_in_polygon(
    point: tuple[float, float], polygon: Sequence[Sequence[float]]
) -> bool:
    """Return whether a normalized point is inside a polygon."""
    x, y = point
    inside = False
    count = len(polygon)
    if count < 3:
        return False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = float(previous[0]), float(previous[1])
        x2, y2 = float(current[0]), float(current[1])
        intersects = (y1 > y) != (y2 > y)
        if intersects:
            crossing_x = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def line_side(point: tuple[float, float], line: Sequence[Sequence[float]]) -> int:
    if len(line) != 2:
        return 0
    (x1, y1), (x2, y2) = line
    cross = (float(x2) - float(x1)) * (point[1] - float(y1)) - (
        float(y2) - float(y1)
    ) * (point[0] - float(x1))
    return 1 if cross > 1e-6 else -1 if cross < -1e-6 else 0


class FlowCounter:
    """Count anonymous tracked-object crossings in a sliding one-minute window."""

    def __init__(
        self,
        line: Sequence[Sequence[float]],
        class_ids: Iterable[int] = TRACKED_CLASS_IDS,
    ):
        self.line = tuple(tuple(float(value) for value in point) for point in line)
        self.class_ids = {int(value) for value in class_ids}
        self.history: dict[str, tuple[int, float]] = {}
        self.crossings: deque[tuple[float, str]] = deque()
        self.last_crossing: dict[str, float] = {}

    def update(self, detections: Sequence[Detection], now: float) -> int:
        self._prune(now)
        for detection in detections:
            if detection.class_id not in self.class_ids or not detection.track_id:
                continue
            side = line_side(detection.centroid, self.line)
            previous = self.history.get(detection.track_id)
            if previous and previous[0] and side and previous[0] != side:
                last = self.last_crossing.get(detection.track_id, -math.inf)
                if now - last >= 60:
                    self.crossings.append((now, detection.track_id))
                    self.last_crossing[detection.track_id] = now
            if side:
                self.history[detection.track_id] = (side, now)
        return len(self.crossings)

    def per_minute(self, now: float) -> float:
        self._prune(now)
        return float(len(self.crossings))

    def _prune(self, now: float) -> None:
        while self.crossings and now - self.crossings[0][0] > 60:
            self.crossings.popleft()
        for track_id, (_, seen_at) in list(self.history.items()):
            if now - seen_at > 600:
                self.history.pop(track_id, None)
                self.last_crossing.pop(track_id, None)


def _polygon(
    camera: Mapping[str, Any],
    key: str,
    fallback: Sequence[Sequence[float]] = DEFAULT_ROI,
) -> Sequence[Sequence[float]]:
    value = camera.get(key)
    return value if isinstance(value, Sequence) and len(value) >= 3 else fallback


def _class_ids(
    camera: Mapping[str, Any], key: str, fallback: Iterable[int]
) -> set[int]:
    value = camera.get(key)
    return (
        {int(item) for item in value}
        if isinstance(value, Sequence) and value
        else {int(item) for item in fallback}
    )


def _round_nonnegative(value: float, digits: int = 2) -> float:
    multiplier = 10**digits
    return math.floor(max(0.0, value) * multiplier + 0.5) / multiplier


def derive_frame_metrics(
    camera: Mapping[str, Any],
    detections: Sequence[Detection],
    *,
    flow_per_minute: float,
    processing_ms: int,
) -> FrameMetrics:
    roi = _polygon(camera, "roiNormalized")
    queue_roi = _polygon(camera, "queueRoiNormalized", roi)
    active = [item for item in detections if point_in_polygon(item.centroid, roi)]
    people = [item for item in active if item.class_id == PERSON_CLASS_ID]
    vehicles = [item for item in active if item.class_id in VEHICLE_CLASS_IDS]
    kind = str(camera.get("kind") or "crowd").lower()
    occupancy_classes = _class_ids(
        camera,
        "occupancyClassIds",
        VEHICLE_CLASS_IDS if kind in {"traffic", "queue"} else {PERSON_CLASS_ID},
    )
    queue_classes = _class_ids(camera, "queueClassIds", occupancy_classes)
    occupancy_count = sum(1 for item in active if item.class_id in occupancy_classes)
    queue_count = sum(
        1
        for item in detections
        if item.class_id in queue_classes and point_in_polygon(item.centroid, queue_roi)
    )
    capacity = max(1, int(camera.get("capacity") or 100))
    occupancy_pct = min(100.0, occupancy_count / capacity * 100)
    service_floor = max(0.1, float(camera.get("minimumServiceRatePerMinute") or 1.0))
    effective_service = max(service_floor, float(flow_per_minute))
    wait_minutes = min(600.0, queue_count / effective_service) if queue_count else 0.0
    confidence = statistics.fmean(item.confidence for item in active) if active else 0.0
    return FrameMetrics(
        people_count=len(people),
        vehicle_count=len(vehicles),
        queue_length=queue_count,
        occupancy_pct=round(occupancy_pct, 2),
        estimated_wait_minutes=_round_nonnegative(wait_minutes),
        confidence=round(confidence, 4),
        processing_ms=max(0, int(processing_ms)),
    )


def _percentile(values: Sequence[int], percentile: float) -> int:
    ordered = sorted(int(value) for value in values)
    if not ordered:
        return 0
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentile)))
    return ordered[index]


class MetricAggregator:
    def __init__(self) -> None:
        self.samples: list[FrameMetrics] = []

    def add(self, sample: FrameMetrics) -> None:
        self.samples.append(sample)

    def flush(self, flow_per_minute: float) -> dict[str, int | float] | None:
        if not self.samples:
            return None
        samples, self.samples = self.samples, []
        return {
            "peopleCount": round(
                statistics.median(item.people_count for item in samples)
            ),
            "vehicleCount": round(
                statistics.median(item.vehicle_count for item in samples)
            ),
            "flowPerMinute": round(max(0.0, flow_per_minute), 2),
            "queueLength": _percentile([item.queue_length for item in samples], 0.75),
            "occupancyPct": round(
                statistics.median(item.occupancy_pct for item in samples), 2
            ),
            "estimatedWaitMinutes": round(
                statistics.median(item.estimated_wait_minutes for item in samples), 2
            ),
            "confidence": round(
                statistics.fmean(item.confidence for item in samples), 4
            ),
            "processingMs": round(
                statistics.median(item.processing_ms for item in samples)
            ),
        }


def stable_window_id(
    camera_id: str,
    epoch_seconds: float,
    interval_seconds: int,
    kind: str = "observation",
) -> str:
    window = math.floor(epoch_seconds / interval_seconds) * interval_seconds
    stamp = datetime.fromtimestamp(window, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = "hb" if kind == "heartbeat" else "obs"
    return f"{camera_id}-{suffix}-{stamp}"


def build_observation(
    camera: Mapping[str, Any],
    metrics: Mapping[str, int | float],
    *,
    observed_epoch: float,
    model_name: str,
    model_version: str,
    interval_seconds: int,
    model_sha256: str = "",
) -> dict[str, Any]:
    camera_id = str(camera["cameraId"])
    return {
        "eventId": stable_window_id(camera_id, observed_epoch, interval_seconds),
        "sourceId": str(camera["sourceId"]),
        "observedAt": utc_iso(observed_epoch),
        **metrics,
        "modelName": model_name[:100],
        "modelVersion": model_version[:100],
        "modelSha256": model_sha256[:64],
    }


def build_heartbeat(
    camera: Mapping[str, Any],
    *,
    observed_epoch: float,
    status: str,
    agent_id: str,
    frames_per_second: float,
    inference_latency_ms: int | None,
    dropped_frame_pct: float,
    uptime_seconds: int,
    model_name: str,
    model_version: str,
    heartbeat_interval_seconds: int,
    model_sha256: str = "",
    last_error: str | None = None,
) -> dict[str, Any]:
    payload = {
        "heartbeatId": stable_window_id(
            str(camera["cameraId"]),
            observed_epoch,
            heartbeat_interval_seconds,
            "heartbeat",
        ),
        "sourceId": str(camera["sourceId"]),
        "observedAt": utc_iso(observed_epoch),
        "status": status,
        "agentId": agent_id[:100],
        "framesPerSecond": round(max(0.0, frames_per_second), 2),
        "inferenceLatencyMs": None
        if inference_latency_ms is None
        else max(0, int(inference_latency_ms)),
        "droppedFramePct": round(max(0.0, min(100.0, dropped_frame_pct)), 2),
        "uptimeSeconds": max(0, int(uptime_seconds)),
        "agentVersion": AGENT_VERSION,
        "modelName": model_name[:100],
        "modelVersion": model_version[:100],
        "modelSha256": model_sha256[:64],
    }
    if last_error:
        payload["lastError"] = str(last_error)[:500]
    return payload


def sign_payload(raw_body: bytes, timestamp: str, secret: str, key_id: str = "") -> str:
    if key_id:
        canonical = (
            b"camera:v1:"
            + key_id.encode()
            + b":"
            + timestamp.encode()
            + b":"
            + raw_body
        )
    else:
        canonical = timestamp.encode() + b"." + raw_body
    return hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()


class MetricsClient:
    def __init__(
        self,
        api_base: str,
        *,
        key_id: str,
        secret: str,
        timeout_seconds: float = 10,
        retries: int = 3,
    ) -> None:
        parsed = urlparse(api_base)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise AgentConfigurationError(
                "apiBase must be an absolute HTTP or HTTPS URL."
            )
        if len(secret) < 32:
            raise AgentConfigurationError(
                "Camera ingest secret must contain at least 32 characters."
            )
        self.api_base = api_base.rstrip("/")
        self.key_id = key_id
        self.secret = secret
        self.timeout_seconds = max(1.0, float(timeout_seconds))
        self.retries = max(1, int(retries))

    def prepare(
        self,
        camera_id: str,
        endpoint: str,
        payload: Mapping[str, Any],
        timestamp: str | None = None,
    ) -> tuple[str, bytes, dict[str, str]]:
        raw_body = json.dumps(
            payload, separators=(",", ":"), ensure_ascii=True
        ).encode()
        signed_at = timestamp or str(math.floor(time.time()))
        signature = sign_payload(raw_body, signed_at, self.secret, self.key_id)
        url = f"{self.api_base}/api/ingest/cameras/{camera_id}/{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "X-SandFest-Timestamp": signed_at,
            "X-SandFest-Signature": f"sha256={signature}",
            "User-Agent": f"sandfest-camera-agent/{AGENT_VERSION}",
        }
        if self.key_id:
            headers["X-SandFest-Camera-Key-Id"] = self.key_id
        return url, raw_body, headers

    def post(
        self, camera_id: str, endpoint: str, payload: Mapping[str, Any]
    ) -> dict[str, Any]:
        url, raw_body, headers = self.prepare(camera_id, endpoint, payload)
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            request = Request(url, data=raw_body, headers=headers, method="POST")
            try:
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    content = response.read().decode()
                    return json.loads(content) if content else {"ok": True}
            except HTTPError as error:
                content = error.read().decode(errors="replace")[:1000]
                if error.code < 500 and error.code != 429:
                    raise PermanentDeliveryError(
                        f"Camera ingest rejected with HTTP {error.code}: {content}"
                    ) from error
                last_error = DeliveryError(
                    f"Camera ingest returned HTTP {error.code}: {content}"
                )
            except (URLError, TimeoutError, OSError) as error:
                last_error = DeliveryError(f"Camera ingest connection failed: {error}")
            if attempt < self.retries:
                time.sleep(min(4.0, 0.5 * (2 ** (attempt - 1))))
        raise last_error or DeliveryError("Camera ingest failed without a response.")


def _normalized_polygon(value: Any, label: str) -> list[list[float]]:
    if not isinstance(value, list) or len(value) < 3:
        raise AgentConfigurationError(
            f"{label} must contain at least three normalized points."
        )
    output = []
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            raise AgentConfigurationError(f"{label} points must be [x, y] pairs.")
        try:
            x, y = float(point[0]), float(point[1])
        except (TypeError, ValueError) as error:
            raise AgentConfigurationError(
                f"{label} coordinates must be numbers."
            ) from error
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise AgentConfigurationError(
                f"{label} coordinates must be between 0 and 1."
            )
        output.append([x, y])
    return output


def _normalized_line(value: Any, label: str) -> list[list[float]]:
    if not isinstance(value, list) or len(value) != 2:
        raise AgentConfigurationError(
            f"{label} must contain exactly two normalized points."
        )
    output = []
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            raise AgentConfigurationError(f"{label} points must be [x, y] pairs.")
        try:
            x, y = float(point[0]), float(point[1])
        except (TypeError, ValueError) as error:
            raise AgentConfigurationError(
                f"{label} coordinates must be numbers."
            ) from error
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise AgentConfigurationError(
                f"{label} coordinates must be between 0 and 1."
            )
        output.append([x, y])
    if output[0] == output[1]:
        raise AgentConfigurationError(f"{label} points must be different.")
    return output


def validate_model_approval(
    model_config: Mapping[str, Any],
    *,
    required: bool = False,
    now_epoch: float | None = None,
) -> dict[str, str]:
    approval = model_config.get("approval") or {}
    if not isinstance(approval, Mapping):
        raise AgentConfigurationError("Camera model approval must be an object.")
    status = str(approval.get("status") or "pending").strip().lower()
    if not required and status != "approved":
        return {"status": status}
    errors: list[str] = []
    if status != "approved":
        errors.append("status must be approved")
    values = {
        "licenseReference": str(approval.get("licenseReference") or "").strip(),
        "approvedBy": str(approval.get("approvedBy") or "").strip(),
        "approvedAt": str(approval.get("approvedAt") or "").strip(),
        "decisionReference": str(approval.get("decisionReference") or "").strip(),
    }
    for key in ("licenseReference", "approvedBy", "decisionReference"):
        if not values[key] or PLACEHOLDER_PATTERN.match(values[key]):
            errors.append(f"{key} must contain the reviewed production value")
    approved_at: datetime | None = None
    try:
        approved_at = datetime.fromisoformat(values["approvedAt"].replace("Z", "+00:00"))
        if approved_at.tzinfo is None:
            raise ValueError("timezone missing")
    except ValueError:
        errors.append("approvedAt must be an ISO-8601 timestamp with a timezone")
    if approved_at is not None:
        reference_now = now_epoch if now_epoch is not None else time.time()
        if approved_at.timestamp() > reference_now + 300:
            errors.append("approvedAt cannot be in the future")
    model_sha256 = str(model_config.get("sha256") or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", model_sha256):
        errors.append("the approved model requires a 64-character sha256")
    if errors:
        raise AgentConfigurationError(
            "Camera model production approval is incomplete: " + "; ".join(errors) + "."
        )
    return {"status": status, **values}


def validate_config(
    config: Mapping[str, Any],
    *,
    require_runtime: bool = False,
    require_production_approval: bool = False,
    runtime_camera_id: str | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    if not isinstance(config, Mapping):
        raise AgentConfigurationError("Camera agent config must be a JSON object.")
    environment = os.environ if env is None else env
    agent_config = config.get("agent") or {}
    model_config = config.get("model") or {}
    if not isinstance(agent_config, Mapping):
        raise AgentConfigurationError("Camera agent settings must be an object.")
    if not isinstance(model_config, Mapping):
        raise AgentConfigurationError("Camera model settings must be an object.")
    model_sha256 = str(model_config.get("sha256") or "").lower()
    if model_sha256 and not re.fullmatch(r"[a-f0-9]{64}", model_sha256):
        raise AgentConfigurationError(
            "Camera model sha256 must be 64 lowercase hexadecimal characters."
        )
    validate_model_approval(
        model_config, required=require_production_approval
    )
    cameras = config.get("cameras")
    if not isinstance(cameras, list) or not cameras:
        raise AgentConfigurationError(
            "Camera agent config requires at least one camera."
        )
    normalized = {**config, "cameras": []}
    seen_camera_ids: set[str] = set()
    seen_source_ids: set[str] = set()
    for index, raw_camera in enumerate(cameras):
        if not isinstance(raw_camera, Mapping):
            raise AgentConfigurationError(f"Camera #{index + 1} must be an object.")
        camera = dict(raw_camera)
        camera_id = str(camera.get("cameraId") or "").strip()
        source_id = str(camera.get("sourceId") or "").strip()
        key_id = str(camera.get("keyId") or "").strip()
        kind = str(camera.get("kind") or "").strip().lower()
        if not ID_PATTERN.fullmatch(camera_id):
            raise AgentConfigurationError(
                f"Camera #{index + 1} requires a safe cameraId."
            )
        if not ID_PATTERN.fullmatch(source_id):
            raise AgentConfigurationError(
                f"Camera {camera_id} requires a safe sourceId."
            )
        if key_id and not ID_PATTERN.fullmatch(key_id):
            raise AgentConfigurationError(f"Camera {camera_id} keyId is invalid.")
        if kind not in SUPPORTED_CAMERA_KINDS:
            raise AgentConfigurationError(
                f"Camera {camera_id} kind must be traffic, queue, crowd, or line."
            )
        if not isinstance(camera.get("enabled", True), bool):
            raise AgentConfigurationError(
                f"Camera {camera_id} enabled must be true or false."
            )
        if camera_id in seen_camera_ids or source_id in seen_source_ids:
            raise AgentConfigurationError("Camera IDs and source IDs must be unique.")
        seen_camera_ids.add(camera_id)
        seen_source_ids.add(source_id)
        if "secret" in camera:
            raise AgentConfigurationError(
                f"Camera {camera_id} must reference secretEnv instead of storing a secret."
            )
        secret_env = str(camera.get("secretEnv") or "").strip()
        stream_env = str(camera.get("streamEnv") or "").strip()
        if not ENV_PATTERN.fullmatch(secret_env):
            raise AgentConfigurationError(
                f"Camera {camera_id} requires a safe secretEnv name."
            )
        if stream_env and not ENV_PATTERN.fullmatch(stream_env):
            raise AgentConfigurationError(f"Camera {camera_id} streamEnv is invalid.")
        source = camera.get("source")
        if source is not None and (
            isinstance(source, bool) or not isinstance(source, (str, int))
        ):
            raise AgentConfigurationError(
                f"Camera {camera_id} source must be a stream string or capture-device number."
            )
        if isinstance(source, int) and source < 0:
            raise AgentConfigurationError(
                f"Camera {camera_id} capture-device number cannot be negative."
            )
        if isinstance(source, str):
            parsed_source = urlparse(source)
            if parsed_source.username or parsed_source.password or "@" in source:
                raise AgentConfigurationError(
                    f"Camera {camera_id} stream credentials must come from streamEnv."
                )
        if not stream_env and (source is None or source == ""):
            raise AgentConfigurationError(
                f"Camera {camera_id} requires streamEnv or a credential-free source."
            )
        camera["roiNormalized"] = _normalized_polygon(
            camera.get("roiNormalized", [list(item) for item in DEFAULT_ROI]),
            f"{camera_id}.roiNormalized",
        )
        camera["queueRoiNormalized"] = _normalized_polygon(
            camera.get("queueRoiNormalized", camera["roiNormalized"]),
            f"{camera_id}.queueRoiNormalized",
        )
        camera["countingLineNormalized"] = _normalized_line(
            camera.get("countingLineNormalized"), f"{camera_id}.countingLineNormalized"
        )
        try:
            capacity = int(camera.get("capacity") or 0)
            service_floor = float(camera.get("minimumServiceRatePerMinute") or 0)
        except (TypeError, ValueError) as error:
            raise AgentConfigurationError(
                f"Camera {camera_id} capacity and service rate must be numbers."
            ) from error
        if capacity < 1 or capacity > 100_000:
            raise AgentConfigurationError(
                f"Camera {camera_id} capacity must be between 1 and 100000."
            )
        if (
            not math.isfinite(service_floor)
            or service_floor <= 0
            or service_floor > 100_000
        ):
            raise AgentConfigurationError(
                f"Camera {camera_id} minimumServiceRatePerMinute must be between 0 and 100000."
            )
        for key in ("queueClassIds", "occupancyClassIds", "flowClassIds"):
            values = camera.get(key)
            if values is None:
                continue
            if not isinstance(values, list) or not values:
                raise AgentConfigurationError(
                    f"Camera {camera_id} {key} must be a non-empty list."
                )
            try:
                class_ids = [int(value) for value in values]
            except (TypeError, ValueError) as error:
                raise AgentConfigurationError(
                    f"Camera {camera_id} {key} must contain numeric model classes."
                ) from error
            if any(value not in TRACKED_CLASS_IDS for value in class_ids):
                raise AgentConfigurationError(
                    f"Camera {camera_id} {key} contains an unsupported model class."
                )
            camera[key] = class_ids
        camera["kind"] = kind
        camera["capacity"] = capacity
        camera["minimumServiceRatePerMinute"] = service_floor
        if (
            require_runtime
            and camera.get("enabled", True)
            and (runtime_camera_id is None or camera_id == runtime_camera_id)
        ):
            secret = str(environment.get(secret_env) or "")
            stream = environment.get(stream_env) if stream_env else source
            if len(secret) < 32:
                raise AgentConfigurationError(
                    f"{secret_env} must contain at least 32 characters."
                )
            if stream is None or stream == "":
                raise AgentConfigurationError(
                    f"{stream_env or 'source'} is required for camera {camera_id}."
                )
        normalized["cameras"].append(camera)
    if runtime_camera_id is not None:
        selected = next(
            (camera for camera in normalized["cameras"] if camera["cameraId"] == runtime_camera_id),
            None,
        )
        if selected is None:
            raise AgentConfigurationError(
                f"Camera {runtime_camera_id} is not present in the config."
            )
        if selected.get("enabled", True) is not True:
            raise AgentConfigurationError(
                f"Camera {runtime_camera_id} is disabled in the config."
            )
    return normalized


def load_config(
    path_value: str | Path,
    *,
    require_runtime: bool = False,
    require_production_approval: bool = False,
    runtime_camera_id: str | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    path = Path(path_value)
    try:
        config = json.loads(path.read_text())
    except FileNotFoundError as error:
        raise AgentConfigurationError(f"Camera config not found: {path}") from error
    except json.JSONDecodeError as error:
        raise AgentConfigurationError(
            f"Camera config is not valid JSON: {error}"
        ) from error
    return validate_config(
        config,
        require_runtime=require_runtime,
        require_production_approval=require_production_approval,
        runtime_camera_id=runtime_camera_id,
        env=env,
    )


def verify_model_file(
    model_config: Mapping[str, Any], model_dir: str | Path = "."
) -> dict[str, Any]:
    model_name = str(model_config.get("name") or DEFAULT_MODEL_NAME)
    expected_sha256 = str(model_config.get("sha256") or "").lower()
    if not expected_sha256:
        raise AgentConfigurationError(
            "Camera model verification requires an approved sha256."
        )
    path = Path(model_name).expanduser()
    if not path.is_absolute():
        path = Path(model_dir).expanduser() / path
    if not path.is_file():
        raise AgentConfigurationError(
            f"Approved camera model is not cached at {path}."
        )
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    actual_sha256 = digest.hexdigest()
    if not hmac.compare_digest(actual_sha256, expected_sha256):
        raise AgentConfigurationError(
            f"Model checksum does not match the approved sha256 for {path.name}."
        )
    return {
        "ok": True,
        "model": path.name,
        "path": str(path.resolve()),
        "bytes": path.stat().st_size,
        "sha256": actual_sha256,
    }


def resolve_inference_device(configured: Any, torch_module: Any) -> str:
    requested = str(configured or "auto").strip().lower()
    if requested != "auto":
        return requested
    if torch_module.cuda.is_available():
        return "0"
    if torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def selected_camera(config: Mapping[str, Any], camera_id: str) -> dict[str, Any]:
    camera = next(
        (item for item in config["cameras"] if item["cameraId"] == camera_id), None
    )
    if not camera:
        raise AgentConfigurationError(
            f"Camera {camera_id} is not present in the config."
        )
    if camera.get("enabled", True) is not True:
        raise AgentConfigurationError(f"Camera {camera_id} is disabled in the config.")
    return camera


def resolve_runtime(
    config: Mapping[str, Any],
    camera: Mapping[str, Any],
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    environment = os.environ if env is None else env
    stream_env = str(camera.get("streamEnv") or "")
    source = environment.get(stream_env) if stream_env else camera.get("source")
    if isinstance(source, str) and source.isdigit():
        source = int(source)
    secret = str(environment.get(str(camera["secretEnv"])) or "")
    api_base = str(
        environment.get("SANDFEST_API_BASE") or config.get("apiBase") or ""
    ).strip()
    if source is None or source == "":
        raise AgentConfigurationError(
            f"No stream source is configured for {camera['cameraId']}."
        )
    if len(secret) < 32:
        raise AgentConfigurationError(
            f"{camera['secretEnv']} must contain at least 32 characters."
        )
    return {"source": source, "secret": secret, "apiBase": api_base}


def simulate(
    config: Mapping[str, Any], camera: Mapping[str, Any], fixture: Mapping[str, Any]
) -> dict[str, Any]:
    frames = fixture.get("frames")
    if not isinstance(frames, list) or not frames:
        raise AgentConfigurationError(
            "Simulation fixture requires a non-empty frames array."
        )
    start_epoch = float(fixture.get("startEpoch") or time.time())
    model = config.get("model") or {}
    flow = FlowCounter(
        camera["countingLineNormalized"],
        _class_ids(camera, "flowClassIds", TRACKED_CLASS_IDS),
    )
    aggregator = MetricAggregator()
    for frame_index, frame in enumerate(frames):
        if not isinstance(frame, Mapping):
            raise AgentConfigurationError("Simulation frames must be objects.")
        frame_time = start_epoch + float(frame.get("offsetSeconds", frame_index))
        detections = [
            Detection.from_dict(value, f"frame-{frame_index}-{index}")
            for index, value in enumerate(frame.get("detections") or [])
        ]
        flow_rate = flow.update(detections, frame_time)
        aggregator.add(
            derive_frame_metrics(
                camera,
                detections,
                flow_per_minute=flow_rate,
                processing_ms=int(frame.get("processingMs") or 0),
            )
        )
    observed_epoch = start_epoch + float(
        frames[-1].get("offsetSeconds", len(frames) - 1)
    )
    metrics = aggregator.flush(flow.per_minute(observed_epoch))
    if metrics is None:
        raise AgentConfigurationError("Simulation produced no metrics.")
    agent = config.get("agent") or {}
    interval = max(5, int(agent.get("observationIntervalSeconds") or 10))
    model_name = str(model.get("name") or DEFAULT_MODEL_NAME)
    model_version = str(model.get("version") or model_name)
    return build_observation(
        camera,
        metrics,
        observed_epoch=observed_epoch,
        model_name=model_name,
        model_version=model_version,
        interval_seconds=interval,
        model_sha256=str(model.get("sha256") or "").lower(),
    )


class CameraRunner:
    def __init__(
        self,
        config: Mapping[str, Any],
        camera: Mapping[str, Any],
        runtime: Mapping[str, Any],
    ) -> None:
        try:
            import cv2  # type: ignore
            import torch  # type: ignore
            from ultralytics import YOLO  # type: ignore
        except ImportError as error:
            raise AgentConfigurationError(
                "Live inference requires Python 3.10-3.13 and the packages in camera_agent/requirements.txt."
            ) from error
        self.cv2 = cv2
        self.config = config
        self.camera = camera
        self.runtime = runtime
        agent = config.get("agent") or {}
        model_config = config.get("model") or {}
        self.model_name = str(model_config.get("name") or DEFAULT_MODEL_NAME)
        self.model_version = str(model_config.get("version") or self.model_name)
        self.model_sha256 = str(model_config.get("sha256") or "").lower()
        self.device = resolve_inference_device(model_config.get("device"), torch)
        self.confidence = max(
            0.05, min(0.95, float(model_config.get("confidence") or 0.35))
        )
        self.iou = max(0.05, min(0.95, float(model_config.get("iou") or 0.5)))
        self.sample_fps = max(0.2, min(30.0, float(agent.get("sampleFps") or 3)))
        self.observation_interval = max(
            5, int(agent.get("observationIntervalSeconds") or 10)
        )
        self.heartbeat_interval = max(
            10, int(agent.get("heartbeatIntervalSeconds") or 30)
        )
        self.max_inference_latency_ms = max(
            50, int(agent.get("maxInferenceLatencyMs") or 750)
        )
        self.agent_id = str(agent.get("id") or platform.node() or "sandfest-edge")[:100]
        self.client = MetricsClient(
            str(runtime["apiBase"]),
            key_id=str(camera.get("keyId") or ""),
            secret=str(runtime["secret"]),
            timeout_seconds=float(agent.get("requestTimeoutSeconds") or 10),
            retries=int(agent.get("requestRetries") or 3),
        )
        self._verify_model_checksum(required=False)
        self.model = YOLO(self.model_name)
        self._verify_model_checksum(required=bool(self.model_sha256))
        self.flow = FlowCounter(
            camera["countingLineNormalized"],
            _class_ids(camera, "flowClassIds", TRACKED_CLASS_IDS),
        )
        self.aggregator = MetricAggregator()
        self.stop_requested = False
        self.started_at = time.time()
        self.frames_read = 0
        self.frames_dropped = 0
        self.frames_processed = 0
        self.last_inference_ms: int | None = None
        self.last_error: str | None = None
        self.next_error_heartbeat = 0.0

    def _verify_model_checksum(self, *, required: bool) -> None:
        if not self.model_sha256:
            return
        path = Path(self.model_name).expanduser()
        if not path.is_file():
            if required:
                raise AgentConfigurationError(f"Model file was not created at {path}.")
            return
        digest = hashlib.sha256()
        with path.open("rb") as model_file:
            for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
                digest.update(chunk)
        if not hmac.compare_digest(digest.hexdigest(), self.model_sha256):
            raise AgentConfigurationError(
                f"Model checksum does not match the approved sha256 for {path.name}."
            )

    def request_stop(self, *_: Any) -> None:
        self.stop_requested = True

    def _heartbeat_status(self) -> str:
        total = self.frames_read + self.frames_dropped
        dropped_pct = self.frames_dropped / total * 100 if total else 0
        if self.last_error:
            return "error"
        if (
            dropped_pct > 5
            or (self.last_inference_ms or 0) > self.max_inference_latency_ms
        ):
            return "degraded"
        return "healthy" if self.frames_processed else "starting"

    def _send_heartbeat(self, status: str | None = None) -> None:
        now = time.time()
        uptime = max(1, int(now - self.started_at))
        total = self.frames_read + self.frames_dropped
        dropped_pct = self.frames_dropped / total * 100 if total else 0
        payload = build_heartbeat(
            self.camera,
            observed_epoch=now,
            status=status or self._heartbeat_status(),
            agent_id=self.agent_id,
            frames_per_second=self.frames_processed / uptime,
            inference_latency_ms=self.last_inference_ms,
            dropped_frame_pct=dropped_pct,
            uptime_seconds=uptime,
            model_name=self.model_name,
            model_version=self.model_version,
            heartbeat_interval_seconds=self.heartbeat_interval,
            model_sha256=self.model_sha256,
            last_error=self.last_error,
        )
        self.client.post(str(self.camera["cameraId"]), "heartbeat", payload)

    def _handle_stream_failure(self, message: str, reconnect_delay: float) -> float:
        self.last_error = message
        LOG.error("Camera %s stream unavailable: %s", self.camera["cameraId"], message)
        monotonic_now = time.monotonic()
        if monotonic_now >= self.next_error_heartbeat:
            try:
                self._send_heartbeat("error")
            except DeliveryError as delivery_error:
                LOG.error("Error heartbeat failed: %s", delivery_error)
            self.next_error_heartbeat = monotonic_now + self.heartbeat_interval
        if not self.stop_requested:
            time.sleep(reconnect_delay)
        return min(30.0, max(1.0, reconnect_delay) * 2)

    def _detections(self, frame: Any) -> list[Detection]:
        started = time.perf_counter()
        options = {
            "persist": True,
            "classes": sorted(TRACKED_CLASS_IDS),
            "conf": self.confidence,
            "iou": self.iou,
            "tracker": "bytetrack.yaml",
            "verbose": False,
        }
        options["device"] = self.device
        result = self.model.track(frame, **options)[0]
        self.last_inference_ms = round((time.perf_counter() - started) * 1000)
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []
        height, width = frame.shape[:2]
        xyxy = boxes.xyxy.cpu().tolist()
        classes = boxes.cls.int().cpu().tolist()
        confidences = boxes.conf.cpu().tolist()
        track_ids = (
            boxes.id.int().cpu().tolist()
            if boxes.id is not None
            else [None] * len(xyxy)
        )
        output = []
        for index, (box, class_id, confidence, track_id) in enumerate(
            zip(xyxy, classes, confidences, track_ids)
        ):
            output.append(
                Detection(
                    track_id=str(track_id) if track_id is not None else "",
                    class_id=int(class_id),
                    confidence=float(confidence),
                    x1=max(0.0, min(1.0, box[0] / width)),
                    y1=max(0.0, min(1.0, box[1] / height)),
                    x2=max(0.0, min(1.0, box[2] / width)),
                    y2=max(0.0, min(1.0, box[3] / height)),
                )
            )
        return output

    def _open_capture(self) -> Any:
        capture = self.cv2.VideoCapture(self.runtime["source"])
        capture.set(self.cv2.CAP_PROP_BUFFERSIZE, 2)
        if not capture.isOpened():
            capture.release()
            raise RuntimeError("Stream could not be opened.")
        return capture

    def run(self) -> None:
        signal.signal(signal.SIGINT, self.request_stop)
        signal.signal(signal.SIGTERM, self.request_stop)
        self._send_heartbeat("starting")
        capture = None
        next_sample = 0.0
        next_observation = time.monotonic() + self.observation_interval
        next_heartbeat = time.monotonic() + self.heartbeat_interval
        reconnect_delay = 1.0
        try:
            while not self.stop_requested:
                if capture is None:
                    try:
                        capture = self._open_capture()
                        LOG.info("Camera %s stream opened.", self.camera["cameraId"])
                    except Exception as error:  # noqa: BLE001
                        reconnect_delay = self._handle_stream_failure(
                            str(error), reconnect_delay
                        )
                        continue
                ok, frame = capture.read()
                if not ok:
                    self.frames_dropped += 1
                    capture.release()
                    capture = None
                    reconnect_delay = self._handle_stream_failure(
                        "Stream read failed; reconnecting.", reconnect_delay
                    )
                    continue
                self.frames_read += 1
                self.last_error = None
                self.next_error_heartbeat = 0.0
                reconnect_delay = 1.0
                monotonic_now = time.monotonic()
                if monotonic_now < next_sample:
                    continue
                next_sample = monotonic_now + 1 / self.sample_fps
                try:
                    detections = self._detections(frame)
                    now = time.time()
                    flow_rate = self.flow.update(detections, now)
                    self.aggregator.add(
                        derive_frame_metrics(
                            self.camera,
                            detections,
                            flow_per_minute=flow_rate,
                            processing_ms=self.last_inference_ms or 0,
                        )
                    )
                    self.frames_processed += 1
                    self.last_error = None
                except Exception as error:  # noqa: BLE001
                    self.last_error = f"Inference failed: {error}"
                    LOG.exception(
                        "Camera %s inference failed.", self.camera["cameraId"]
                    )
                if monotonic_now >= next_observation:
                    observed_epoch = time.time()
                    metrics = self.aggregator.flush(
                        self.flow.per_minute(observed_epoch)
                    )
                    if metrics:
                        payload = build_observation(
                            self.camera,
                            metrics,
                            observed_epoch=observed_epoch,
                            model_name=self.model_name,
                            model_version=self.model_version,
                            interval_seconds=self.observation_interval,
                            model_sha256=self.model_sha256,
                        )
                        try:
                            response = self.client.post(
                                str(self.camera["cameraId"]), "observations", payload
                            )
                            LOG.info(
                                "Observation %s delivered (duplicate=%s).",
                                payload["eventId"],
                                response.get("duplicate", False),
                            )
                        except DeliveryError as error:
                            LOG.error("Observation delivery failed: %s", error)
                    next_observation = monotonic_now + self.observation_interval
                if monotonic_now >= next_heartbeat:
                    try:
                        self._send_heartbeat()
                    except DeliveryError as error:
                        LOG.error("Heartbeat delivery failed: %s", error)
                    next_heartbeat = monotonic_now + self.heartbeat_interval
        finally:
            if capture is not None:
                capture.release()


def config_summary(config: Mapping[str, Any]) -> dict[str, Any]:
    cameras = config["cameras"]
    model = config.get("model") or {}
    approval = model.get("approval") or {}
    return {
        "ok": True,
        "agentVersion": AGENT_VERSION,
        "cameraCount": len(cameras),
        "enabledCameraCount": sum(
            1 for camera in cameras if camera.get("enabled", True)
        ),
        "cameraIds": [camera["cameraId"] for camera in cameras],
        "streamEnvironmentVariables": [
            camera.get("streamEnv") for camera in cameras if camera.get("streamEnv")
        ],
        "secretEnvironmentVariables": [camera["secretEnv"] for camera in cameras],
        "modelApprovalStatus": str(approval.get("status") or "pending"),
        "privacyMode": "metrics_only",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config", default=str(Path(__file__).with_name("config.example.json"))
    )
    parser.add_argument("--camera", help="Camera ID to run or simulate")
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate config without reading secrets or streams",
    )
    parser.add_argument(
        "--validate-runtime",
        action="store_true",
        help="Validate required environment variables for all enabled cameras or --camera",
    )
    parser.add_argument(
        "--validate-production",
        action="store_true",
        help="Require reviewed model license and artifact approval metadata",
    )
    parser.add_argument(
        "--verify-model",
        action="store_true",
        help="Require the approved model file to exist locally with the configured checksum",
    )
    parser.add_argument(
        "--model-dir",
        default=".",
        help="Directory containing the approved model file",
    )
    parser.add_argument(
        "--simulate",
        metavar="JSON",
        help="Build one observation from a detection fixture without a model",
    )
    parser.add_argument(
        "--post",
        action="store_true",
        help="Post a simulated observation to the configured API",
    )
    parser.add_argument(
        "--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        production_mode = (
            args.validate_production
            or os.environ.get("SANDFEST_CAMERA_ENV", "").strip().lower() == "production"
        )
        config = load_config(
            args.config,
            require_runtime=args.validate_runtime,
            require_production_approval=production_mode,
            runtime_camera_id=args.camera if args.validate_runtime else None,
        )
        if args.verify_model:
            print(json.dumps(verify_model_file(config.get("model") or {}, args.model_dir), indent=2))
            return 0
        if args.validate or args.validate_runtime or args.validate_production:
            summary = config_summary(config)
            if args.validate_runtime:
                summary["runtimeValidatedCameraIds"] = (
                    [args.camera]
                    if args.camera
                    else [
                        camera["cameraId"]
                        for camera in config["cameras"]
                        if camera.get("enabled", True)
                    ]
                )
            summary["productionApprovalValidated"] = production_mode
            print(json.dumps(summary, indent=2))
            return 0
        if not args.camera:
            raise AgentConfigurationError(
                "--camera is required unless a validation command is used."
            )
        camera = selected_camera(config, args.camera)
        if args.simulate:
            fixture = json.loads(Path(args.simulate).read_text())
            payload = simulate(config, camera, fixture)
            if args.post:
                runtime = resolve_runtime(config, camera)
                agent = config.get("agent") or {}
                client = MetricsClient(
                    str(runtime["apiBase"]),
                    key_id=str(camera.get("keyId") or ""),
                    secret=str(runtime["secret"]),
                    timeout_seconds=float(agent.get("requestTimeoutSeconds") or 10),
                    retries=int(agent.get("requestRetries") or 3),
                )
                result = client.post(str(camera["cameraId"]), "observations", payload)
                print(json.dumps({"payload": payload, "result": result}, indent=2))
            else:
                print(json.dumps(payload, indent=2))
            return 0
        runtime = resolve_runtime(config, camera)
        CameraRunner(config, camera, runtime).run()
        return 0
    except (
        AgentConfigurationError,
        DeliveryError,
        OSError,
        json.JSONDecodeError,
    ) as error:
        LOG.error("%s", error)
        return 2


if __name__ == "__main__":
    sys.exit(main())
