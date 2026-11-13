#!/usr/bin/env python3
"""Build a continuous instrumental score from local MiniMax H3 audio."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[1]
H3_DIR = ROOT / "artifacts/board-presentation-demo/h3"
FULL_DIR = H3_DIR / "full"
MUSIC_DIR = H3_DIR / "music"
SOURCE_DIR = MUSIC_DIR / "sources"
STEM_DIR = MUSIC_DIR / "stems"
DEMUCS_PYTHON = Path("/Volumes/ModelRAID/sandfest-demucs/.venv/bin/python")
WHISPER_MODEL = Path("/Volumes/ModelRAID/hf-hoard/shared/audio/Systran__faster-whisper-large-v3")
SCORE_PATH = MUSIC_DIR / "sandfest-score.wav"


def run(*args: str | Path) -> None:
    subprocess.run([str(arg) for arg in args], check=True)


def latest(prefix: str) -> Path:
    matches = sorted(FULL_DIR.glob(f"{prefix}_*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not matches:
        raise SystemExit(f"Missing H3 score source: {prefix}")
    return matches[0]


def separate(prefix: str) -> Path:
    source = latest(prefix)
    wav = SOURCE_DIR / f"{prefix}.wav"
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vn", "-ar", "48000", "-ac", "2", wav)
    run(
        DEMUCS_PYTHON,
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        "htdemucs",
        "--device",
        "cpu",
        "-o",
        STEM_DIR,
        wav,
    )
    stem = STEM_DIR / "htdemucs" / prefix / "no_vocals.wav"
    if not stem.is_file():
        raise SystemExit(f"Demucs did not produce the instrumental stem: {stem}")
    return stem


def main() -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    STEM_DIR.mkdir(parents=True, exist_ok=True)
    stems = [separate("09-score-foundation"), separate("10-score-lift")]
    sequence = [stems[index % 2] for index in range(8)]
    filters = []
    label = "[0:a]"
    for index in range(1, len(sequence)):
        output = f"a{index}"
        filters.append(f"{label}[{index}:a]acrossfade=d=1.8:c1=tri:c2=tri[{output}]")
        label = f"[{output}]"
    filters.append(f"{label}atrim=0:100,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.2,afade=t=out:st=96.5:d=3.5[score]")
    run(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *(item for path in sequence for item in ("-i", path)),
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[score]",
        "-ar",
        "48000",
        "-ac",
        "2",
        SCORE_PATH,
    )

    model = WhisperModel(str(WHISPER_MODEL), device="cpu", compute_type="int8")
    speech = []
    for stem in stems:
        segments, _ = model.transcribe(
            str(stem),
            language="en",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        if transcript:
            speech.append({"path": str(stem), "transcript": transcript})
    report = {
        "passed": not speech,
        "score": str(SCORE_PATH),
        "sources": [str(path) for path in sequence],
        "voiceActivity": speech,
    }
    (MUSIC_DIR / "score-qa.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if speech:
        raise SystemExit("Instrumental score failed the voice-activity gate.")


if __name__ == "__main__":
    main()
