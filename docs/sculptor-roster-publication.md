# Sculptor roster publication

The Operations workspace is the controlled publishing path for the current SandFest sculptor roster. A published revision becomes the single source for the web and native iOS roster, corridor-map pins, Sculpture Passport checkpoints, and People's Choice entries. The iOS cache is bound to the API origin and event ID; an unpublished or held response clears the native roster, while a network failure may retain only a previously validated publication.

## Staff workflow

1. Open **Operations > Sculptor roster publication** and download the CSV template.
2. Enter the official HTTPS source and the local time when staff checked it.
3. Confirm that every row and beach marker belongs to the current event.
4. Preview the CSV. Preview validates the source metadata and every row without writing.
5. Resolve all issues, then publish the exact previewed revision.
6. Open Passport and People's Choice only after the roster is published.

Publishing is protected by `content:write`. The preview hash binds the CSV, source URL, source-check timestamp, event ID, and current stored roster fingerprint. Any file edit or concurrent roster change requires a new preview.

## CSV contract

Required columns are `sculptor_name`, `division`, `entry_title`, `beach_marker`, `map_x`, and `map_y`. Recommended columns are:

```csv
event_id,sculptor_id,sculptor_name,division,hometown,returning,bio,instagram,entry_id,entry_title,statement,status,beach_marker,map_x,map_y
```

- `event_id` must match the active `texas-sandfest-YYYY` event.
- Divisions are `master_solo`, `master_duo`, `semi_pro`, `amateur`, or `non_competing_master`.
- `returning` accepts explicit yes/no values.
- Status is `planning`, `sculpting`, `complete`, or `judged`.
- `map_x` and `map_y` are illustrated-map positions from `0` through `1`.
- Sculptor and entry IDs are optional; stable prefixed IDs are generated when omitted.
- One row represents one sculptor and one entry. IDs must be unique. The import limit is 500 rows and 5 MB.

## Holds and recovery

Use **Hold roster** when source approval or marker assignments change. A hold immediately returns empty/inactive public roster, passport, and voting projections while retaining the private import and audit history. Correct the CSV, preview again, and republish. Compatible historical stamps and votes remain stored and reappear only when their entry IDs exist in the republished revision.

The active document is `sculptorRoster` in the configured platform data plane. It participates in snapshots, event rollover, deployment readiness, and aggregate audit history. Production never accepts fictional board data or an unpublished, stale, cross-event, malformed, or future-dated source review.

## API routes

- `GET /api/public/sculptors`
- `GET /api/admin/sculptors`
- `POST /api/admin/sculptors/import` with `mode: preview|commit`
- `PATCH /api/admin/sculptors/engagement`
- `POST /api/admin/sculptors/hold`

Passport and voting clients continue to use their existing public routes. Their eligible records are derived server-side from the published roster revision.

The board supervisor treats the synthetic roster as a required preflight item. Advancing the board runtime schema automatically rebuilds an older isolated runtime before startup, and a missing or cross-linked roster prevents the presentation stack from reporting ready.
