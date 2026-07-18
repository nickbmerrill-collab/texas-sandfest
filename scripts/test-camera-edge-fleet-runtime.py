#!/usr/bin/env python3

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def canonical_json(value: object) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(str(key), ensure_ascii=False)}:{canonical_json(entry)}"
            for key, entry in sorted(value.items())
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(entry) for entry in value) + "]"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main() -> int:
    report_path = Path(
        os.environ.get(
            "SANDFEST_CAMERA_FLEET_REPORT",
            ROOT / ".sandfest-runtime" / "camera-fleet-qualification.json",
        )
    ).expanduser()
    if not report_path.is_absolute():
        report_path = ROOT / report_path
    report_path.unlink(missing_ok=True)

    try:
        import cv2
        import lap
        import numpy as np
        import torch
        import ultralytics

        from camera_agent.edge_agent import (
            AGENT_VERSION,
            PRODUCTION_CAMERA_IDS,
            CameraRunner,
            load_config,
            verify_model_file,
        )
    except ImportError as error:
        raise RuntimeError(
            "Install the locked camera requirements in camera_agent/.venv first."
        ) from error

    model_dir = Path(
        os.environ.get(
            "SANDFEST_CAMERA_MODEL_DIR", Path.home() / ".cache" / "sandfest-camera"
        )
    )
    model_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(model_dir)

    config_path = Path(
        os.environ.get(
            "SANDFEST_CAMERA_CONFIG", ROOT / "camera_agent" / "config.example.json"
        )
    ).expanduser()
    if not config_path.is_absolute():
        config_path = ROOT / config_path
    config = load_config(config_path, require_full_fleet=True)
    cameras = [camera for camera in config["cameras"] if camera.get("enabled", True)]
    model_verification = verify_model_file(config.get("model") or {}, model_dir)
    generated_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    runners = []
    for camera in cameras:
        runner = CameraRunner(
            config,
            camera,
            {
                "apiBase": "http://127.0.0.1:8806",
                "secret": f"{camera['cameraId']}-fleet-runtime-secret-at-least-32-characters",
                "source": 0,
            },
        )
        runner._detections(generated_frame)
        runners.append(runner)

    cycle_count = max(2, min(10, int(os.environ.get("SANDFEST_CAMERA_FLEET_TEST_CYCLES", "3"))))
    cycle_latencies = []
    per_camera: dict[str, list[int]] = {camera["cameraId"]: [] for camera in cameras}
    for _ in range(cycle_count):
        started = time.perf_counter()
        for runner in runners:
            runner._detections(generated_frame)
            per_camera[str(runner.camera["cameraId"])].append(
                int(runner.last_inference_ms or 0)
            )
        cycle_latencies.append(round((time.perf_counter() - started) * 1000))

    sample_fps = float((config.get("agent") or {}).get("sampleFps") or 3)
    cycle_budget_ms = round(1000 / sample_fps)
    median_cycle_ms = round(statistics.median(cycle_latencies))
    maximum_cycle_ms = max(cycle_latencies)
    camera_ids = [str(camera["cameraId"]) for camera in cameras]
    configured_camera_ids = set(camera_ids)
    missing_camera_ids = sorted(PRODUCTION_CAMERA_IDS - configured_camera_ids)
    unexpected_camera_ids = sorted(configured_camera_ids - PRODUCTION_CAMERA_IDS)
    model_instances = {id(runner.model) for runner in runners}
    failure_reasons = []
    if missing_camera_ids:
        failure_reasons.append(f"missing camera lanes: {', '.join(missing_camera_ids)}")
    if unexpected_camera_ids:
        failure_reasons.append(
            f"unexpected camera lanes: {', '.join(unexpected_camera_ids)}"
        )
    if len(runners) != len(PRODUCTION_CAMERA_IDS):
        failure_reasons.append(
            f"loaded {len(runners)} camera lanes; expected {len(PRODUCTION_CAMERA_IDS)}"
        )
    if len(model_instances) != len(runners):
        failure_reasons.append("each camera lane must retain its own model instance")
    if maximum_cycle_ms > cycle_budget_ms:
        failure_reasons.append(
            f"maximum cycle {maximum_cycle_ms} ms exceeded {cycle_budget_ms} ms budget"
        )
    output = {
        "reportVersion": 1,
        "qualification": "eight-camera-generated-frame-runtime",
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        ),
        "ok": not failure_reasons,
        "privacy": "generated pixels only; no frame or crop written",
        "agentVersion": AGENT_VERSION,
        "python": platform.python_version(),
        "opencv": cv2.__version__,
        "lap": lap.__version__,
        "torch": torch.__version__,
        "ultralytics": ultralytics.__version__,
        "configSha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
        "cameraCount": len(runners),
        "cameraIds": camera_ids,
        "missingCameraIds": missing_camera_ids,
        "unexpectedCameraIds": unexpected_camera_ids,
        "modelInstances": len(runners),
        "distinctModelInstances": len(model_instances),
        "model": runners[0].model_name if runners else None,
        "modelVersion": runners[0].model_version if runners else None,
        "modelSha256": model_verification["sha256"],
        "modelBytes": model_verification["bytes"],
        "device": str(runners[0].model.device) if runners else None,
        "mpsAvailable": torch.backends.mps.is_available(),
        "targetSampleFpsPerCamera": sample_fps,
        "cycleBudgetMs": cycle_budget_ms,
        "cycleMedianMs": median_cycle_ms,
        "cycleMaxMs": maximum_cycle_ms,
        "cycleBudgetMet": maximum_cycle_ms <= cycle_budget_ms,
        "cycles": cycle_count,
        "perCamera": {
            camera_id: {
                "medianInferenceMs": round(statistics.median(values)),
                "maxInferenceMs": max(values),
            }
            for camera_id, values in per_camera.items()
        },
        "failureReasons": failure_reasons,
    }
    output["evidenceSha256"] = hashlib.sha256(
        canonical_json(output).encode("utf-8")
    ).hexdigest()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_report_path = report_path.with_name(
        f".{report_path.name}.{os.getpid()}.tmp"
    )
    temporary_report_path.write_text(f"{json.dumps(output, indent=2)}\n", encoding="utf-8")
    temporary_report_path.replace(report_path)
    output["report"] = (
        str(report_path.relative_to(ROOT))
        if report_path.is_relative_to(ROOT)
        else report_path.name
    )
    print(json.dumps(output, indent=2))
    if not output["ok"]:
        raise RuntimeError(
            f"Eight-source inference qualification failed: {'; '.join(failure_reasons)}."
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"camera edge fleet runtime test failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
