#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model


DEFAULT_DIRECTION = (
    "Warm, confident American documentary narrator speaking conversationally to a board. "
    "Natural breath, varied emphasis, calm authority, and restrained optimism. "
    "Avoid an announcer voice and avoid sing-song cadence. Use an unhurried pace, "
    "connect thoughts naturally, and allow brief reflective pauses after important ideas."
)


def main():
    parser = argparse.ArgumentParser(description="Generate local Qwen3-TTS narration files.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--voice", default="Aiden")
    parser.add_argument("--speed", type=float, default=0.96)
    parser.add_argument("--direction", default=DEFAULT_DIRECTION)
    args = parser.parse_args()

    items = json.loads(Path(args.manifest).read_text())
    model = load_model(args.model)
    sample_rate = int(getattr(model, "sample_rate", 24000))

    for item in items:
        text = " ".join(part.strip() for part in item["text"].split("|") if part.strip())
        out = Path(item["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        generated = list(
            model.generate(
                text=text,
                voice=args.voice,
                instruct=args.direction,
                lang_code="English",
                speed=args.speed,
                temperature=0.75,
                top_p=0.9,
                repetition_penalty=1.08,
                verbose=False,
            )
        )
        if not generated:
            raise RuntimeError(f"No audio generated for {item['id']}")
        chunks = [np.asarray(result.audio, dtype=np.float32) for result in generated]
        if len(chunks) > 1:
            silence = np.zeros(int(sample_rate * 0.12), dtype=np.float32)
            audio = np.concatenate([part for index, chunk in enumerate(chunks) for part in ((chunk, silence) if index < len(chunks) - 1 else (chunk,))])
        else:
            audio = chunks[0]
        sf.write(out, audio, sample_rate)
        print(f"{item['id']}: {out}")


if __name__ == "__main__":
    main()
