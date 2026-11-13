#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import soundfile as sf
from kokoro import KPipeline
import numpy as np


def main():
    parser = argparse.ArgumentParser(description="Generate local Kokoro narration WAV files.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--voice", default="am_michael")
    parser.add_argument("--speed", type=float, default=0.92)
    args = parser.parse_args()

    items = json.loads(Path(args.manifest).read_text())
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    for item in items:
        passages = [passage.strip() for passage in item["text"].split("|") if passage.strip()]
        out = Path(item["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        chunks = []
        for passage_index, passage in enumerate(passages):
            passage_chunks = [audio for _, _, audio in pipeline(passage, voice=args.voice, speed=args.speed)]
            if passage_chunks:
                chunks.append(np.concatenate(passage_chunks))
            if passage_index < len(passages) - 1:
                pause_seconds = 0.42 if passage.endswith((".", "!", "?")) else 0.28
                chunks.append(np.zeros(int(24000 * pause_seconds), dtype=np.float32))
        if not chunks:
            raise RuntimeError(f"No audio generated for {item['id']}")
        merged = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
        sf.write(out, merged, 24000)
        print(f"{item['id']}: {out}")


if __name__ == "__main__":
    main()
