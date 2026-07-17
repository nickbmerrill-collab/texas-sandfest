# Eventeny booth mirror

Eventeny remains the source for booth-space assignment exports. SandFest reconciles those exports into the operations and public-map mirror without allowing a CSV upload to publish a vendor, approve compliance, delete an absent record, or overwrite another event year silently.

## Operator workflow

In the Booth map workspace, choose the Eventeny CSV and confirm it belongs to the current annual event. Preview never writes. It reports new, updated, unchanged, invalid, and moved-assignment counts while preserving local booths and vendors absent from the export.

Commit is enabled only for the exact previewed bytes and current booth-mirror version. Editing the file, changing the annual event, or committing another booth import invalidates the preview. Concurrent and repeated commits converge on one import record. Aggregate audit history stores the file name, actor, timestamp, hashes, and counts without storing business names or source rows.

## Required columns

`booth_id` is required on every row. Assigned rows also require a business name and one provider identity from `vendor_id`, `application_id`, or `eventeny_id`.

Supported aliases include:

- Event scope: `event_id`, `festival_id`, `event`
- Business: `business_name`, `business`, `vendor`, `organization_name`, `exhibitor`
- Placement: `zone`, `booth_status`, `beach_marker`, `map_x`, `map_y`, `lat`, `lng`
- Vendor: `category`, `vendor_status`, `booth_fee_cents`, `booth_fee`, `description`
- Readiness: `coi_status`, `health_status`, `public`
- Provenance: `source_updated_at`

Map X and Y must be supplied together and remain between 0 and 100. Latitude and longitude must also be supplied together. Dollar fees accept at most two decimals; `_cents` fields accept whole cents. Source timestamps must be ISO 8601 values with a timezone.

## Safety behavior

- A blank `public` value is private. Only explicit yes/true values make an eligible assigned vendor visible.
- A blank COI or food health-permit status is `missing`, never approved.
- Assigned or checked-in booths require a provider-identified business. Open booths cannot carry a business.
- Rows from another event are invalid and skipped.
- Duplicate booth or vendor IDs are invalid.
- Existing records absent from an export are preserved. An explicit open booth or moved vendor reconciles that assignment.
- Up to 5,000 rows and 5 MB are accepted per upload.

## CLI fallback

The CLI uses the same parser, state fingerprint, transaction, and replay contract. It previews by default:

```bash
npm run import:booths -- path/to/eventeny-booths.csv
```

Commit the unchanged file only after reviewing the printed summary:

```bash
npm run import:booths -- path/to/eventeny-booths.csv \
  --commit \
  --preview-hash=<hash> \
  --current-event-confirmed
```
