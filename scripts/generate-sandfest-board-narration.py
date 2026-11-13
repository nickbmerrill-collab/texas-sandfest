#!/usr/bin/env python3
"""Generate the continuous local voice-over for the SandFest board film."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import perth
import torch
import torchaudio

# Perth's neural watermarker is not distributed for macOS. Chatterbox calls the
# same interface unconditionally, so use its bundled passthrough implementation.
if perth.PerthImplicitWatermarker is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

from chatterbox.tts_turbo import ChatterboxTurboTTS  # noqa: E402


NARRATION = (
    (
        "02-visitor",
        "For every guest, the journey is simple. Discover sculptors, plan the day, "
        "buy tickets, and follow beach and island conditions, all in one connected experience.",
    ),
    (
        "03-partners",
        "For sponsors and vendors, interest becomes an organized relationship. "
        "Applications, review, payment, key dates, and thoughtful follow-up move "
        "through one professional pipeline.",
    ),
    (
        "04-command",
        "Behind it all, leadership sees revenue, readiness, deadlines, and exceptions "
        "in one command center, with every next action tied to an owner.",
    ),
    (
        "05-outreach-accounting",
        "Outreach becomes precise. The team can target the right businesses and "
        "geographies, preview every campaign, and automate follow-up without giving "
        "up human review. Receivables stay visible through payment.",
    ),
    (
        "06-delegation-island",
        "During the festival, staff and volunteers share assignments, guest cases, "
        "incidents, and deadlines. Island Conditions is designed to unite weather, "
        "ferry movement, traffic, crowds, and lines when live feeds are activated.",
    ),
    (
        "07-readiness",
        "Readiness is explicit. Certified board capabilities stay clearly separated "
        "from production credentials, policy decisions, and the deliberate activation "
        "of live providers.",
    ),
    (
        "08-close",
        "One festival. One team. One operating system. Built for the Texas SandFest "
        "we are becoming.",
    ),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reference",
        default="artifacts/board-presentation-demo/h3/full/01-sunrise-reveal.wav",
    )
    parser.add_argument(
        "--output-dir",
        default="artifacts/board-presentation-demo/h3/narration/raw",
    )
    parser.add_argument("--device", default="mps")
    parser.add_argument("--seed", type=int, default=270500)
    parser.add_argument("--temperature", type=float, default=0.72)
    args = parser.parse_args()

    reference = Path(args.reference).resolve()
    output_dir = Path(args.output_dir).resolve()
    if not reference.is_file():
        raise SystemExit(f"Narration reference does not exist: {reference}")
    output_dir.mkdir(parents=True, exist_ok=True)

    torch.manual_seed(args.seed)
    model = ChatterboxTurboTTS.from_pretrained(device=args.device)
    manifest = []
    for index, (scene_id, text) in enumerate(NARRATION):
        torch.manual_seed(args.seed + index)
        wav = model.generate(
            text,
            audio_prompt_path=str(reference),
            temperature=args.temperature,
            top_p=0.9,
            repetition_penalty=1.25,
        )
        output = output_dir / f"{scene_id}.wav"
        torchaudio.save(str(output), wav.cpu(), model.sr)
        manifest.append(
            {
                "id": scene_id,
                "text": text,
                "path": str(output),
                "sampleRate": model.sr,
                "samples": int(wav.shape[-1]),
                "seed": args.seed + index,
            }
        )
        print(f"WROTE {scene_id} ({wav.shape[-1] / model.sr:.2f}s)", flush=True)

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"MANIFEST {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
