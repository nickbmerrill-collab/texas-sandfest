# VolunteerLocal mirror

VolunteerLocal remains the system for recruitment, shift signup, kiosk attendance, and earned-ticket administration. SandFest imports its exports into the operations mirror for coverage, governed task assignment, incident dispatch, hours, and impact reporting.

## Operator workflow

In the Staffing workspace, choose the roster CSV and optionally the shifts and hours CSVs. Confirm that every file belongs to the current annual event, then preview. Preview never writes. It reports valid, new, updated, unchanged, and invalid records without exposing a raw export in audit history.

Commit is enabled only for the exact previewed files and current mirror version. A file edit, annual-event mismatch, or another committed import invalidates the preview. Exact replay returns the original import record and creates no duplicate volunteers, shifts, hours, or audit entry. Existing records absent from an export are preserved; removals require an explicit source status such as `cancelled` or a later governed reconciliation policy.

Only `confirmed` and `checked_in` volunteers appear in task and incident assignment directories. Missing waiver and SMS fields are always false. The import never treats a phone number as consent.

## Roster CSV

Required canonical columns:

```csv
volunteer_id,name
```

Supported columns include `event_id`, `email`, `phone`, `roles`, `status`, `waiver_signed`, `sms_consent`, `shirt_size`, and `updated_at`. Common VolunteerLocal aliases such as `user_id`, `full_name`, `mobile`, `jobs`, and `registration_status` are accepted. The external volunteer ID must be stable and unique. A nonblank email must be valid and unique within the export.

Statuses map into `interested`, `confirmed`, `checked_in`, `no_show`, or `cancelled`. Accepted source labels include active, approved, registered, pending, waitlist, present, inactive, withdrawn, and both spellings of canceled.

## Shifts CSV

Required canonical columns:

```csv
shift_id,role,zone,start_time,end_time,needed
```

Timestamps must be ISO 8601 values with a timezone. Optional columns include `event_id`, `location_name`, `day`, `volunteer_ids`, `volunteer_emails`, and `captain_id`. Multiple rows for one shift may add assignments only when role, zone, schedule, capacity, and captain metadata are identical. Every assigned volunteer and captain must resolve to the current mirror.

## Hours CSV

Required canonical column:

```csv
hour_log_id
```

Each row also needs `volunteer_id` or `volunteer_email`, plus either `hours` or both `check_in` and `check_out`. Optional `shift_id` must resolve to an imported or existing VolunteerLocal shift. Timestamps require a timezone, and one entry cannot exceed 24 hours.

## CLI fallback

The browser workspace is the normal operator path. For recovery or controlled service-shell work:

```bash
npm run import:volunteers -- roster.csv \
  --shifts=shifts.csv \
  --hours=hours.csv
```

The command prints a preview hash. Commit the unchanged files with:

```bash
npm run import:volunteers -- roster.csv \
  --shifts=shifts.csv \
  --hours=hours.csv \
  --commit \
  --preview-hash=<exact-preview-hash>
```

The CLI uses the same parser, current-event gate, atomic storage update, mirror fingerprint, provenance, and replay protection as the staffing workspace.
