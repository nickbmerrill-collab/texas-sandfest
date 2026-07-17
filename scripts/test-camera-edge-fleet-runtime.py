#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> int:
    try:
        import numpy as np
        import torch

        from camera_agent.edge_agent import CameraRunner, load_config
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

    config = load_config(ROOT / "camera_agent" / "config.example.json")
    cameras = [camera for camera in config["cameras"] if camera.get("enabled", True)]
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
    output = {
        "ok": median_cycle_ms <= cycle_budget_ms,
        "privacy": "generated pixels only; no frame or crop written",
        "cameraCount": len(runners),
        "modelInstances": len(runners),
        "model": runners[0].model_name if runners else None,
        "device": str(runners[0].model.device) if runners else None,
        "mpsAvailable": torch.backends.mps.is_available(),
        "targetSampleFpsPerCamera": sample_fps,
        "cycleBudgetMs": cycle_budget_ms,
        "cycleMedianMs": median_cycle_ms,
        "cycleMaxMs": max(cycle_latencies),
        "cycles": cycle_count,
        "perCamera": {
            camera_id: {
                "medianInferenceMs": round(statistics.median(values)),
                "maxInferenceMs": max(values),
            }
            for camera_id, values in per_camera.items()
        },
    }
    print(json.dumps(output, indent=2))
    if not output["ok"]:
        raise RuntimeError(
            f"Eight-source inference missed its {cycle_budget_ms} ms cycle budget."
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"camera edge fleet runtime test failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
