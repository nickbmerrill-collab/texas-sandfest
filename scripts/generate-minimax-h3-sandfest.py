#!/usr/bin/env python3
"""Queue the SandFest cinematic shot package on two local MiniMax H3 workers."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass


DIFFUSION_MODEL = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
TEXT_ENCODER = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"

VISUAL_GUARDRAILS = """
Premium live-action documentary commercial. Photorealistic Texas Gulf Coast light,
natural skin tones, realistic sand and fabric texture, physically plausible human and
vehicle motion, stable geometry, deliberate stabilized camera movement, elegant
broadcast color, restrained teal, coral, and warm-gold accents. No text, subtitles,
logos, watermarks, fake dashboards, unreadable screens, distorted faces or hands,
duplicate people, warped vehicles, flicker, jump cuts, time-lapse warping, cartoon
rendering, or glossy synthetic CGI.
""".strip()

VOICE_DIRECTION = """
One off-camera narrator only: a warm, confident American woman in her forties, with
subtle Texas warmth, natural breathing, calm authority, and fluid conversational
boardroom delivery. Dry, centered, intimate studio voice. No announcer cadence, vocal
fry, sing-song phrasing, exaggerated regional accent, synthesized artifacts, or other
voices. Keep all ambience and music at least 18 dB beneath her voice.
""".strip()


@dataclass(frozen=True)
class Shot:
    id: str
    seed: int
    visual: str
    dialogue: str | None
    soundscape: str
    music: str
    first_frame: str | None = None


SHOTS = (
    Shot(
        "01-sunrise-reveal",
        270401,
        """
Ten-second opening shot for a Texas SandFest board film in Port Aransas, Texas. Begin
from the exact supplied aerial photograph of the real festival. Preserve its coastline,
festival footprint, tents, vehicles, and crowd geometry. Move forward in one slow,
stable drone push with a subtle descent toward the sculptures; let only natural surf,
flags, people, and vehicles move. The shot feels ambitious, warm, and unmistakably
authentic.
""",
        "Texas SandFest is unforgettable on the beach. Now, the operation behind it can be just as remarkable.",
        "Clean Gulf surf, light wind, and distant festival activity. No audible conversation or radio speech.",
        "A restrained premium documentary pulse with a gentle, confident lift.",
        first_frame="sandfest-hero.webp",
    ),
    Shot(
        "02-operation-in-motion",
        270402,
        """
Ten-second event-operations sequence at Texas SandFest during calm early-morning
setup on the wide Port Aransas beach with the Gulf visible. A stabilized gimbal follows
a capable festival operations lead as volunteer captains confirm assignments, vendors
complete orderly setup, and radio-equipped staff coordinate arrivals. Use three motivated editorial cuts
with matched screen direction: operations lead, volunteer handoff, wide organized
site. Show confident teamwork and visible accountability without staged gestures.
""",
        "Every signup, payment, deadline, and assignment moves through a single coordinated command system.",
        "Natural footsteps, tent fabric, and coastal morning ambience. No conversation, radio voices, or public-address audio.",
        "A subtle premium documentary rhythm, restrained and modern.",
    ),
    Shot(
        "03-island-flow",
        270403,
        """
Ten-second cinematic picture of island-flow coordination for Texas SandFest.
Open on a long-lens view of Port Aransas ferry traffic moving predictably, cut to a
high oblique view of vehicles approaching the festival with clearly managed lanes,
then follow trained event staff guiding pedestrians safely toward the beach entrance.
The operation is calm, measured, and prepared rather than congested or dramatic.
Do not depict emergency lights or unsafe behavior.
""",
        "Island Conditions is designed to turn weather, ferry movement, traffic, and crowd flow into one clear operating picture.",
        "Soft roadway and ferry ambience with Gulf wind. No conversation, radio voices, or public-address audio.",
        "A low, measured cinematic rhythm that communicates preparation rather than urgency.",
    ),
    Shot(
        "04-partner-experience",
        270404,
        """
Ten-second premium sponsor-and-vendor experience at Texas SandFest. Begin from the
exact supplied photograph of a real festival food vendor. Preserve the serving table,
hands, food, tent structure, and natural light. Pull back smoothly to reveal a polished
but authentic coastal marketplace, with local businesses welcoming families and
sponsor hospitality integrated tastefully into the event. Avoid prominent invented
branding; focus on human partnership, community value, and professional operation.
""",
        "Sponsors and vendors enter one professional pipeline for outreach, follow-up, payment, and long-term value.",
        "Warm crowd texture and food-service sounds without intelligible background speech.",
        "Light acoustic percussion and a polished, optimistic underscore.",
        first_frame="sandfest-vendor.webp",
    ),
    Shot(
        "05-guest-moment",
        270405,
        """
