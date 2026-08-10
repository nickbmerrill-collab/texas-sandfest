#!/usr/bin/env python3
"""Transcribe the finished board film and compare it with the approved script."""

from __future__ import annotations

import json
import re
from pathlib import Path

from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts/board-presentation-demo/h3"
VIDEO_PATH = ARTIFACT_DIR / "texas-sandfest-world-class-board-demo.mp4"
SCRIPT_PATH = ARTIFACT_DIR / "texas-sandfest-world-class-board-demo-transcript.txt"
REPORT_PATH = ARTIFACT_DIR / "texas-sandfest-world-class-board-demo-transcript-qa.json"
MODEL_PATH = Path("/Volumes/ModelRAID/hf-hoard/shared/audio/Systran__faster-whisper-large-v3")


def words(value: str) -> list[str]:
    normalized = value.lower().replace("sand fest", "sandfest")
    return re.sub(r"[^a-z0-9]+", " ", normalized).split()


def distance(expected: list[str], actual: list[str]) -> int:
    previous = list(range(len(actual) + 1))
    for row, expected_word in enumerate(expected, start=1):
        current = [row]
        for column, actual_word in enumerate(actual, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (expected_word != actual_word),
                )
            )
        previous = current
    return previous[-1]


def main() -> None:
    if not VIDEO_PATH.is_file() or not SCRIPT_PATH.is_file():
        raise SystemExit("Render the final board video before running transcript QA.")
    approved_lines = SCRIPT_PATH.read_text().splitlines()[2:]
    approved = " ".join(line.strip() for line in approved_lines if line.strip())
    model = WhisperModel(str(MODEL_PATH), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        str(VIDEO_PATH),
        language="en",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
        word_timestamps=True,
    )
    heard_segments = [
        {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
        for segment in segments
        if segment.text.strip()
    ]
    heard = " ".join(item["text"] for item in heard_segments)
    approved_words = words(approved)
    heard_words = words(heard)
    word_error_rate = distance(approved_words, heard_words) / max(1, len(approved_words))
    normalized_heard = " ".join(heard_words)
    anchors = [
        "for every guest",
        "for sponsors and vendors",
        "leadership sees revenue",
        "outreach becomes precise",
        "island conditions",
        "readiness is explicit",
        "one operating system",
    ]
    anchor_results = {anchor: anchor in normalized_heard for anchor in anchors}
    report = {
        "passed": word_error_rate <= 0.08 and all(anchor_results.values()),
        "wordErrorRate": word_error_rate,
        "approvedWordCount": len(approved_words),
        "heardWordCount": len(heard_words),
        "anchors": anchor_results,
        "approved": approved,
        "heard": heard,
        "segments": heard_segments,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit("The final film failed transcript QA.")


if __name__ == "__main__":
    main()
