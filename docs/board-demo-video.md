# Board Demo Video Runbook

Use this to build a local, offline-safe walkthrough for the SandFest board.

## Goal

Show that the platform is more than a website: it is a visitor guide, live beach layer, ticketing scaffold, sculpture passport, People's Choice voting surface, vendor map, admin console, and operations cockpit.

## Local Prep

```bash
npm run ready
SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me npm run api:dev
npm run dev
```

Open `http://127.0.0.1:5173`.

If `8788` is already occupied, run the API on a clean port and pass it to the
site:

```bash
SANDFEST_API_PORT=8806 SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me npm run api:dev
```

Then open `http://127.0.0.1:5173/?apiBase=http://127.0.0.1:8806`.

## Five-Minute Storyboard

1. Visitor home: event dates, mission, install/offline status, and Live Beach entry.
2. Live Beach: scrub the festival timeline, hover sculpture pins, and start Sandy's suggested walk.
3. Tickets: add GA/VIP items, show consent checkboxes, and explain Stripe remains guarded until approved keys/webhooks are connected.
4. Sculptors: filter the roster, tap a map pin, stamp the Sculpture Passport, then cast a People's Choice vote.
5. Operations mode: switch to Operations, show crowd simulation, ingestion cockpit, admin API configuration, emergency alert controls, revenue, fleet, volunteer, consent, passport, voting, and booth modules.

## Build the narrated video

With the local app and API running, build the complete video with:

```bash
SANDFEST_DEMO_URL='http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806' \
SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me \
npm run video:board
```

This launches a clean headless Chrome session, captures deterministic 1600 by
900 frames from the real application, generates narration with the Mac's local
text-to-speech voice, and encodes a 1080p MP4 with local `ffmpeg` compute.

Outputs are written to `artifacts/board-demo`:

- `texas-sandfest-board-demo.mp4`
- `texas-sandfest-board-demo-poster.png`
- `texas-sandfest-board-demo-transcript.txt`

Set `SANDFEST_VIDEO_VOICE` or `SANDFEST_VIDEO_RATE` to change the local voice
or pacing. Set `CHROME_PATH` if Google Chrome is installed somewhere else.

## Live recording alternative

Local compute only:

- Use macOS Screenshot or QuickTime for capture.
- Use the local Vite app and local admin API so the demo does not depend on hotel or boardroom internet.
- Keep the browser zoom at 90-100 percent on a 1440px or wider window.
- Pause motion only if the recording encoder drops frames.

## Board Talk Track

- Public visitors see the simple side: guide, map, tickets, artists, voting, and alerts.
- Staff see the operational side: coverage gaps, assets, revenue, partner readiness, alerts, and audit trails.
- Operational budget, ticketing, and local message workflows are functional in the isolated demo; QuickBooks and real providers remain intentionally deferred until credentials and approvals are provided.
- The next production unlocks are credential connection, content approval, real roster/vendor imports, and deployment-domain verification.