Ten-second emotional guest-experience sequence at Texas SandFest in bright, soft
daylight. Begin from the exact supplied photograph of real children learning from a
sand sculptor. Preserve every person's identity, clothing, pose, and the sculpture's
geometry. Use an intimate, observant camera arc as hands continue shaping sand and the
children react naturally, then widen slightly to reveal the real festival around them.
The experience feels welcoming, accessible, and worth traveling for.
""",
        "Guests get one polished experience, while staff and volunteers get the accountability to deliver it.",
        "Sculpting tools in sand, gentle surf, and soft crowd presence without intelligible background speech.",
        "A restrained uplifting score with warmth, never sentimental.",
        first_frame="sandfest-guests.webp",
    ),
    Shot(
        "06-golden-hour-close",
        270406,
        """
Ten-second closing shot for a Texas SandFest board film. Begin from the exact supplied
aerial photograph of the real festival. Preserve the real coastline, festival layout,
tents, vehicles, and crowd geometry while the light develops gently toward a rich late
afternoon glow. Use one slow, stabilized pullback that reveals the full scale of the
beachfront event. Hold the final wide composition for a title added in postproduction.
""",
        "This is how Texas SandFest grows with confidence: one festival, one team, one operating system.",
        "Warm surf and distant festival ambience with no intelligible background speech.",
        "A confident cinematic resolve that opens into a clean, graceful finish.",
        first_frame="sandfest-hero.webp",
    ),
    Shot(
        "09-score-foundation",
        270409,
        """
Fifteen-second uninterrupted cinematic view of gentle Gulf waves beside the Texas
SandFest beach at first light. One slow stabilized lateral move, clean horizon,
natural water and wind movement, no people speaking, and no visible text.
""",
        None,
        "Clean Gulf surf and light coastal wind. Absolutely no speech, singing, chanting, vocal samples, or human voices.",
        "A loop-friendly instrumental premium documentary underscore at a calm mid-tempo pace. Warm piano texture, subtle low strings, restrained hand percussion, and an understated modern pulse. Confident and human, never corporate stock music. No vocals. End on a sustained neutral harmony that can crossfade cleanly.",
    ),
    Shot(
        "10-score-lift",
        270410,
        """
Fifteen-second uninterrupted golden-hour shot moving smoothly above sculpted sand
textures toward the Gulf. Refined natural light, physically plausible wind, no people
speaking, no visible text, and no cuts.
""",
        None,
        "Soft surf, fine sand movement, and distant festival presence. Absolutely no speech, singing, chanting, vocal samples, or human voices.",
        "A loop-friendly instrumental continuation of a premium documentary score. Warm piano, soft strings, subtle coastal percussion, and a measured uplifting pulse. Build gently without a trailer hit or oversized climax. No vocals. End on a sustained neutral harmony that can crossfade cleanly.",
    ),
)


def frame_count(seconds: float) -> int:
    frames = max(5, round(seconds * 24))
    return frames + (5 - (frames % 17)) % 17


def workflow(shot: Shot, width: int, height: int, seconds: float, steps: int) -> dict:
    if shot.dialogue:
        dialogue = f"""At 00:01.000, the off-camera narrator speaks this line once, exactly as written:
<d>[English] {shot.dialogue}</d>
After the line, she does not speak again. There are no other voices."""
        voice_direction = VOICE_DIRECTION
        music_mix = "The music never swells over the narrator and ends naturally with the picture."
    else:
        dialogue = "There is no dialogue, narration, singing, chanting, or audible human voice at any time."
        voice_direction = "No voices or vocal sounds."
        music_mix = "Instrumental only. No vocals. End naturally with the picture."
    prompt = f"""integrated_multimodal_description:
{shot.visual.strip()}
{dialogue}

visual_quality_and_exclusions:
{VISUAL_GUARDRAILS}

overall_soundscape:
{shot.soundscape}
{voice_direction}

