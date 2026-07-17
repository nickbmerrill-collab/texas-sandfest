#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> int:
    try:
        import cv2
        import lap
        import numpy as np
        import torch
        import ultralytics

        from camera_agent.edge_agent import CameraRunner, load_config, selected_camera
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
    camera = selected_camera(config, "north-gate")
    runner = CameraRunner(
        config,
        camera,
        {
            "apiBase": "http://127.0.0.1:8806",
            "secret": "runtime-test-secret-at-least-32-characters",
            "source": 0,
        },
    )
    generated_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    detection_counts = []
    latencies = []
    for _ in range(5):
        detection_counts.append(len(runner._detections(generated_frame)))
        latencies.append(runner.last_inference_ms or 0)
    print(
        json.dumps(
            {
                "ok": True,
                "privacy": "generated pixels only; no frame or crop written",
                "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                "opencv": cv2.__version__,
                "lap": lap.__version__,
                "torch": torch.__version__,
                "ultralytics": ultralytics.__version__,
                "model": runner.model_name,
                "tracker": "bytetrack",
                "device": str(runner.model.device),
                "mpsAvailable": torch.backends.mps.is_available(),
                "frames": len(latencies),
                "detections": sum(detection_counts),
                "coldInferenceMs": latencies[0],
                "warmMedianInferenceMs": round(statistics.median(latencies[1:])),
                "warmMaxInferenceMs": max(latencies[1:]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"camera edge runtime test failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
