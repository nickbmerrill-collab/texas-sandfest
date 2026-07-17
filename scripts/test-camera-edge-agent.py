#!/usr/bin/env python3

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import call, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from camera_agent.edge_agent import (  # noqa: E402
    AgentConfigurationError,
    CameraRunner,
    Detection,
    FlowCounter,
    FrameMetrics,
    MetricAggregator,
    MetricsClient,
    build_heartbeat,
    derive_frame_metrics,
    load_config,
    point_in_polygon,
    resolve_inference_device,
    selected_camera,
    sign_payload,
    simulate,
    stable_window_id,
    validate_config,
    validate_model_approval,
    verify_model_file,
)


CONFIG_PATH = ROOT / "camera_agent" / "config.example.json"


class CaptureHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        self.server.capture = {  # type: ignore[attr-defined]
            "path": self.path,
            "body": body,
            "headers": dict(self.headers.items()),
        }
        response = json.dumps({"ok": True, "duplicate": False}).encode()
        self.send_response(201)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, *_: object) -> None:
        return


def person(
    track_id: str, center_x: float, center_y: float = 0.6, confidence: float = 0.9
) -> Detection:
    return Detection(
        track_id,
        0,
        confidence,
        center_x - 0.05,
        center_y - 0.1,
        center_x + 0.05,
        center_y + 0.1,
    )


class CameraEdgeAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_config(CONFIG_PATH)

    def test_example_config_covers_the_eight_source_fleet(self) -> None:
        self.assertEqual(len(self.config["cameras"]), 8)
        self.assertEqual(
            {camera["cameraId"] for camera in self.config["cameras"]},
            {
                "ferry-loading",
                "ferry-stacking",
                "harbor-island-entrance",
                "harbor-island-stacking",
                "north-gate",
                "south-gate",
                "food-court",
                "competition-corridor",
            },
        )
        for camera in self.config["cameras"]:
            self.assertNotIn("secret", camera)
            self.assertTrue(camera["secretEnv"].startswith("SANDFEST_CAMERA_"))
            self.assertTrue(camera["streamEnv"].endswith("_STREAM"))

    def test_inline_stream_credentials_are_rejected(self) -> None:
        unsafe = json.loads(CONFIG_PATH.read_text())
        unsafe["cameras"][0].pop("streamEnv")
        unsafe["cameras"][0]["source"] = "rtsp://user:password@camera.local/live"
        with self.assertRaisesRegex(AgentConfigurationError, "stream credentials"):
            validate_config(unsafe)

    def test_runtime_validation_requires_streams_and_secrets(self) -> None:
        with self.assertRaisesRegex(
            AgentConfigurationError, "must contain at least 32"
        ):
            validate_config(self.config, require_runtime=True, env={})

    def test_runtime_validation_can_scope_one_service_environment(self) -> None:
        environment = {
            "SANDFEST_CAMERA_NORTH_GATE_SECRET": "north-gate-runtime-secret-at-least-32-characters",
            "SANDFEST_CAMERA_NORTH_GATE_STREAM": "rtsp://camera.internal/live",
        }
        validated = validate_config(
            self.config,
            require_runtime=True,
            runtime_camera_id="north-gate",
            env=environment,
        )
        self.assertEqual(selected_camera(validated, "north-gate")["cameraId"], "north-gate")
        with self.assertRaisesRegex(AgentConfigurationError, "FERRY_LOADING_SECRET"):
            validate_config(
                self.config,
                require_runtime=True,
                runtime_camera_id="ferry-loading",
                env=environment,
            )

    def test_malformed_camera_config_returns_operator_errors(self) -> None:
        malformed = json.loads(CONFIG_PATH.read_text())
        malformed["cameras"][0]["capacity"] = "many"
        with self.assertRaisesRegex(
            AgentConfigurationError, "capacity and service rate must be numbers"
        ):
            validate_config(malformed)
        malformed = json.loads(CONFIG_PATH.read_text())
        malformed["cameras"][0]["flowClassIds"] = ["person"]
        with self.assertRaisesRegex(AgentConfigurationError, "numeric model classes"):
            validate_config(malformed)
        malformed = json.loads(CONFIG_PATH.read_text())
        malformed["cameras"][0]["roiNormalized"][0] = ["left", 0.1]
        with self.assertRaisesRegex(
            AgentConfigurationError, "coordinates must be numbers"
        ):
            validate_config(malformed)
        malformed = json.loads(CONFIG_PATH.read_text())
        malformed["model"]["sha256"] = "not-a-checksum"
        with self.assertRaisesRegex(
            AgentConfigurationError, "64 lowercase hexadecimal"
        ):
            validate_config(malformed)

    def test_production_requires_reviewed_model_approval(self) -> None:
        with self.assertRaisesRegex(
            AgentConfigurationError, "production approval is incomplete"
        ):
            validate_config(self.config, require_production_approval=True)

        approved = json.loads(CONFIG_PATH.read_text())
        approved["model"]["approval"] = {
            "status": "approved",
            "licenseReference": "replacement-license-2026",
            "approvedBy": "SandFest technology committee",
            "approvedAt": "2026-07-17T12:00:00Z",
            "decisionReference": "CAMERA-MODEL-2026-001",
        }
        validated = validate_config(
            approved,
            require_production_approval=True,
        )
        self.assertEqual(validated["model"]["approval"]["status"], "approved")

    def test_model_approval_rejects_future_or_placeholder_attestations(self) -> None:
        model = json.loads(CONFIG_PATH.read_text())["model"]
        model["approval"] = {
            "status": "approved",
            "licenseReference": "pending",
            "approvedBy": "SandFest technology committee",
            "approvedAt": "2026-07-18T12:00:00Z",
            "decisionReference": "CAMERA-MODEL-2026-001",
        }
        with self.assertRaisesRegex(
            AgentConfigurationError, "licenseReference must contain"
        ):
            validate_model_approval(
                model,
                required=True,
                now_epoch=1784290000,
            )

    def test_point_in_polygon(self) -> None:
        polygon = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        self.assertTrue(point_in_polygon((0.5, 0.5), polygon))
        self.assertFalse(point_in_polygon((0.95, 0.5), polygon))

    def test_flow_counter_counts_one_crossing_per_track_per_minute(self) -> None:
        counter = FlowCounter([[0.5, 0], [0.5, 1]], [0])
        self.assertEqual(counter.update([person("p1", 0.35)], 100), 0)
        self.assertEqual(counter.update([person("p1", 0.65)], 101), 1)
        self.assertEqual(counter.update([person("p1", 0.35)], 102), 1)
        self.assertEqual(counter.per_minute(161.1), 0)
        self.assertEqual(counter.update([person("p1", 0.65)], 162), 1)

    def test_untracked_detections_never_create_flow(self) -> None:
        counter = FlowCounter([[0.5, 0], [0.5, 1]], [0])
        self.assertEqual(counter.update([person("", 0.35)], 100), 0)
        self.assertEqual(counter.update([person("", 0.65)], 101), 0)

    def test_frame_metrics_are_anonymous_counts(self) -> None:
        camera = selected_camera(self.config, "north-gate")
        detections = [
            person("p1", 0.3),
            person("p2", 0.4, confidence=0.8),
            person("p3", 0.6, confidence=0.7),
            Detection("car1", 2, 0.95, 0.2, 0.5, 0.3, 0.7),
        ]
        metrics = derive_frame_metrics(
            camera, detections, flow_per_minute=10, processing_ms=42
        )
        self.assertEqual(metrics.people_count, 3)
        self.assertEqual(metrics.vehicle_count, 1)
        self.assertEqual(metrics.queue_length, 3)
        self.assertAlmostEqual(metrics.occupancy_pct, 0.5)
        self.assertAlmostEqual(metrics.estimated_wait_minutes, 0.08)
        self.assertEqual(metrics.processing_ms, 42)

    def test_empty_frame_has_zero_detection_confidence(self) -> None:
        camera = selected_camera(self.config, "north-gate")
        metrics = derive_frame_metrics(camera, [], flow_per_minute=0, processing_ms=10)
        self.assertEqual(metrics.confidence, 0)

    def test_aggregation_uses_median_and_queue_pressure(self) -> None:
        aggregator = MetricAggregator()
        for count in [2, 4, 20]:
            aggregator.add(
                FrameMetrics(count, 1, count, count * 2.0, count / 2, 0.8, 30 + count)
            )
        metrics = aggregator.flush(7)
        self.assertEqual(metrics["peopleCount"], 4)
        self.assertEqual(metrics["queueLength"], 20)
        self.assertEqual(metrics["occupancyPct"], 8.0)
        self.assertEqual(metrics["flowPerMinute"], 7)
        self.assertIsNone(aggregator.flush(0))

    def test_simulation_builds_stable_retry_safe_payload(self) -> None:
        camera = selected_camera(self.config, "north-gate")
        fixture = {
            "startEpoch": 1784250000,
            "frames": [
                {
                    "offsetSeconds": 0,
                    "detections": [
                        {"trackId": "p1", "classId": 0, "box": [0.2, 0.5, 0.3, 0.8]}
                    ],
                },
                {
                    "offsetSeconds": 1,
                    "detections": [
                        {"trackId": "p1", "classId": 0, "box": [0.7, 0.5, 0.8, 0.8]}
                    ],
                },
            ],
        }
        first = simulate(self.config, camera, fixture)
        second = simulate(self.config, camera, fixture)
        self.assertEqual(first, second)
        self.assertEqual(first["flowPerMinute"], 1.0)
        self.assertEqual(first["sourceId"], "local-north-gate-1")
        self.assertEqual(first["modelSha256"], self.config["model"]["sha256"])
        self.assertLessEqual(len(first["eventId"]), 100)
        self.assertNotIn("detections", first)
        self.assertNotIn("frames", first)

    def test_stable_ids_share_an_observation_window(self) -> None:
        self.assertEqual(
            stable_window_id("north-gate", 107.0, 10),
            stable_window_id("north-gate", 109.9, 10),
        )
        self.assertNotEqual(
            stable_window_id("north-gate", 109.9, 10),
            stable_window_id("north-gate", 110.0, 10),
        )

    def test_hmac_matches_the_server_contract(self) -> None:
        raw = b'{"eventId":"north-gate-obs-20260716T140000Z"}'
        timestamp = "1784210400"
        secret = "camera-test-secret-at-least-32-characters"
        key_id = "north-gate-v1"
        expected = hmac.new(
            secret.encode(),
            b"camera:v1:north-gate-v1:1784210400:" + raw,
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(sign_payload(raw, timestamp, secret, key_id), expected)

    def test_metrics_client_posts_exact_signed_bytes(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.capture = None  # type: ignore[attr-defined]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        secret = "camera-test-secret-at-least-32-characters"
        client = MetricsClient(
            f"http://127.0.0.1:{server.server_port}",
            key_id="north-gate-v1",
            secret=secret,
        )
        payload = {
            "eventId": "north-gate-obs-20260716T140000Z",
            "sourceId": "local-north-gate-1",
        }
        result = client.post("north-gate", "observations", payload)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        capture = server.capture  # type: ignore[attr-defined]
        self.assertTrue(result["ok"])
        self.assertEqual(capture["path"], "/api/ingest/cameras/north-gate/observations")
        timestamp = capture["headers"]["X-Sandfest-Timestamp"]
        expected = sign_payload(capture["body"], timestamp, secret, "north-gate-v1")
        self.assertEqual(
            capture["headers"]["X-Sandfest-Signature"], f"sha256={expected}"
        )

    def test_heartbeat_contains_health_not_media(self) -> None:
        camera = selected_camera(self.config, "north-gate")
        heartbeat = build_heartbeat(
            camera,
            observed_epoch=1784250000,
            status="healthy",
            agent_id="edge-a",
            frames_per_second=3,
            inference_latency_ms=52,
            dropped_frame_pct=0.5,
            uptime_seconds=120,
            model_name="yolo11n.pt",
            model_version="yolo11n-coco",
            heartbeat_interval_seconds=30,
            model_sha256=self.config["model"]["sha256"],
        )
        self.assertEqual(heartbeat["status"], "healthy")
        self.assertEqual(heartbeat["modelSha256"], self.config["model"]["sha256"])
        self.assertNotIn("frame", heartbeat)
        self.assertNotIn("stream", heartbeat)

    def test_cli_validate_and_simulate_do_not_need_inference_dependencies(self) -> None:
        validate = subprocess.run(
            [
                sys.executable,
                "-m",
                "camera_agent.edge_agent",
                "--validate",
                "--config",
                str(CONFIG_PATH),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(validate.returncode, 0, validate.stderr)
        self.assertEqual(json.loads(validate.stdout)["cameraCount"], 8)
        fixture = {
            "startEpoch": 1784250000,
            "frames": [
                {
                    "detections": [
                        {"trackId": "p1", "classId": 0, "box": [0.2, 0.4, 0.3, 0.8]}
                    ]
                }
            ],
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json") as file:
            json.dump(fixture, file)
            file.flush()
            simulated = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "camera_agent.edge_agent",
                    "--config",
                    str(CONFIG_PATH),
                    "--camera",
                    "north-gate",
                    "--simulate",
                    file.name,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(simulated.returncode, 0, simulated.stderr)
        self.assertEqual(json.loads(simulated.stdout)["sourceId"], "local-north-gate-1")

    def test_agent_source_has_no_media_export_path(self) -> None:
        source = (ROOT / "camera_agent" / "edge_agent.py").read_text()
        for forbidden in (
            "cv2.imwrite",
            "save_crop",
            "result.save(",
            "face_recognition",
        ):
            self.assertNotIn(forbidden, source)

    def test_model_checksum_mismatch_fails_closed(self) -> None:
        with tempfile.NamedTemporaryFile("wb") as model_file:
            model_file.write(b"not-an-approved-model")
            model_file.flush()
            runner = CameraRunner.__new__(CameraRunner)
            runner.model_name = model_file.name
            runner.model_sha256 = "0" * 64
            with self.assertRaisesRegex(
                AgentConfigurationError, "checksum does not match"
            ):
                runner._verify_model_checksum(required=True)

    def test_model_preflight_requires_cached_approved_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "approved.pt"
            model_path.write_bytes(b"approved-model-bytes")
            digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
            verified = verify_model_file(
                {"name": model_path.name, "sha256": digest}, directory
            )
            self.assertEqual(verified["sha256"], digest)
            self.assertEqual(verified["bytes"], len(b"approved-model-bytes"))
            with self.assertRaisesRegex(AgentConfigurationError, "not cached"):
                verify_model_file(
                    {"name": "missing.pt", "sha256": digest}, directory
                )

    def test_auto_device_prefers_cuda_then_mps_then_cpu(self) -> None:
        class Available:
            def __init__(self, value: bool) -> None:
                self.value = value

            def is_available(self) -> bool:
                return self.value

        class Backends:
            def __init__(self, mps: bool) -> None:
                self.mps = Available(mps)

        class Torch:
            def __init__(self, cuda: bool, mps: bool) -> None:
                self.cuda = Available(cuda)
                self.backends = Backends(mps)

        self.assertEqual(resolve_inference_device("auto", Torch(True, True)), "0")
        self.assertEqual(resolve_inference_device("auto", Torch(False, True)), "mps")
        self.assertEqual(resolve_inference_device("auto", Torch(False, False)), "cpu")
        self.assertEqual(resolve_inference_device("cpu", Torch(True, True)), "cpu")

    def test_stream_failures_back_off_and_bound_error_heartbeats(self) -> None:
        runner = CameraRunner.__new__(CameraRunner)
        runner.camera = {"cameraId": "north-gate"}
        runner.last_error = None
        runner.next_error_heartbeat = 0.0
        runner.heartbeat_interval = 30
        runner.stop_requested = False
        statuses: list[str] = []
        runner._send_heartbeat = lambda status=None: statuses.append(status)
        with patch(
            "camera_agent.edge_agent.time.monotonic", side_effect=[100.0, 105.0]
        ), patch("camera_agent.edge_agent.time.sleep") as sleep:
            delay = runner._handle_stream_failure("read failed", 1.0)
            delay = runner._handle_stream_failure("read failed", delay)
        self.assertEqual(delay, 4.0)
        self.assertEqual(statuses, ["error"])
        self.assertEqual(sleep.call_args_list, [call(1.0), call(2.0)])

    def test_systemd_service_fails_before_start_without_runtime_or_model(self) -> None:
        unit = (ROOT / "camera_agent" / "systemd" / "sandfest-camera@.service").read_text()
        self.assertIn("SANDFEST_CAMERA_ENV=production", unit)
        self.assertIn("--camera %i --validate-runtime --validate-production", unit)
        self.assertIn("--verify-model --model-dir /var/lib/sandfest-camera", unit)
        self.assertLess(unit.index("ExecStartPre="), unit.index("\nExecStart="))


if __name__ == "__main__":
    unittest.main(verbosity=2)