non_diegetic_music:
{shot.music}
{music_mix}
""".strip()
    graph = {
        "1": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_VAE}},
        "2": {"class_type": "VAELoader", "inputs": {"vae_name": AUDIO_VAE}},
        "3": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": DIFFUSION_MODEL, "weight_dtype": "default"},
        },
        "4": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": TEXT_ENCODER, "type": "minimax", "device": "default"},
        },
        "5": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["4", 0],
                "vae": ["1", 0],
                "prompt": prompt,
                "width": width,
                "height": height,
                "length": frame_count(seconds),
            },
        },
        "6": {
            "class_type": "BasicGuider",
            "inputs": {"model": ["3", 0], "conditioning": ["5", 0]},
        },
        "7": {
            "class_type": "BasicScheduler",
            "inputs": {"model": ["3", 0], "scheduler": "simple", "steps": steps, "denoise": 1.0},
        },
        "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": shot.seed}},
        "10": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["9", 0],
                "guider": ["6", 0],
                "sampler": ["8", 0],
                "sigmas": ["7", 0],
                "latent_image": ["5", 1],
            },
        },
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["1", 0]}},
        "12": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["10", 0], "vae": ["2", 0]}},
        "13": {
            "class_type": "CreateVideo",
            "inputs": {"images": ["11", 0], "audio": ["12", 0], "fps": 24.0, "bit_depth": 8},
        },
        "14": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["13", 0],
                "filename_prefix": f"sandfest-h3/{shot.id}",
                "format": "mp4",
                "codec": "auto",
            },
        },
    }
    if shot.first_frame:
        graph["15"] = {"class_type": "LoadImage", "inputs": {"image": shot.first_frame}}
        graph["5"]["inputs"]["first_frame"] = ["15", 0]
    return graph


def request_json(url: str, payload: dict | None = None, timeout: float = 30) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def wait_for_server(server: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            request_json(f"{server}/system_stats", timeout=5)
            return
        except (OSError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(2)
    raise TimeoutError(f"ComfyUI did not become ready at {server}: {last_error}")


def render(server: str, shot: Shot, args: argparse.Namespace) -> dict:
    client_id = str(uuid.uuid4())
    queued = request_json(
        f"{server}/prompt",
        {"prompt": workflow(shot, args.width, args.height, args.seconds, args.steps), "client_id": client_id},
        timeout=60,
    )
    if "prompt_id" not in queued:
        raise RuntimeError(f"{shot.id} was rejected by {server}: {queued}")

    prompt_id = queued["prompt_id"]
    print(f"QUEUED {shot.id} on {server} as {prompt_id}", flush=True)
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        history = request_json(f"{server}/history/{prompt_id}", timeout=30)
        item = history.get(prompt_id)
        if item:
            status = item.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"{shot.id} failed on {server}: {json.dumps(status, indent=2)}")
            outputs = item.get("outputs", {})
            if outputs:
                print(f"COMPLETE {shot.id} on {server}", flush=True)
                return {"shot": shot.id, "server": server, "prompt_id": prompt_id, "outputs": outputs}
        time.sleep(10)
    raise TimeoutError(f"{shot.id} exceeded {args.timeout:.0f}s on {server}")


def render_queue(server: str, shots: list[Shot], args: argparse.Namespace) -> list[dict]:
    return [render(server, shot, args) for shot in shots]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", action="append", default=[])
    parser.add_argument("--shot", action="append", default=[])
    parser.add_argument("--width", type=int, default=1344)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=8 * 60 * 60)
    parser.add_argument("--server-timeout", type=float, default=300)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    servers = args.server or ["http://10.10.10.2:8188", "http://10.10.10.2:8189"]
    selected = [shot for shot in SHOTS if not args.shot or shot.id in args.shot]
    if len(selected) != len(args.shot) and args.shot:
        known = ", ".join(shot.id for shot in SHOTS)
        raise SystemExit(f"Unknown shot name. Available: {known}")

    if args.dry_run:
        print(json.dumps({shot.id: workflow(shot, args.width, args.height, args.seconds, args.steps) for shot in selected}, indent=2))
        return

    for server in servers:
        wait_for_server(server.rstrip("/"), args.server_timeout)
    print(f"READY workers={','.join(servers)} shots={len(selected)}", flush=True)

    assignments = {server.rstrip("/"): [] for server in servers}
    server_order = list(assignments)
    for index, shot in enumerate(selected):
        assignments[server_order[index % len(server_order)]].append(shot)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(servers)) as pool:
        futures = [
            pool.submit(render_queue, server, shots, args)
            for server, shots in assignments.items()
            if shots
        ]
        for future in concurrent.futures.as_completed(futures):
            results.extend(future.result())
    print(json.dumps(sorted(results, key=lambda item: item["shot"]), indent=2))


if __name__ == "__main__":
    main()
