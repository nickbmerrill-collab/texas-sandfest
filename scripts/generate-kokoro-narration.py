#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import soundfile as sf
from kokoro import KPipeline


def main():
    parser = argparse.ArgumentParser(description="Generate local Kokoro narration WAV files.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--voice", default="am_michael")
    parser.add_argument("--speed", type=float, default=0.92)
    args = parser.parse_args()

    items = json.loads(Path(args.manifest).read_text())
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    for item in items:
        text = item["text"].strip()
        out = Path(item["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        chunks = []
        for _, _, audio in pipeline(text, voice=args.voice, speed=args.speed):
            chunks.append(audio)
        if not chunks:
            raise RuntimeError(f"No audio generated for {item['id']}")
        if len(chunks) == 1:
            merged = chunks[0]
        else:
            import numpy as np
            silence = np.zeros(int(24000 * 0.18), dtype=chunks[0].dtype)
            merged = np.concatenate([part for chunk in chunks for part in (chunk, silence)])
        sf.write(out, merged, 24000)
        print(f"{item['id']}: {out}")


if __name__ == "__main__":
    main()
