# Board Demo Video Runbook

Use this to build a local, offline-safe walkthrough for the SandFest board.

## Goal

Show the certified product story from visitor experience through Operations,
document intake, partner workflows, delegated work, and controlled production
activation.

## Local Prep

Start and certify the persistent board stack:

```bash
npm run board:service:start
npm run board:certify
npm run board:present
```

The recorder fails closed unless the target is exact loopback, the runtime is
the isolated synthetic 2027 presentation, document ingestion is ready, and the
active certificate proves all ten journeys plus Chromium and WebKit 14/14.

## Five-Minute Storyboard

1. Visitor home: event dates, mission, install/offline status, and Live Beach entry.
2. Live Beach: scrub the festival timeline, hover sculpture pins, and start Sandy's suggested walk.
3. Tickets: add GA/VIP items, show consent checkboxes, and explain Stripe remains guarded until approved keys/webhooks are connected.
4. Sculptors and engagement: connect the governed roster, beach map, Passport, and People's Choice.
5. Operations: show command signals, document intake, partner workflows, incident delegation, certification evidence, and the post-board activation boundary.

## Build the narrated video

With the certified stack running on its preferred links, build the complete
video with:

```bash
npm run video:board
```

If the supervisor selected alternate ports, copy the Visitor and Operations
links from `npm run board:check`:

```bash
SANDFEST_DEMO_URL='http://127.0.0.1:PORT/?apiBase=ENCODED_API&mode=visitor' \
SANDFEST_OPERATIONS_URL='http://127.0.0.1:PORT/admin.html?apiBase=ENCODED_API' \
npm run video:board
```

This launches a clean headless Chrome session, captures deterministic 1600 by
900 frames from the real application, generates narration with the Mac's local
text-to-speech voice, encodes a 1080p MP4 with local `ffmpeg` compute, and
verifies the finished video against its source frames and certificate evidence.

Outputs are written to `artifacts/board-demo`:

- `texas-sandfest-board-demo.mp4`
- `texas-sandfest-board-demo-poster.png`
- `texas-sandfest-board-demo-transcript.txt`
- `capture.json`

Set `SANDFEST_VIDEO_VOICE` or `SANDFEST_VIDEO_RATE` to change the local voice
or pacing. Set `CHROME_PATH` if Google Chrome is installed somewhere else.
Run `npm run video:board:verify` to recheck existing output without recapturing
or rerendering it.

Finish with:

```bash
npm run board:handouts
npm run board:showtime
```

That final preflight requires the deck, persistent service, full certificate,
active Visitor and Operations links, and fallback video to agree on one clean
`origin/main` revision.

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
